import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { newWorkingFile, removeWorkingFile } from './fileService';
import { copyName, formatSize, utf8Size, LIMITS } from './fileUtils.cjs';
import { createTextPdf, removeGeneratedFile } from './nativeFileTools';
import { readDraft } from './draftStorage';
import useDraftAutosave from './useDraftAutosave';
import TextImageRenderer from './TextImageRenderer';
import { useTheme, hairline, radius, space, type } from './theme';

// Swap a filename's extension, e.g. notes.txt -> notes.pdf.
function withExtension(name, ext) {
  const clean = copyName(name);
  const dot = clean.lastIndexOf('.');
  return `${dot > 0 ? clean.slice(0, dot) : clean}.${ext}`;
}

export default function TextEditor({ doc, onExport, onDirtyChange, onBusyChange, onDraftChange, onDraftStored }) {
  const { theme } = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [restored] = useState(() => readDraft(doc));
  const [text, setText] = useState(restored?.text ?? doc.text ?? '');
  const [busy, setBusy] = useState(false);
  const [fontSize, setFontSize] = useState(15);
  const [limitNotice, setLimitNotice] = useState('');
  const [rendering, setRendering] = useState(false); // true while the text->image WebView runs
  const [revision, setRevision] = useState(0);
  const [savedFormats, setSavedFormats] = useState({});
  const locked = useRef(false);
  const isSaved = format => savedFormats[format]?.revision === revision;
  const saveLabel = (format, label) => isSaved(format) ? (savedFormats[format].phone ? `${label} saved` : `${label} in Exports`) : `Save ${label}`;
  const recordSave = (format, result) => setSavedFormats(previous => ({ ...previous, [format]: { revision, phone: result?.saveStatus === 'saved' } }));
  const dirty = text !== (doc.text || '') && !Object.values(savedFormats).some(saved => saved.revision === revision);
  const autosave = useDraftAutosave({ doc, dirty, revision: text, snapshot: { text }, restored, onDraftChange, onDraftStored });
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  const setWorking = (value) => { locked.current = value; setBusy(value); onBusyChange?.(value); };

  async function save() {
    if (locked.current || isSaved('text')) return;
    setWorking(true);
    let file;
    try {
      file = newWorkingFile(copyName(doc.name));
      file.write(text);
      const saved = await onExport({ uri: file.uri, name: copyName(doc.name), mimeType: doc.mimeType || 'text/plain' });
      recordSave('text', saved);
      await autosave.clear();
    } catch (error) {
      Alert.alert('Could not export', error.message);
    } finally {
      if (file) removeWorkingFile(file.uri);
      setWorking(false);
    }
  }

  async function saveAsPdf() {
    if (locked.current || isSaved('pdf') || !text.trim()) return;
    setWorking(true);
    let file;
    try {
      file = await createTextPdf(text, withExtension(doc.name, 'pdf'));
      const saved = await onExport({ uri: file.uri, name: withExtension(doc.name, 'pdf'), mimeType: 'application/pdf' });
      recordSave('pdf', saved);
      await autosave.clear();
    } catch (error) {
      Alert.alert('Could not make PDF', error.message);
    } finally {
      if (file) removeGeneratedFile(file.uri);
      setWorking(false);
    }
  }

  // The image itself is produced off-screen by TextImageRenderer; these handlers
  // receive the base64 PNG (or an error) and finish the export.
  async function onImageRendered(base64) {
    setRendering(false);
    let file;
    try {
      file = newWorkingFile(withExtension(doc.name, 'png'));
      file.write(base64, { encoding: 'base64' });
      const saved = await onExport({ uri: file.uri, name: withExtension(doc.name, 'png'), mimeType: 'image/png' });
      recordSave('image', saved);
      await autosave.clear();
    } catch (error) {
      Alert.alert('Could not make image', error.message);
    } finally {
      if (file) removeWorkingFile(file.uri);
      setWorking(false);
    }
  }

  function onImageError(message) {
    setRendering(false);
    setWorking(false);
    Alert.alert('Could not make image', message || 'The text could not be turned into an image.');
  }

  function saveAsImage() {
    if (locked.current || isSaved('image') || !text.trim()) return;
    setWorking(true);
    setRendering(true); // Mounts the off-screen renderer, which calls back when done.
  }

  return <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <View style={styles.toolbar}>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>Text editor</Text>
        <Text style={styles.muted}>{text.length.toLocaleString()} characters | UTF-8</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Decrease text size" style={styles.small} onPress={() => setFontSize(Math.max(12, fontSize - 1))}><Text style={styles.smallText}>A-</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Increase text size" style={styles.small} onPress={() => setFontSize(Math.min(26, fontSize + 1))}><Text style={styles.smallText}>A+</Text></Pressable>
    </View>
    <TextInput accessibilityLabel="Document text" style={[styles.editor, { fontSize, lineHeight: fontSize * 1.6 }]}
      value={text} onChangeText={value => {
        if (utf8Size(value) > LIMITS.text) { setLimitNotice(`Text is limited to ${formatSize(LIMITS.text)}. The last change was not applied.`); return; }
        setLimitNotice(''); setText(value); setRevision(current => current + 1);
      }} multiline textAlignVertical="top" autoCorrect={false}
      autoCapitalize="none" editable={!busy} selectionColor={theme.primary} placeholderTextColor={theme.textFaint} />
    <View style={styles.footer}>
      {!!autosave.status && <Text accessibilityLiveRegion="polite" style={styles.muted}>{autosave.status}</Text>}
      {!!limitNotice && <Text accessibilityRole="alert" style={{ color: theme.danger }}>{limitNotice}</Text>}
      <Text style={styles.muted}>Original stays untouched. Save as a new text file, PDF, or image.</Text>
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy || isSaved('text') }} disabled={busy || isSaved('text')} onPress={save} style={[styles.save, (busy || isSaved('text')) && { opacity: 0.5 }]}>
        <Text style={styles.saveText}>{busy ? 'Working...' : saveLabel('text', 'text')}</Text>
      </Pressable>
      <View style={styles.convertRow}>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy || !text.trim() || isSaved('pdf') }} disabled={busy || !text.trim() || isSaved('pdf')} onPress={saveAsPdf} style={[styles.convert, (busy || !text.trim() || isSaved('pdf')) && { opacity: 0.5 }]}>
          <Text style={styles.convertText}>{saveLabel('pdf', 'PDF')}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy || !text.trim() || isSaved('image') }} disabled={busy || !text.trim() || isSaved('image')} onPress={saveAsImage} style={[styles.convert, (busy || !text.trim() || isSaved('image')) && { opacity: 0.5 }]}>
          <Text style={styles.convertText}>{saveLabel('image', 'image')}</Text>
        </Pressable>
      </View>
    </View>
    {rendering && <TextImageRenderer text={text} theme={theme} onResult={onImageRendered} onError={onImageError} />}
  </KeyboardAvoidingView>;
}

