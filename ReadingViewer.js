import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import PdfViewer from './PdfViewer';
import { formatSize } from './fileUtils.cjs';
import { useTheme, hairline, radius, space, type } from './theme';
import { getReadingState, updateReadingState, togglePageBookmark } from './fileLibrary';
import { AppIcon, IconButton } from './workspaceUi';

// Read-only preview for every supported kind. No edit controls live here; editing
// is a separate, explicit mode the user opts into from the header.
export default function ReadingViewer({ doc, onProgressSaved, onActionsChange }) {
  const { theme } = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [reading, setReading] = useState(() => {
    try { return getReadingState(doc.libraryId); } catch { return { page: 1, pageCount: 0, bookmarks: [] }; }
  });
  const [bookmarksOpen, setBookmarksOpen] = useState(false);
  const [jumpTo, setJumpTo] = useState(null);
  const [notice, setNotice] = useState('');
  const initialPage = useRef(reading.page);
  const pending = useRef(null), timer = useRef(null), alive = useRef(true), bookmarkBusy = useRef(false);
  async function flushProgress() {
    clearTimeout(timer.current);
    const value = pending.current;
    pending.current = null;
    if (!value || !doc.libraryId) return;
    try { await updateReadingState(doc.libraryId, value.page, value.pageCount); onProgressSaved?.(); }
    catch { if (alive.current) setNotice('Reading position could not be saved.'); }
  }
  useEffect(() => {
    alive.current = true;
    const subscription = AppState.addEventListener('change', state => { if (state !== 'active') flushProgress(); });
    return () => { alive.current = false; subscription.remove(); flushProgress(); };
  }, [doc.libraryId]);
  function pageChanged(value) {
    if (!Number.isInteger(value.pageCount) || value.pageCount < value.page || value.page < 1) return;
    setReading(previous => ({ ...previous, page: value.page, pageCount: value.pageCount }));
    initialPage.current = value.page;
    if (doc.libraryId) {
      pending.current = value;
      clearTimeout(timer.current);
      timer.current = setTimeout(flushProgress, 400);
    }
  }
  async function bookmark() {
    if (!doc.libraryId || bookmarkBusy.current || !reading.pageCount) return;
    bookmarkBusy.current = true;
    try {
      await flushProgress();
      const item = await togglePageBookmark(doc.libraryId, reading.page);
      if (alive.current) { setReading(previous => ({ ...previous, bookmarks: item.bookmarks })); setNotice(''); }
    } catch (error) { if (alive.current) setNotice(error.message); }
    finally { bookmarkBusy.current = false; }
  }

  // Publish this viewer's actions so the shell can show them in one overflow menu
  // instead of a toolbar competing with the page for screen space.
  const bookmarked = reading.bookmarks.includes(reading.page);
  useEffect(() => {
    if (doc.kind !== 'pdf') { onActionsChange?.([]); return; }
    onActionsChange?.([
      { key: 'bookmark', icon: 'bookmark', filled: bookmarked, separated: true,
        label: bookmarked ? 'Remove bookmark' : 'Bookmark this page',
        detail: reading.pageCount ? `Page ${reading.page} of ${reading.pageCount}` : 'Waiting for the page to load',
        disabled: !doc.libraryId || !reading.pageCount, onPress: bookmark },
      { key: 'bookmarks', icon: 'star', label: 'Saved bookmarks',
        detail: reading.bookmarks.length ? `${reading.bookmarks.length} saved` : 'None yet',
        disabled: !reading.bookmarks.length, onPress: () => setBookmarksOpen(true) },
    ]);
  }, [doc.kind, doc.libraryId, bookmarked, reading.page, reading.pageCount, reading.bookmarks.length]);
  useEffect(() => () => onActionsChange?.([]), []);

  if (doc.kind === 'image') {
    return (
      <ScrollView
        style={styles.root}
        contentContainerStyle={styles.imageWrap}
        maximumZoomScale={5}
        minimumZoomScale={1}
        centerContent
      >
        <Image accessibilityLabel={doc.name} source={{ uri: doc.uri }} style={styles.image} contentFit="contain" cachePolicy="none" autoplay={false} allowDownscaling />
      </ScrollView>
    );
  }

  if (doc.kind === 'pdf') {
    return (
      <View style={styles.root}>
        {bookmarksOpen && <View style={styles.bookmarksPanel}>
          <View style={styles.bookmarksHeader}>
            <Text style={styles.bookmarksTitle}>Bookmarks</Text>
            <IconButton name="close" label="Close bookmarks" onPress={() => setBookmarksOpen(false)} />
          </View>
          <ScrollView horizontal contentContainerStyle={{ gap: space.sm }} showsHorizontalScrollIndicator={false}>
            {reading.bookmarks.map(page => <Pressable key={page} accessibilityRole="button" accessibilityLabel={`Go to bookmarked page ${page}`}
              onPress={() => { setJumpTo({ page }); setBookmarksOpen(false); }} style={styles.bookmarkChip}>
              <Text style={styles.bookmarksLabel}>Page {page}</Text>
            </Pressable>)}
          </ScrollView>
        </View>}
        {!!notice && <Text accessibilityLiveRegion="polite" style={styles.readingNotice}>{notice}</Text>}
        <PdfViewer uri={doc.uri} name={doc.name} initialPage={initialPage.current} onPageChange={pageChanged} jumpTo={jumpTo} />
      </View>
    );
  }

  // text
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.textWrap}>
      <Text style={styles.body} selectable>{doc.text}</Text>
    </ScrollView>
  );
}

function makeStyles(t) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.overlayViewer },
    imageWrap: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: space.md },
    image: { width: '100%', height: 520 },
    textWrap: { padding: space.lg, paddingBottom: space.xxl, gap: space.md },
    meta: { ...type.caption, color: t.textFaint },
    body: { color: t.text, fontSize: 15, lineHeight: 24, fontFamily: 'monospace' },
    readingBar: { backgroundColor: t.surface, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center',
      paddingHorizontal: space.md, borderBottomWidth: hairline, borderColor: t.border, gap: space.xs },
    readingLabel: { ...type.caption, color: t.textMuted },
    bookmarksTitle: { ...type.label, color: t.text },
    bookmarksHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.sm },
    bookmarksLabel: { ...type.caption, fontWeight: '600', color: t.primary },
    bookmarksPanel: { backgroundColor: t.surface, paddingHorizontal: space.lg, paddingVertical: space.md, borderBottomWidth: hairline, borderColor: t.border },
    bookmarkChip: { backgroundColor: t.surfaceAlt, borderRadius: radius.sm, minHeight: 44, justifyContent: 'center', paddingHorizontal: space.md },
    readingNotice: { ...type.caption, color: t.warn, backgroundColor: t.surface, padding: space.md },
  });
}
