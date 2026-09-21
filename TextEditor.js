import { useEffect, useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { newWorkingFile, removeWorkingFile } from './fileService';
import { copyName, formatSize, utf8Size, LIMITS } from './fileUtils.cjs';
import { buildPdfFromText } from './conversions.cjs';
import TextImageRenderer from './TextImageRenderer';
import { useTheme } from './theme';

// Swap a filename's extension, e.g. notes.txt -> notes.pdf.
function withExtension(name, ext) {
  const clean = copyName(name);
  const dot = clean.lastIndexOf('.');
  return `${dot > 0 ? clean.slice(0, dot) : clean}.${ext}`;
}

export default function TextEditor({ doc, onExport, onDirtyChange, onBusyChange }) {
  const { theme } = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [text, setText] = useState(doc.text || '');
  const [busy, setBusy] = useState(false);
  const [fontSize, setFontSize] = useState(15);
  const [limitNotice, setLimitNotice] = useState('');
  const [rendering, setRendering] = useState(false); // true while the text->image WebView runs
  const dirty = text !== (doc.text || '');
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  const setWorking = (value) => { setBusy(value); onBusyChange?.(value); };

  async function save() {
    if (busy) return;
    setWorking(true);
    const file = newWorkingFile(copyName(doc.name));
    try {
      file.write(text);
      await onExport({ uri: file.uri, name: copyName(doc.name), mimeType: doc.mimeType || 'text/plain' });
    } catch (error) {
      Alert.alert('Could not export', error.message);
    } finally {
      removeWorkingFile(file.uri);
      setWorking(false);
    }
  }

  async function saveAsPdf() {
    if (busy || !text.trim()) return;
    setWorking(true);
    const file = newWorkingFile(withExtension(doc.name, 'pdf'));
    try {
      const bytes = await buildPdfFromText(text);
      file.write(bytes);
      await onExport({ uri: file.uri, name: withExtension(doc.name, 'pdf'), mimeType: 'application/pdf' });
    } catch (error) {
      Alert.alert('Could not make PDF', error.message);
    } finally {
      removeWorkingFile(file.uri);
      setWorking(false);
    }
  }

  // The image itself is produced off-screen by TextImageRenderer; these handlers
  // receive the base64 PNG (or an error) and finish the export.
  async function onImageRendered(base64) {
    setRendering(false);
    const file = newWorkingFile(withExtension(doc.name, 'png'));
    try {
      file.write(base64, { encoding: 'base64' });
      await onExport({ uri: file.uri, name: withExtension(doc.name, 'png'), mimeType: 'image/png' });
    } catch (error) {
      Alert.alert('Could not make image', error.message);
    } finally {
      removeWorkingFile(file.uri);
      setWorking(false);
    }
  }

  function onImageError(message) {
    setRendering(false);
    setWorking(false);
    Alert.alert('Could not make image', message || 'The text could not be turned into an image.');
  }

  function saveAsImage() {
    if (busy || !text.trim()) return;
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
        setLimitNotice(''); setText(value);
      }} multiline textAlignVertical="top" autoCorrect={false}
      autoCapitalize="none" editable={!busy} selectionColor={theme.primary} placeholderTextColor={theme.textFaint} />
    <View style={styles.footer}>
      {!!limitNotice && <Text accessibilityRole="alert" style={{ color: theme.danger }}>{limitNotice}</Text>}
      <Text style={styles.muted}>Original stays untouched. Save as a new text file, PDF, or image.</Text>
      <Pressable accessibilityRole="button" disabled={busy} onPress={save} style={[styles.save, busy && { opacity: 0.5 }]}>
        <Text style={styles.saveText}>{busy ? 'Working...' : 'Save a copy'}</Text>
      </Pressable>
      <View style={styles.convertRow}>
        <Pressable accessibilityRole="button" disabled={busy || !text.trim()} onPress={saveAsPdf} style={[styles.convert, (busy || !text.trim()) && { opacity: 0.5 }]}>
          <Text style={styles.convertText}>Save as PDF</Text>
        </Pressable>
        <Pressable accessibilityRole="button" disabled={busy || !text.trim()} onPress={saveAsImage} style={[styles.convert, (busy || !text.trim()) && { opacity: 0.5 }]}>
          <Text style={styles.convertText}>Save as image</Text>
        </Pressable>
      </View>
    </View>
    {rendering && <TextImageRenderer text={text} theme={theme} onResult={onImageRendered} onError={onImageError} />}
  </KeyboardAvoidingView>;
}

function makeStyles(t) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg }, toolbar: { padding: 16, flexDirection: 'row', alignItems: 'center', gap: 8 },
    title: { color: t.text, fontSize: 19, fontWeight: '700' }, muted: { color: t.textMuted, fontSize: 12, lineHeight: 18 },
    small: { backgroundColor: t.surfaceAlt, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11, minHeight: 44, justifyContent: 'center' }, smallText: { color: t.text, fontWeight: '700' },
    editor: { flex: 1, marginHorizontal: 16, padding: 16, backgroundColor: t.surface, borderRadius: 14, borderWidth: 1, borderColor: t.border, color: t.text, fontFamily: 'monospace' },
    footer: { padding: 16, gap: 12 }, save: { backgroundColor: t.primary, borderRadius: 14, padding: 15, alignItems: 'center', minHeight: 50, justifyContent: 'center' }, saveText: { color: t.primaryText, fontWeight: '700', fontSize: 15 },
    convertRow: { flexDirection: 'row', gap: 10 },
    convert: { flex: 1, backgroundColor: t.surfaceAlt, borderRadius: 14, padding: 14, alignItems: 'center', minHeight: 48, justifyContent: 'center', borderWidth: 1, borderColor: t.border },
    convertText: { color: t.text, fontWeight: '600', fontSize: 14 },
  });
}
