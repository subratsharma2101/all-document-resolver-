import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTheme, hairline, radius, space, type } from './theme';
import { ActionButton, AppIcon } from './workspaceUi';
import { keepExport, newWorkingFile, pickDocument, removeWorkingFile } from './fileService';
import { requireFileTools, nativeToolsAvailable } from './nativeFileTools';
import { exportPdfImages, parseToolPages, recognizeDocument } from './documentJobs';
import { File } from 'expo-file-system';

export default function DocumentTools({ mode, onBusyChange, onTextReady, onSave, onExportsChanged }) {
  const { theme: t } = useTheme(), s = styles(t), ocr = mode === 'ocr';
  const [doc, setDoc] = useState(null), [count, setCount] = useState(0), [range, setRange] = useState('1');
  const [language, setLanguage] = useState('devanagari'), [format, setFormat] = useState('jpg');
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState(''), [error, setError] = useState('');
  const [recognized, setRecognized] = useState(null), [outputs, setOutputs] = useState([]), [notice, setNotice] = useState('');
  const locked = useRef(false), cancelled = useRef(false), owned = useRef(null), cache = useRef(new Map());
  const lastRecognition = useRef(null);
  useEffect(() => () => { if (owned.current) removeWorkingFile(owned.current); }, []);
  const working = value => { locked.current = value; setBusy(value); onBusyChange?.(value); };
  async function choose(kind) {
    if (locked.current) return;
    working(true); setError('');
    let picked;
    try {
      const native = requireFileTools();
      picked = await pickDocument(kind);
      if (!picked) return;
      const info = picked.kind === 'pdf' ? await native.pdfInfo(picked.uri) : { pageCount: 1 };
      if (owned.current) removeWorkingFile(owned.current);
      owned.current = picked.uri; setDoc(picked); setCount(info.pageCount); setRange('1');
      setRecognized(null); lastRecognition.current = null; setOutputs([]); cache.current = new Map(); setNotice(''); picked = null;
    } catch (failure) { setError(failure.message); }
    finally { if (picked) removeWorkingFile(picked.uri); working(false); }
  }
  async function run() {
    if (locked.current || !doc) return;
    working(true); cancelled.current = false; setError(''); setNotice('');
    try {
      const pages = doc.kind === 'pdf' ? parseToolPages(range, count, ocr ? 20 : 30) : [1];
      const options = { cancelled: () => cancelled.current, progress: setProgress, cache: cache.current };
      if (ocr) {
        const key = JSON.stringify([doc.uri, pages, language]), previous = lastRecognition.current;
        setRecognized(null);
        const result = previous?.key === key && previous.result.completed === pages.length && !previous.result.error && !previous.result.cancelled
          ? previous.result : await recognizeDocument(doc, pages, language, options);
        if (result.error) setError(result.error);
        if (!result.text) { setNotice(result.cancelled ? 'Recognition cancelled.' : 'No text found. Try a sharper scan or change the language.'); return; }
        const name = doc.name.replace(/\.[^.]+$/, '') + '-text.txt';
        setRecognized({ text: result.text, name });
        let file;
        try {
          let saved = previous?.key === key && previous.result.text === result.text ? previous.saved : null;
          if (!saved || !new File(saved.uri).exists) {
            file = newWorkingFile(name); file.write(result.text);
            saved = await keepExport({ uri: file.uri, name, mimeType: 'text/plain' });
          }
          lastRecognition.current = { key, result, saved };
          setRecognized({ text: result.text, name, saved }); onExportsChanged?.();
        } finally { if (file) removeWorkingFile(file.uri); }
        setNotice(`${result.completed} of ${result.total} pages processed. Review the text before using it.`);
      } else {
        const result = await exportPdfImages(doc, pages, format, options);
        setOutputs(result.outputs); onExportsChanged?.();
        if (result.error) setError(result.error);
        setNotice(`${result.completed} of ${result.total} pages ready${result.cancelled ? ' · stopped' : ''}.`);
        if (result.outputs.length) await onSave(result.outputs);
      }
    } catch (failure) { setError(failure.message || 'The operation could not finish.'); }
    finally { setProgress(''); working(false); }
  }
  async function useText() {
    if (locked.current || !recognized) return;
    working(true); setError('');
    try { await onTextReady(recognized.text, recognized.name); }
    catch (failure) { setError(failure.message); }
    finally { working(false); }
  }
  async function saveResult() {
    if (locked.current) return;
    const copies = ocr ? recognized?.saved ? [recognized.saved] : [] : outputs;
    if (!copies.length) return;
    working(true);
    try { await onSave(copies); } catch (failure) { setError(failure.message); }
    finally { working(false); }
  }
  return <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
    <View style={s.hero}><Text accessibilityRole="header" style={s.title}>{ocr ? 'Scan to text' : 'PDF to images'}</Text><Text style={s.body}>{ocr ? 'Extract printed Hindi or English text, then edit, copy or save it.' : 'Choose the pages you need and save clear JPG or PNG copies.'}</Text></View>
    {!nativeToolsAvailable && <Text style={s.warning}>These tools need the updated Android app. They are unavailable in Expo Go and older builds.</Text>}
    <View style={s.row}><ActionButton label={ocr ? 'Choose image' : 'Choose PDF'} icon="folder" onPress={() => choose(ocr ? 'image' : 'pdf')} disabled={busy || !nativeToolsAvailable} style={{ flex: 1 }} />{ocr && <ActionButton label="Choose PDF" icon="folder" quiet onPress={() => choose('pdf')} disabled={busy || !nativeToolsAvailable} style={{ flex: 1 }} />}</View>
    {doc && <View style={s.card}><Text style={s.fileName} numberOfLines={2}>{doc.name}</Text><Text style={s.body}>{doc.kind === 'pdf' ? `${count} pages` : 'Image selected'}</Text>
      {doc.kind === 'pdf' && <><Text style={s.label}>Pages to {ocr ? 'recognize' : 'convert'}</Text><TextInput accessibilityLabel="Pages to process" value={range} onChangeText={setRange} editable={!busy} placeholder="1-3,5" placeholderTextColor={t.textFaint} style={s.input} /><Text style={s.hint}>Up to {ocr ? 20 : 30} pages per batch. Example: 1-3,5.</Text></>}
      <Text style={s.label}>{ocr ? 'Recognition language' : 'Image format'}</Text><View style={s.row}>{(ocr ? [['devanagari', 'Hindi'], ['latin', 'English']] : [['jpg', 'JPG'], ['png', 'PNG']]).map(([value, label]) => {
        const selected = (ocr ? language : format) === value;
        return <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected, disabled: busy }} disabled={busy} onPress={() => ocr ? setLanguage(value) : setFormat(value)} style={[s.choice, selected && { backgroundColor: t.primary }]}><Text style={{ ...type.label, color: selected ? t.primaryText : t.text }}>{label}</Text></Pressable>;
      })}</View>
      <ActionButton label={ocr ? 'Recognize text' : 'Convert and save'} onPress={run} disabled={busy} icon={ocr ? 'scan' : 'download'} />
    </View>}
    {busy && <View style={s.card}><ActivityIndicator color={t.primary} /><Text accessibilityLiveRegion="polite" style={s.body}>{progress || 'Working…'}</Text>{!!progress && <ActionButton label="Stop after this page" quiet onPress={() => { cancelled.current = true; setNotice('Stopping after the current page finishes.'); }} />}</View>}
    {!!error && <Text accessibilityRole="alert" style={s.warning}>{error}</Text>}{!!notice && <Text accessibilityLiveRegion="polite" style={s.body}>{notice}</Text>}
    {recognized && <View style={s.card}><Text style={s.label}>Recognized text</Text><Text selectable style={s.preview}>{recognized.text.slice(0, 3000)}{recognized.text.length > 3000 ? '\n… Open the editor to see all text.' : ''}</Text><ActionButton label="Edit recognized text" onPress={useText} disabled={busy} /><ActionButton label="Save text to phone" quiet icon="download" onPress={saveResult} disabled={busy || !recognized.saved} /></View>}
    {!ocr && !!outputs.length && <ActionButton label="Save ready images" quiet onPress={saveResult} disabled={busy} />}
  </ScrollView>;
}
function styles(t) {
  return StyleSheet.create({
    content: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl, width: '100%', maxWidth: 760, alignSelf: 'center' },
    hero: { gap: space.xs, paddingTop: space.xs },
    title: { ...type.display, color: t.text },
    body: { ...type.caption, color: t.textMuted },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
    card: { padding: space.lg, gap: space.md, backgroundColor: t.surface, borderWidth: hairline, borderColor: t.border, borderRadius: radius.md },
    fileName: { ...type.heading, color: t.text },
    label: { ...type.label, color: t.text },
    hint: { ...type.caption, color: t.textFaint },
    input: { backgroundColor: t.bg, borderWidth: hairline, borderColor: t.border, color: t.text, borderRadius: radius.sm, padding: space.md, minHeight: 48, ...type.body },
    choice: { paddingHorizontal: space.lg, minHeight: 46, borderRadius: radius.sm, backgroundColor: t.surfaceAlt, justifyContent: 'center' },
    warning: { ...type.caption, color: t.danger, backgroundColor: t.dangerBg, padding: space.md, borderRadius: radius.sm },
    preview: { ...type.body, color: t.text },
  });
}
