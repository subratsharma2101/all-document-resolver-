import { useEffect, useMemo, useState } from 'react';
import { FlatList, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { hairline, radius, space, type, useTheme } from './theme';
import { ActionButton, AppIcon, EmptyState, FileTile, IconButton } from './workspaceUi';

export function filterFiles(items, query, kind, sort) {
  const term = query.trim().toLocaleLowerCase();
  return items.filter(item => (kind === 'all' || item.kind === kind) && item.name.toLocaleLowerCase().includes(term))
    .sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name) : (b.openedAt || b.modified || 0) - (a.openedAt || a.modified || 0));
}

export default function FilesScreen({ recent, exports, initialKind = 'all', initialCollection = 'recent', onOpen, onSave, onShare, onRemove, onRename, onFavorite, onFolder, folder, disabled }) {
  const { theme: t } = useTheme(), s = makeStyles(t);
  const [collection, setCollection] = useState(initialCollection);
  const [kind, setKind] = useState(initialKind);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('recent');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState([]);
  const [active, setActive] = useState(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => { setKind(initialKind); setCollection(initialCollection); }, [initialKind, initialCollection]);
  useEffect(() => { setSelected([]); }, [collection, query, kind]);
  const source = collection === 'exports' ? exports : collection === 'starred' ? recent.filter(item => item.favorite) : recent;
  const items = useMemo(() => filterFiles(source, query, kind, sort), [source, query, kind, sort]);
  const chosen = items.filter(item => selected.includes(item.uri));
  const toggleSelection = uri => setSelected(current => current.includes(uri) ? current.filter(value => value !== uri) : [...current, uri]);
  const closeSheet = () => { if (!disabled) { setActive(null); setRenaming(false); setNotice(''); } };
  async function rename() {
    try { await onRename(active, name); closeSheet(); } catch (error) { setNotice(error.message); }
  }
  return <View style={{ flex: 1 }}>
    <FlatList data={items} keyExtractor={item => item.uri} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={s.content}
      ListHeaderComponent={<View>
        <View style={s.heading}><View style={{ flex: 1 }}><Text accessibilityRole="header" style={s.title}>My Files</Text></View><IconButton name="plus" label="Open a file" disabled={disabled} onPress={() => onOpen()} /></View>
        <View style={s.search}><AppIcon name="search" color={t.textMuted} size={19} /><TextInput accessibilityLabel="Search files by name" placeholder="Find a file…" placeholderTextColor={t.textFaint} value={query} onChangeText={setQuery} style={s.searchInput} returnKeyType="search" autoCorrect={false} />{!!query && <IconButton name="close" label="Clear search" onPress={() => setQuery('')} />}</View>
        <View style={s.collections}>{[['recent', 'Recent'], ['exports', 'Exports'], ['starred', 'Starred']].map(([value, label]) => <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: collection === value }} onPress={() => setCollection(value)} style={[s.collection, collection === value && s.collectionOn]}><Text style={[s.collectionLabel, collection === value && { color: t.text, fontWeight: '700' }]}>{label}{value === 'exports' ? ` (${exports.length})` : ''}</Text></Pressable>)}</View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filters}>{[['all', 'All files'], ['pdf', 'PDFs'], ['image', 'Images'], ['text', 'Text']].map(([value, label]) => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: kind === value }} onPress={() => setKind(value)} style={[s.filter, kind === value && { backgroundColor: t.primary, borderColor: t.primary }]}><Text style={{ ...type.caption, fontWeight: '600', color: kind === value ? t.primaryText : t.textMuted }}>{label}</Text></Pressable>)}</ScrollView>
        <View style={s.listHeading}><Text style={s.count}>{items.length} {items.length === 1 ? 'document' : 'documents'}</Text><View style={s.controls}><Pressable accessibilityRole="button" accessibilityLabel={`Sort by ${sort === 'recent' ? 'name' : 'most recent'}`} onPress={() => setSort(sort === 'recent' ? 'name' : 'recent')} style={s.sort}><AppIcon name="sort" size={16} color={t.textMuted} /><Text style={s.count}>{sort === 'recent' ? 'Recent' : 'A–Z'}</Text></Pressable><Pressable accessibilityRole="button" onPress={() => { setSelecting(!selecting); setSelected([]); }} style={s.sort}><Text style={s.link}>{selecting ? 'Done' : 'Select'}</Text></Pressable></View></View>
        {selecting && !!items.length && <View style={s.selection}><Text style={s.count}>{chosen.length} selected</Text><Pressable accessibilityRole="button" onPress={() => setSelected(chosen.length === items.length ? [] : items.map(item => item.uri))} style={s.sort}><Text style={s.link}>{chosen.length === items.length ? 'Deselect all' : 'Select all'}</Text></Pressable></View>}
      </View>}
      renderItem={({ item }) => <FileTile item={item} disabled={disabled} selected={selected.includes(item.uri)} onSelect={selecting ? () => toggleSelection(item.uri) : undefined} onOpen={() => selecting ? toggleSelection(item.uri) : onOpen(null, item)} onMore={selecting ? undefined : () => { setActive(item); setName(item.name); setNotice(''); }} />}
      ListEmptyComponent={<EmptyState icon={collection === 'starred' ? 'star' : 'search'} title={query || kind !== 'all' ? 'No matching files' : collection === 'starred' ? 'Keep the good stuff close' : collection === 'exports' ? 'Your next creation starts here' : 'Start with a document'} detail={query || kind !== 'all' ? 'Try a different name or file type.' : collection === 'starred' ? 'Star a recent file from its actions menu to find it here.' : collection === 'exports' ? 'Saved edits, scans and conversions appear here.' : 'Open a file to keep a private copy in your recent documents.'} action={query || kind !== 'all' ? 'Clear filters' : 'Open a file'} onAction={query || kind !== 'all' ? () => { setQuery(''); setKind('all'); } : () => onOpen()} />}
      ListFooterComponent={<View style={s.footer}>
        {Platform.OS === 'android' && <View style={s.folder}><AppIcon name="folder" color={t.primary} size={20} /><View style={{ flex: 1 }}><Text style={s.folderTitle}>{folder ? folder.label : 'Choose your save folder'}</Text><Text style={s.folderDetail}>{folder ? 'Your phone copies are saved here' : 'Set it once for simpler saving'}</Text></View><Pressable accessibilityRole="button" disabled={disabled} onPress={onFolder} style={s.sort}><Text style={s.link}>{folder ? 'Change' : 'Choose'}</Text></Pressable></View>}
        <Text style={s.storageNote}>App copies stay on this device and are removed when you uninstall. Save to your phone to keep a separate copy.</Text>
      </View>} />
    {selecting && !!chosen.length && <View style={s.selectionBar}><ActionButton label={Platform.OS === 'android' ? `Save ${chosen.length} to phone` : 'Share selected file'} icon="download" disabled={disabled || Platform.OS !== 'android' && chosen.length !== 1} onPress={() => onSave(chosen)} /><Text style={s.storageNote}>{Platform.OS !== 'android' && chosen.length > 1 ? 'Select one file to open the share sheet.' : 'Uses your chosen folder'}</Text></View>}
    <Modal visible={!!active} transparent animationType="slide" onRequestClose={closeSheet}>
      <View style={s.scrim}><Pressable accessibilityRole="button" accessibilityLabel="Close file actions" onPress={closeSheet} disabled={disabled} style={{ flex: 1 }} /><SafeAreaView edges={['bottom']} style={s.sheet}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: space.lg, gap: space.md }}>
          <View style={s.sheetHeader}><View style={{ flex: 1 }}><Text style={s.sheetTitle}>{renaming ? 'Rename file' : active?.name}</Text><Text style={s.folderDetail}>{active?.libraryId ? 'Private app copy' : 'Exported app copy'}</Text></View><IconButton name="close" label="Close file actions" onPress={closeSheet} disabled={disabled} /></View>
          {renaming ? <><TextInput accessibilityLabel="New file name" value={name} onChangeText={setName} editable={!disabled} autoFocus autoCorrect={false} selectTextOnFocus style={s.renameInput} /><Text style={s.storageNote}>Keep the file extension. Your original file keeps its name.</Text><ActionButton label="Save name" onPress={rename} disabled={disabled || !name.trim()} /></> : <>
            <ActionButton label={Platform.OS === 'android' ? 'Save to phone' : 'Save to Files'} icon="download" disabled={disabled} onPress={() => { setActive(null); onSave([active]); }} />
            <ActionButton label="Share file" icon="share" quiet disabled={disabled} onPress={() => { setActive(null); onShare(active); }} />
            {!!active?.libraryId && <><ActionButton label={active.favorite ? 'Remove from starred' : 'Add to starred'} icon="star" quiet disabled={disabled} onPress={async () => { try { await onFavorite(active); setActive(null); } catch (error) { setNotice(error.message); } }} /><ActionButton label="Rename" quiet disabled={disabled} onPress={() => setRenaming(true)} /></>}
            <Pressable accessibilityRole="button" disabled={disabled} onPress={() => { setActive(null); onRemove(active); }} style={{ minHeight: 48, justifyContent: 'center', alignItems: 'center' }}><Text style={{ ...type.label, color: t.danger }}>Remove app copy</Text></Pressable>
          </>}
          {!!notice && <Text accessibilityRole="alert" style={{ ...type.caption, color: t.danger }}>{notice}</Text>}
        </ScrollView>
      </SafeAreaView></View>
    </Modal>
  </View>;
}
function makeStyles(t) {
  return StyleSheet.create({
    content: { padding: space.lg, paddingBottom: space.xl, width: '100%', maxWidth: 760, alignSelf: 'center', flexGrow: 1 },
    heading: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingTop: space.xs },
    title: { ...type.display, color: t.text },
    search: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingLeft: space.md, paddingRight: space.xs, minHeight: 48,
      backgroundColor: t.surface, borderRadius: radius.md, borderWidth: hairline, borderColor: t.border, marginTop: space.lg },
    searchInput: { flex: 1, minHeight: 46, color: t.text, ...type.body },
    collections: { flexDirection: 'row', borderBottomWidth: hairline, borderColor: t.border, marginTop: space.lg },
    collection: { flex: 1, paddingHorizontal: space.xs, minHeight: 46, justifyContent: 'center', alignItems: 'center', borderBottomWidth: 2, borderColor: 'transparent' },
    collectionOn: { borderColor: t.primary },
    collectionLabel: { ...type.caption, color: t.textMuted },
    filters: { gap: space.sm, paddingVertical: space.md },
    filter: { minHeight: 38, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: hairline, borderColor: t.border, justifyContent: 'center' },
    listHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.xs },
    count: { ...type.caption, color: t.textMuted },
    controls: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
    sort: { minHeight: 44, paddingHorizontal: space.xs, flexDirection: 'row', alignItems: 'center', gap: space.xs },
    link: { ...type.caption, color: t.primary, fontWeight: '600' },
    selection: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: t.surfaceAlt, paddingHorizontal: space.md, borderRadius: radius.sm },
    footer: { marginTop: space.xl, gap: space.md },
    folder: { flexDirection: 'row', alignItems: 'center', gap: space.md, borderRadius: radius.md, borderWidth: hairline, borderColor: t.border, backgroundColor: t.surface, padding: space.md },
    folderTitle: { ...type.label, color: t.text },
    folderDetail: { ...type.caption, color: t.textMuted, marginTop: space.xs },
    storageNote: { ...type.caption, color: t.textFaint },
    selectionBar: { padding: space.lg, gap: space.sm, borderTopWidth: hairline, borderColor: t.border, backgroundColor: t.surface },
    scrim: { flex: 1, backgroundColor: t.scrim },
    sheet: { backgroundColor: t.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: '80%' },
    sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
    sheetTitle: { ...type.title, color: t.text },
    renameInput: { borderWidth: hairline, borderColor: t.border, borderRadius: radius.sm, backgroundColor: t.bg, color: t.text, padding: space.md, minHeight: 48, ...type.body },
  });
}