function makeStyles(t) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg }, toolbar: { padding: space.lg, flexDirection: 'row', alignItems: 'center', gap: space.sm },
    title: { ...type.title, color: t.text }, muted: { ...type.caption, color: t.textMuted },
    small: { backgroundColor: t.surfaceAlt, borderRadius: radius.sm, paddingHorizontal: space.md, paddingVertical: space.sm, minHeight: 44, justifyContent: 'center' }, smallText: { ...type.label, color: t.text },
    editor: { flex: 1, marginHorizontal: space.lg, padding: space.lg, backgroundColor: t.surface, borderRadius: radius.md, borderWidth: hairline, borderColor: t.border, color: t.text, fontFamily: 'monospace' },
    footer: { padding: space.lg, gap: space.md }, save: { backgroundColor: t.primary, borderRadius: radius.md, padding: space.md, alignItems: 'center', minHeight: 48, justifyContent: 'center' }, saveText: { ...type.label, color: t.primaryText },
    convertRow: { flexDirection: 'row', gap: space.sm },
    convert: { flex: 1, backgroundColor: t.surfaceAlt, borderRadius: radius.md, padding: space.md, alignItems: 'center', minHeight: 48, justifyContent: 'center', borderWidth: hairline, borderColor: t.border },
    convertText: { ...type.label, color: t.text },
  });
}
