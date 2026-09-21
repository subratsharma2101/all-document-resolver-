import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, BackHandler, FlatList, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Sharing from 'expo-sharing';
import ImageEditor from './ImageEditor';
import PdfEditor from './PdfEditor';
import TextEditor from './TextEditor';
import DocumentViewer from './DocumentViewer';
import Licenses from './Licenses';
import { formatSize } from './fileUtils.cjs';
import { ThemeProvider, useTheme } from './theme';
import { FILE_ICON, SunIcon, MoonIcon, ChevronRight } from './icons';
import { cleanOldWorkingFiles, deleteExport, importDocument, keepExport, listExports, pickDocument,
  pickImageBytes, newWorkingFile, removeWorkingFile, saveToFolder, shareExport } from './fileService';
import { buildPdfFromImages } from './conversions.cjs';
import DocumentScanner from 'react-native-document-scanner-plugin';
import { File } from 'expo-file-system';

export default function App() {
  return <SafeAreaProvider><ThemeProvider><Workspace /></ThemeProvider></SafeAreaProvider>;
}

function Workspace() {
  const { theme, mode: themeMode, toggle, ready } = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const [doc, setDoc] = useState(null);
  const [mode, setMode] = useState('view'); // 'view' (read-only) or 'edit'
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('tools');
  const [exports, setExports] = useState([]);
  const [output, setOutput] = useState(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [licensesVisible, setLicensesVisible] = useState(false);
  const opening = useRef(false);
  const shareHandling = useRef(false);
  const initialHandled = useRef(false);

  function refreshExports() {
    try { setExports(listExports()); } catch (e) { setError(e.message); }
  }

  useEffect(() => {
    try { cleanOldWorkingFiles(); } catch { /* Startup must not depend on cache cleanup. */ }
    refreshExports();
  }, []);

  useEffect(() => {
    return () => { if (doc) removeWorkingFile(doc.uri); };
  }, [doc?.uri]);

  async function open(kind, asset) {
    if (opening.current || busy) return;
    opening.current = true;
    setLoading(true);
    setError('');
    try {
      const next = asset ? await importDocument(asset) : await pickDocument(kind);
      if (next) {
        setDoc(next);
        setMode('view');
        setDirty(false);
      }
    } catch (e) { setError(e.message || 'Could not open this file.'); }
    finally { opening.current = false; setLoading(false); }
  }

  function close() {
    if (busy || loading) return;
    const leave = () => { setDoc(null); setMode('view'); setDirty(false); setError(''); };
    if (dirty) Alert.alert('Close this file?', 'Edits not exported will be lost. Saved copies stay in Exports.', [
      { text: 'Keep editing', style: 'cancel' }, { text: 'Close', style: 'destructive', onPress: leave },
    ]);
    else leave();
  }

  // Leave edit mode back to read-only. Warns if there are unexported edits, since
  // the editor unmounts and its working copy is dropped.
  function backToView() {
    if (busy || loading) return;
    const leave = () => { setMode('view'); setDirty(false); setError(''); };
    if (dirty) Alert.alert('Discard edits?', 'Edits not exported will be lost. Saved copies stay in Exports.', [
      { text: 'Keep editing', style: 'cancel' }, { text: 'Discard', style: 'destructive', onPress: leave },
    ]);
    else leave();
  }

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (busy || loading) return true;
      if (doc && mode === 'edit') { backToView(); return true; }
      if (doc) { close(); return true; }
      if (tab !== 'tools') { setTab('tools'); return true; }
      return false;
    });
    return () => subscription.remove();
  }, [doc, mode, dirty, busy, loading, tab]);

  // Open a local file that arrived from another app, with a confirmation when a
  // document is already open. Shared by both the "Share" (SEND) and "Open with"
  // (VIEW) flows so they behave identically.
  function acceptIncoming({ uri, mimeType }) {
    if (!/^(file|content):\/\//i.test(uri || '')) {
      setError('Open a local PDF, image or text file, not a web link.');
      shareHandling.current = false;
      return;
    }
    const run = async () => {
      try { await open(null, { uri, mimeType }); }
      finally { shareHandling.current = false; }
    };
    if (doc) Alert.alert('Open this file?', 'This closes the current document. Export current edits first if needed.', [
      { text: 'Keep current', style: 'cancel', onPress: () => { shareHandling.current = false; } },
      { text: 'Open file', onPress: run },
    ], { cancelable: false });
    else run();
  }

  // Raw share payloads avoid URL resolution/network requests for private files.
  useEffect(() => {
    function receiveShare() {
      if (shareHandling.current || busy || loading) return;
      let payloads;
      try { payloads = Sharing.getSharedPayloads(); } catch { return; }
      if (!payloads.length) return;
      const payload = payloads.find(item => /^(file|content):\/\//i.test(item.value || ''));
      Sharing.clearSharedPayloads();
      if (!payload) { setError('Share a local PDF, image or text file, not a web link.'); return; }
      shareHandling.current = true;
      acceptIncoming({ uri: payload.value, mimeType: payload.mimeType });
    }
    // "Open with" (VIEW intent) delivers the file URI through Linking, not share payloads.
    function receiveUrl(url) {
      if (shareHandling.current || busy || loading || !url) return;
      if (!/^(file|content):\/\//i.test(url)) return; // Ignore the app's own scheme/deep links.
      shareHandling.current = true;
      acceptIncoming({ uri: url });
    }
    receiveShare();
    if (!initialHandled.current) {
      initialHandled.current = true;
      Linking.getInitialURL().then(receiveUrl).catch(() => {});
    }
    const subscription = Linking.addEventListener('url', event => {
      // A share may piggyback on the url event; check payloads first, then a raw file URL.
      receiveShare();
      if (!shareHandling.current) receiveUrl(event?.url);
    });
    return () => subscription.remove();
  }, [doc, busy, loading]);

  async function exportCopy(result) {
    const saved = await keepExport(result);
    refreshExports();
    setOutput(saved);
    setNotice('Saved privately in the app. Save to a folder to keep it outside the app.');
  }

  // Pick several images and combine them into one PDF, one image per page.
  async function imagesToPdf() {
    if (opening.current || busy || loading) return;
    opening.current = true;
    setLoading(true);
    setError('');
    let picked;
    try {
      picked = await pickImageBytes();
    } catch (e) {
      setError(e.message || 'Could not open those images.');
      opening.current = false; setLoading(false);
      return;
    }
    if (!picked || picked.length === 0) { opening.current = false; setLoading(false); return; }
    const file = newWorkingFile('images.pdf');
    try {
      const bytes = await buildPdfFromImages(picked.map(item => item.bytes));
      file.write(bytes);
      const saved = await keepExport({ uri: file.uri, name: 'images.pdf', mimeType: 'application/pdf' });
      refreshExports();
      setOutput(saved);
      setNotice(`Made a PDF from ${picked.length} image${picked.length === 1 ? '' : 's'}. Save it to a folder to keep it.`);
    } catch (e) {
      setError(e.message || 'Could not make a PDF from those images.');
    } finally {
      removeWorkingFile(file.uri);
      opening.current = false;
      setLoading(false);
    }
  }

  // Open the native ML Kit scanner, then combine the scanned pages into one PDF.
  // Scanning uses the device camera and Google Play Services; the scan model is
  // fetched by the OS, not bundled in the app.
  async function scanToPdf() {
    if (opening.current || busy || loading) return;
    opening.current = true;
    setError('');
    let scanned;
    try {
      const result = await DocumentScanner.scanDocument({ croppedImageQuality: 100 });
      if (result.status !== 'success' || !result.scannedImages?.length) { opening.current = false; return; }
      scanned = result.scannedImages;
    } catch (e) {
      setError(e?.message || 'The scanner could not start. Make sure camera permission is granted.');
      opening.current = false;
      return;
    }
    setLoading(true);
    const file = newWorkingFile('scan.pdf');
    try {
      const images = [];
      for (const path of scanned) {
        const uri = /^\w+:\/\//.test(path) ? path : `file://${path}`;
        const source = new File(uri);
        if (source.exists) images.push(await source.bytes());
      }
      const bytes = await buildPdfFromImages(images);
      file.write(bytes);
      const saved = await keepExport({ uri: file.uri, name: 'scan.pdf', mimeType: 'application/pdf' });
      refreshExports();
      setOutput(saved);
      setNotice(`Scanned ${scanned.length} page${scanned.length === 1 ? '' : 's'} into a PDF. Save it to a folder to keep it.`);
    } catch (e) {
      setError(e.message || 'Could not turn the scan into a PDF.');
    } finally {
      removeWorkingFile(file.uri);
      opening.current = false;
      setLoading(false);
    }
  }

  async function sendOutput(action) {
    if (exportBusy) return;
    setExportBusy(true);
    try {
      if (action === 'folder') {
        const saved = await saveToFolder(output);
        setNotice(saved ? 'Copy saved to your selected folder.' : 'Folder save canceled. Your app copy is still in Exports.');
      } else {
        await shareExport(output);
        setNotice('Share sheet closed. Your app copy is still in Exports.');
      }
    } catch (e) { setNotice(e.message || 'Export failed. Your app copy is safe.'); }
    finally { setExportBusy(false); }
  }

  if (!ready) return <View style={[styles.root, styles.center]}><ActivityIndicator color={theme.primary} size="large" /></View>;

  const editorProps = { doc, onExport: exportCopy, onBusyChange: setBusy, onDirtyChange: setDirty };
  const kindColor = doc ? theme.accents[doc.kind] || theme.primary : theme.primary;

  return <SafeAreaView style={styles.root}>
    <StatusBar style={theme.statusBar} />
    <View style={styles.header}>
      <View style={{ flex: 1 }}>
        <Text style={styles.brand} numberOfLines={1}>{doc ? doc.name : 'File Viewer'}</Text>
        <Text style={styles.caption}>{doc ? `${doc.kind.toUpperCase()} · ${formatSize(doc.size)} · ${mode === 'view' ? 'read-only' : 'original protected'}` : 'YOUR FILES. YOUR DEVICE.'}</Text>
      </View>
      {doc && mode === 'view' && <Button styles={styles} label="Edit" onPress={() => { setError(''); setMode('edit'); }} disabled={busy || loading} />}
      {doc && mode === 'edit' && <Button styles={styles} label="View" onPress={backToView} disabled={busy || loading} quiet />}
      {doc && <Button styles={styles} label="Close" onPress={close} disabled={busy || loading} quiet />}
      {!doc && <Pressable accessibilityRole="button" accessibilityLabel={`Switch to ${themeMode === 'light' ? 'dark' : 'light'} theme`} onPress={toggle} style={styles.themeToggle}>
        {themeMode === 'light' ? <MoonIcon color={theme.text} /> : <SunIcon color={theme.text} />}
      </Pressable>}
    </View>
    {!!error && <View accessibilityRole="alert" style={styles.errorBox}><Text style={styles.error}>{error}</Text><Button styles={styles} label="Dismiss" onPress={() => setError('')} quiet /></View>}
    {loading ? <View style={styles.center}><ActivityIndicator color={theme.primary} size="large" /><Text style={styles.muted}>Opening a safe working copy...</Text></View> :
      doc ? <View style={{ flex: 1 }} key={`${doc.uri}-${mode}`}>{mode === 'view' ? <DocumentViewer doc={doc} /> :
        doc.kind === 'image' ? <ImageEditor {...editorProps} /> :
        doc.kind === 'pdf' ? <PdfEditor {...editorProps} /> : <TextEditor {...editorProps} />}</View> :
      tab === 'tools' ? <ScrollView contentContainerStyle={styles.home} showsVerticalScrollIndicator={false}>
        <Text style={styles.eyebrow}>THE EVERYDAY FILE TOOLKIT</Text>
        <Text style={styles.hero}>Less file hassle.{'\n'}More getting done.</Text>
        <Text style={styles.intro}>Read, refine and export. No account, no uploads, no changes to your original.</Text>
        <Button styles={styles} label="Open a file" onPress={() => open()} />
        <Text style={styles.sectionLabel}>TOOLS</Text>
        <ToolCard styles={styles} theme={theme} kind="image" title="Image studio" detail="Compress and convert. A smaller file, a clearer result." onPress={() => open('image')} />
        <ToolCard styles={styles} theme={theme} kind="pdf" title="PDF workspace" detail="Organize pages, add text and sign." onPress={() => open('pdf')} />
        <ToolCard styles={styles} theme={theme} kind="text" title="Text desk" detail="Read it, edit it, save as text, PDF or image." onPress={() => open('text')} />
        <Text style={styles.sectionLabel}>SCAN & CONVERT</Text>
        <ToolCard styles={styles} theme={theme} kind="image" title="Scan document" detail="Use the camera to scan pages into a clean PDF." onPress={scanToPdf} />
        <ToolCard styles={styles} theme={theme} kind="pdf" title="Images to PDF" detail="Pick several photos and combine them into one PDF." onPress={imagesToPdf} />
        <View style={styles.note}><Text style={styles.noteTitle}>Built for local files</Text><Text style={styles.muted}>JPG, PNG, WebP, PDF and UTF-8 text. Other images depend on your device. PDF tools add content; they do not replace existing text or securely redact it.</Text></View>
        <Button styles={styles} label="Free libraries & licenses" quiet onPress={() => setLicensesVisible(true)} />
      </ScrollView> : <FlatList data={exports} keyExtractor={item => item.uri} contentContainerStyle={styles.exports}
        ListHeaderComponent={<View style={{ gap: 8, marginBottom: 20 }}><Text style={styles.hero}>Your exports</Text><Text style={styles.muted}>Private app copies. Uninstalling the app removes these files, so save important copies to a folder.</Text></View>}
        ListEmptyComponent={<View style={styles.note}><Text style={styles.noteTitle}>A clean desk.</Text><Text style={styles.muted}>Export an edited image, PDF or text file and it will appear here.</Text></View>}
        renderItem={({ item }) => { const Icon = FILE_ICON[item.kind] || FILE_ICON.text; return <View style={styles.exportRow}>
          <View style={[styles.exportIcon, { backgroundColor: (theme.accents[item.kind] || theme.primary) + '22' }]}><Icon color={theme.accents[item.kind] || theme.primary} size={22} /></View>
          <Pressable accessibilityRole="button" accessibilityLabel={`Open ${item.name}`} style={{ flex: 1, gap: 4 }} onPress={() => open(null, item)}><Text style={styles.fileName} numberOfLines={1}>{item.name}</Text><Text style={styles.muted}>{formatSize(item.size)}</Text></Pressable>
          <Button styles={styles} label="Export" quiet onPress={() => { setOutput(item); setNotice('Choose where this copy goes.'); }} />
          <Button styles={styles} label="Delete" quiet onPress={() => Alert.alert('Delete app copy?', 'Copies saved to other folders are not affected.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => { try { deleteExport(item.uri); refreshExports(); } catch (e) { setError(e.message); } } }])} />
        </View>; }} />}
    {!doc && !loading && <View style={styles.nav}><NavTab styles={styles} label="Toolkit" selected={tab === 'tools'} onPress={() => setTab('tools')} /><NavTab styles={styles} label={`Exports (${exports.length})`} selected={tab === 'exports'} onPress={() => { refreshExports(); setTab('exports'); }} /></View>}
    <Modal visible={!!output} transparent animationType="slide" onRequestClose={() => { if (!exportBusy) setOutput(null); }}>
      <View style={styles.scrim}><SafeAreaView edges={['bottom']} style={styles.sheet}>
        <View style={styles.sheetHandle} />
        <Text style={styles.eyebrow}>COPY READY</Text><Text style={styles.sheetTitle} numberOfLines={2}>{output?.name}</Text>
        <Text style={styles.muted}>{formatSize(output?.size)}</Text><Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text>
        {exportBusy ? <ActivityIndicator color={theme.primary} /> : <><Button styles={styles} label={Platform.OS === 'android' ? 'Save to folder' : 'Save / Share'} onPress={() => sendOutput('folder')} /><Button styles={styles} label="Share with another app" onPress={() => sendOutput('share')} quiet /><Button styles={styles} label="Back to editing" onPress={() => setOutput(null)} quiet /></>}
      </SafeAreaView></View>
    </Modal>
    <Licenses visible={licensesVisible} onClose={() => setLicensesVisible(false)} />
  </SafeAreaView>;
}

function Button({ label, onPress, disabled, quiet, styles }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} onPress={onPress} disabled={disabled} style={({ pressed }) => [quiet ? styles.quietButton : styles.button, (pressed || disabled) && { opacity: 0.55 }]}><Text style={quiet ? styles.quietLabel : styles.buttonLabel}>{label}</Text></Pressable>;
}
function ToolCard({ kind, title, detail, onPress, styles, theme }) {
  const Icon = FILE_ICON[kind];
  const accent = theme.accents[kind] || theme.primary;
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.card, pressed && { opacity: 0.7 }]}>
    <View style={[styles.cardIcon, { backgroundColor: accent + '22' }]}><Icon color={accent} size={28} /></View>
    <View style={{ flex: 1, gap: 4 }}><Text style={styles.cardTitle}>{title}</Text><Text style={styles.muted}>{detail}</Text></View>
    <ChevronRight color={theme.textFaint} />
  </Pressable>;
}
function NavTab({ label, selected, onPress, styles }) {
  return <Pressable accessibilityRole="tab" accessibilityState={{ selected }} onPress={onPress} style={[styles.navTab, selected && styles.navSelected]}><Text style={selected ? styles.navTextOn : styles.navText}>{label}</Text></Pressable>;
}

function makeStyles(t) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg },
    header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 18, paddingVertical: 16, borderBottomWidth: 1, borderColor: t.border, backgroundColor: t.surface },
    brand: { color: t.text, fontWeight: '700', fontSize: 20 }, caption: { color: t.textMuted, fontSize: 10, letterSpacing: 1, marginTop: 5 },
    themeToggle: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: t.surfaceAlt },
    home: { padding: 22, gap: 14, width: '100%', maxWidth: 760, alignSelf: 'center' },
    eyebrow: { color: t.primary, fontSize: 10, letterSpacing: 2, fontWeight: '700', marginTop: 8 },
    hero: { color: t.text, fontSize: 32, lineHeight: 38, fontWeight: '800', letterSpacing: -0.8 }, intro: { color: t.textMuted, fontSize: 15, lineHeight: 23, marginBottom: 4 },
    sectionLabel: { color: t.textFaint, fontSize: 10, letterSpacing: 1.6, fontWeight: '700', marginTop: 12, marginBottom: 2 },
    button: { padding: 16, backgroundColor: t.primary, borderRadius: 14, alignItems: 'center', minHeight: 50 }, buttonLabel: { color: t.primaryText, fontSize: 15, fontWeight: '700' },
    quietButton: { paddingHorizontal: 12, paddingVertical: 13, minHeight: 44, alignItems: 'center', justifyContent: 'center' }, quietLabel: { color: t.primary, fontWeight: '600', fontSize: 13 },
    card: { padding: 16, backgroundColor: t.card, borderRadius: 16, flexDirection: 'row', gap: 14, alignItems: 'center', borderWidth: 1, borderColor: t.border, shadowColor: t.shadow, shadowOpacity: 1, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 1 },
    cardIcon: { width: 52, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
    cardTitle: { color: t.text, fontSize: 18, fontWeight: '700' },
    note: { padding: 16, gap: 8, borderRadius: 14, backgroundColor: t.surfaceAlt, marginTop: 8 }, noteTitle: { color: t.text, fontSize: 15, fontWeight: '600' }, muted: { color: t.textMuted, fontSize: 12.5, lineHeight: 19 },
    nav: { flexDirection: 'row', borderTopWidth: 1, borderColor: t.border, padding: 8, gap: 8, backgroundColor: t.surface }, navTab: { flex: 1, alignItems: 'center', paddingVertical: 14, borderRadius: 12 }, navSelected: { backgroundColor: t.surfaceAlt },
    navText: { color: t.textMuted, fontWeight: '600' }, navTextOn: { color: t.text, fontWeight: '700' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 }, errorBox: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, backgroundColor: t.dangerBg }, error: { flex: 1, color: t.danger, lineHeight: 20, fontSize: 13 },
    exports: { padding: 20, flexGrow: 1 }, exportRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderColor: t.border },
    exportIcon: { width: 40, height: 40, borderRadius: 11, alignItems: 'center', justifyContent: 'center' }, fileName: { color: t.text, fontSize: 15, fontWeight: '600' },
    scrim: { flex: 1, backgroundColor: t.scrim, justifyContent: 'flex-end' }, sheet: { backgroundColor: t.surface, padding: 24, borderTopLeftRadius: 26, borderTopRightRadius: 26, gap: 10, maxHeight: '90%' },
    sheetHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: t.border, marginBottom: 8 },
    sheetTitle: { fontSize: 20, fontWeight: '700', color: t.text }, notice: { color: t.textMuted, fontSize: 14, lineHeight: 22, marginVertical: 6 },
  });
}
