import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, BackHandler, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Sharing from 'expo-sharing';
import ImageEditor from './ImageEditor';
import PdfEditor from './PdfEditor';
import TextEditor from './TextEditor';
import DocumentViewer from './ReadingViewer';
import Licenses from './Licenses';
import PrivacyInfo from './PrivacyInfo';
import AppErrorBoundary from './AppErrorBoundary';
import { formatSize } from './fileUtils.cjs';
import { ThemeProvider, hairline, pressedOpacity, radius, rippleFor, space, type, useTheme } from './theme';
import { SunIcon, MoonIcon } from './icons';
import Dashboard from './Dashboard';
import FilesScreen from './FilesScreen';
import ToolsScreen from './ToolsScreen';
import DocumentTools from './DocumentTools';
import { AppIcon, BrandMark, Banner, FileListSkeleton, IconButton, MenuSheet } from './workspaceUi';
import { listLibrary, rememberDocument, removeLibraryDocument, renameLibraryDocument, setLibraryFavorite } from './fileLibrary';
import { discardDraft, listDrafts } from './draftStorage';
import { cleanOldWorkingFiles, deleteExport, importDocument, keepExport, listExports, pickDocument,
  pickImageBytes, newWorkingFile, removeWorkingFile, shareExport } from './fileService';
import { chooseSaveFolder, getSaveFolder, saveOutputsToPhone } from './phoneStorage';
import { buildPdfFromImages, MAX_CONVERT_IMAGES } from './conversions.cjs';
import { exportScannedPages } from './scanExport';
import DocumentScanner from 'react-native-document-scanner-plugin';

export default function App() {
  return <AppErrorBoundary><SafeAreaProvider><ThemeProvider><Workspace /></ThemeProvider></SafeAreaProvider></AppErrorBoundary>;
}

function Workspace() {
  const { theme, mode: themeMode, toggle, ready } = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const [doc, setDoc] = useState(null);
  const [mode, setMode] = useState('view'); // 'view' (read-only) or 'edit'
  const [loading, setLoading] = useState(false);
  const [scanProgress, setScanProgress] = useState('');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const [drafts, setDrafts] = useState([]);
  const [activeTool, setActiveTool] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('home');
  const [recent, setRecent] = useState([]);
  const [filesKind, setFilesKind] = useState('all');
  const [filesCollection, setFilesCollection] = useState('recent');
  const [exports, setExports] = useState([]);
  const [exportBusy, setExportBusy] = useState(false);
  const [saveBanner, setSaveBanner] = useState(null);
  const [saveFolder, setSaveFolder] = useState(getSaveFolder);
  const [viewSaved, setViewSaved] = useState(false);
  const [licensesVisible, setLicensesVisible] = useState(false);
  const [privacyVisible, setPrivacyVisible] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [viewerActions, setViewerActions] = useState([]);
  const opening = useRef(false);
  const saving = useRef(false);
  const shareHandling = useRef(false);
  const initialHandled = useRef(false);
  const pendingIncoming = useRef(null);

  function refreshExports() {
    try { setExports(listExports()); setRecent(listLibrary()); setDrafts(listDrafts()); } catch (e) { setError(e.message); }
  }

  useEffect(() => {
    try { cleanOldWorkingFiles(); } catch { /* Startup must not depend on cache cleanup. */ }
    refreshExports();
  }, []);

  useEffect(() => {
    return () => { if (doc) removeWorkingFile(doc.uri); };
  }, [doc?.uri]);

  async function open(kind, asset, resume = false) {
    if (opening.current || saving.current || busy) return;
    opening.current = true;
    setLoading(true);
    setError('');
    try {
      const next = asset ? await importDocument(asset) : await pickDocument(kind);
      if (next) {
        try {
          const remembered = await rememberDocument(next);
          next.libraryId = remembered.id;
          next.name = remembered.name;
          setRecent(listLibrary());
        } catch (e) { setError(e.message || 'This file is open, but could not be kept in My Files.'); }
        setDoc(next);
        setActiveTool(null);
        setMode(resume ? 'edit' : 'view');
        setDraftReady(false);
        setDirty(false);
        setViewSaved(false);
      }
    } catch (e) { setError(e.message || 'Could not open this file.'); }
    finally { opening.current = false; setLoading(false); }
  }

  function close() {
    if (busy || loading || saving.current) return;
    const leave = () => { setDoc(null); setMode('view'); setDirty(false); setError(''); refreshExports(); };
    if (dirty && !draftReady) Alert.alert('Close this file?', 'The latest edits are not yet backed up in a draft. Wait for Draft saved to keep them for later.', [
      { text: 'Keep editing', style: 'cancel' }, { text: 'Close', style: 'destructive', onPress: leave },
    ]);
    else leave();
  }

  // Leave edit mode back to read-only. Warns if there are unexported edits, since
  // the editor unmounts and its working copy is dropped.
  function backToView() {
    if (busy || loading || saving.current) return;
    const leave = () => { setMode('view'); setDirty(false); setError(''); refreshExports(); };
    if (dirty && !draftReady) Alert.alert('Leave the editor?', 'The latest edits are not yet backed up in a draft. Wait for Draft saved to keep them for later.', [
      { text: 'Keep editing', style: 'cancel' }, { text: 'View original', onPress: leave },
    ]);
    else leave();
  }

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (busy || loading || saving.current) return true;
      if (menuOpen) { setMenuOpen(false); return true; }
      if (doc && mode === 'edit') { backToView(); return true; }
      if (doc) { close(); return true; }
      if (activeTool) { setActiveTool(null); return true; }
      if (tab !== 'home') { setTab('home'); return true; }
      return false;
    });
    return () => subscription.remove();
  }, [doc, mode, dirty, draftReady, busy, loading, exportBusy, tab, activeTool, menuOpen]);

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
      if (shareHandling.current || busy || loading || saving.current) return;
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
      if (!url) return;
      if (!/^(file|content):\/\//i.test(url)) return; // Ignore the app's own scheme/deep links.
      if (shareHandling.current || busy || loading || opening.current || saving.current) { pendingIncoming.current = url; return; }
      shareHandling.current = true;
      acceptIncoming({ uri: url });
    }
    receiveShare();
    if (pendingIncoming.current && !shareHandling.current && !busy && !loading && !opening.current && !saving.current) {
      const url = pendingIncoming.current; pendingIncoming.current = null; receiveUrl(url);
    }
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
  }, [doc, busy, loading, exportBusy]);

  async function exportCopy(result) {
    const saved = await keepExport(result);
    refreshExports();
    const outcome = await saveCopies([saved]);
    return { ...saved, saveMessage: outcome.message, saveStatus: outcome.status };
  }

  // Pick several images and combine them into one PDF, one image per page.
  async function imagesToPdf() {
    if (opening.current || saving.current || busy || loading) return;
    opening.current = true;
    setLoading(true);
    setError('');
    let file;
    try {
      const picked = await pickImageBytes();
      if (!picked?.length) return;
      file = newWorkingFile('images.pdf');
      const bytes = await buildPdfFromImages(picked.map(item => item.bytes));
      file.write(bytes);
      await exportCopy({ uri: file.uri, name: 'images.pdf', mimeType: 'application/pdf' });
    } catch (e) {
      setError(e.message || 'Could not make a PDF from those images.');
    } finally {
      if (file) removeWorkingFile(file.uri);
      opening.current = false;
      setLoading(false);
    }
  }

  // Let the user choose image copies or one PDF after reviewing the native scan.
  // Scanning uses the device camera and Google Play Services; the scan model is
  // fetched by the OS, not bundled in the app.
  async function scanDocument() {
    if (opening.current || saving.current || busy || loading) return;
    opening.current = true;
    setLoading(true);
    setScanProgress('Opening scanner...');
    setError('');
    try {
      const result = await DocumentScanner.scanDocument({ responseType: 'imageFilePath', maxNumDocuments: MAX_CONVERT_IMAGES });
      if (result.status !== 'success' || !result.scannedImages?.length) return;
      const scanned = result.scannedImages;
      if (scanned.length > MAX_CONVERT_IMAGES) throw new Error(`Scan up to ${MAX_CONVERT_IMAGES} pages at once.`);
      setScanProgress('Choose how to save your scan...');
      const format = await chooseScanFormat(scanned.length);
      if (!format) return;
      const saved = await exportScannedPages(scanned, format, setScanProgress);
      refreshExports();
      await saveCopies(saved);
      if (saved.length > 1) showFiles('all', 'exports');
    } catch (e) {
      refreshExports();
      setError(e.message || 'Could not save the scan.');
    } finally {
      setScanProgress('');
      opening.current = false;
      setLoading(false);
    }
  }

  async function saveCopies(copies) {
    if (saving.current) return { message: 'Another save is in progress. Your copy is in Exports.' };
    saving.current = true;
    setExportBusy(true);
    setSaveBanner({ message: 'Saving to phone...', pending: [] });
    let outcome;
    try {
      if (Platform.OS === 'android') {
        outcome = await saveOutputsToPhone(copies, message => {
          setScanProgress(message);
          setSaveBanner({ message, pending: [] });
        });
        outcome.message = saveResultMessage(outcome);
      } else {
        if (copies.length === 1) await shareExport(copies[0]);
        outcome = { status: 'shared', pending: [], message: copies.length === 1
          ? 'Share sheet closed. Your copy is also in Exports.'
          : `${copies.length} files are ready in Exports. Use Share beside a file to save it to Files.` };
      }
    } catch (e) {
      outcome = { status: 'failed', pending: copies, message: `${e.message || 'Save failed.'} Your app copies are in My Files.` };
    } finally {
      saving.current = false;
      setExportBusy(false);
      setScanProgress('');
      setSaveFolder(getSaveFolder());
      refreshExports();
    }
    setSaveBanner(outcome);
    return outcome;
  }

  async function changeFolder() {
    if (saving.current || busy || loading) return;
    saving.current = true; setExportBusy(true);
    let folder;
    try { folder = await chooseSaveFolder(); if (folder) setSaveFolder(folder); }
    catch (e) { setError(e.message || 'Could not choose a save folder.'); }
    finally { saving.current = false; setExportBusy(false); }
    // Resume only an explicitly pending save, never copy older exports implicitly.
    if (folder && saveBanner?.pending?.length) await saveCopies(saveBanner.pending);
  }

  async function shareCopy(copy) {
    if (saving.current || busy || loading) return;
    saving.current = true; setExportBusy(true);
    try { await shareExport(copy); }
    catch (e) { setError(e.message || 'Could not share this file.'); }
    finally { saving.current = false; setExportBusy(false); }
  }

  async function saveOpenDocument() {
    if (saving.current || opening.current || busy || loading || viewSaved) return;
    saving.current = true; setExportBusy(true);
    try {
      const saved = await keepExport(doc);
      refreshExports();
      saving.current = false;
      const result = await saveCopies([saved]);
      setViewSaved(result.status === 'saved' ? 'phone' : 'app');
    } catch (e) { setError(e.message || 'Could not save this file.'); }
    finally { saving.current = false; setExportBusy(false); }
  }

  function showFiles(kind = 'all', collection = 'recent') {
    setFilesKind(kind); setFilesCollection(collection); refreshExports(); setTab('files');
  }
  async function renameEntry(item, name) {
    if (saving.current) throw new Error('Wait for the current save to finish.');
    saving.current = true; setExportBusy(true);
    try { await renameLibraryDocument(item.libraryId, name); refreshExports(); }
    finally { saving.current = false; setExportBusy(false); }
  }
  async function favoriteEntry(item) {
    if (saving.current) return;
    saving.current = true; setExportBusy(true);
    try { await setLibraryFavorite(item.libraryId, !item.favorite); refreshExports(); }
    finally { saving.current = false; setExportBusy(false); }
  }
  function removeEntry(item) {
    if (saving.current) return;
    Alert.alert('Remove app copy?', 'Your original and copies saved to your phone stay untouched.', [
      { text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: async () => {
        if (saving.current) return;
        saving.current = true; setExportBusy(true);
        try { if (item.libraryId) { await discardDraft(item.libraryId); await removeLibraryDocument(item.libraryId); } else deleteExport(item.uri); refreshExports(); }
        catch (e) { setError(e.message); }
        finally { saving.current = false; setExportBusy(false); }
      } },
    ]);
  }

  function resumeDraft(item) {
    const original = recent.find(file => file.id === item.id);
    open(null, original || item, true);
  }
  function discardSavedDraft(item) {
    if (saving.current || busy || loading) return;
    Alert.alert('Discard this draft?', 'This removes the unfinished edits. Your original and exported copies stay unchanged.', [
      { text: 'Keep draft', style: 'cancel' }, { text: 'Discard', style: 'destructive', onPress: async () => {
        if (saving.current || opening.current) return;
        saving.current = true; setExportBusy(true);
        try { await discardDraft(item.id); refreshExports(); } catch (error) { setError(error.message); }
        finally { saving.current = false; setExportBusy(false); }
      } },
    ]);
  }
  async function openRecognizedText(text, name) {
    const file = newWorkingFile(name);
    try {
      file.write(text);
      const next = { uri: file.uri, name, mimeType: 'text/plain', kind: 'text', text, size: file.size };
      const item = await rememberDocument(next); next.libraryId = item.id;
      setDoc(next); setMode('edit'); setDirty(false); setDraftReady(false); setViewSaved(false);
      setActiveTool(null); refreshExports();
    } catch (error) { removeWorkingFile(file.uri); throw error; }
  }

  if (!ready) return <View style={[styles.root, styles.center]}><ActivityIndicator color={theme.primary} size="large" /></View>;

  const editorProps = { doc, onExport: exportCopy, onBusyChange: setBusy, onDirtyChange: setDirty, onDraftChange: setDraftReady, onDraftStored: refreshExports };
  const disabled = busy || loading || exportBusy;
  // Every document action lives in one overflow menu, so the file itself keeps the screen.
  const run = action => { setMenuOpen(false); return action(); };
  const libraryEntry = doc ? recent.find(item => item.id === doc.libraryId) : null;
  const documentMenu = !doc ? [] : [
    mode === 'view'
      ? { key: 'edit', icon: 'tools', label: drafts.some(item => item.id === doc.libraryId) ? 'Resume edits' : 'Edit this file',
          detail: doc.kind === 'pdf' ? 'Pages, text, highlight and signature' : doc.kind === 'image' ? 'Resize, rotate, compress, convert' : 'Edit and export the text',
          disabled, onPress: () => run(() => { setError(''); setDraftReady(false); setMode('edit'); }) }
      : { key: 'view', icon: 'back', label: 'Back to reading', detail: 'Leave the editor', disabled, onPress: () => run(backToView) },
    { key: 'save', icon: 'download', label: viewSaved === 'phone' ? 'Saved to phone' : viewSaved ? 'Saved in My Files' : Platform.OS === 'android' ? 'Save to phone' : 'Save a copy',
      detail: saveFolder && !viewSaved ? `Goes to ${saveFolder.label}` : undefined,
      disabled: disabled || !!viewSaved || mode === 'edit', onPress: () => run(saveOpenDocument) },
    { key: 'share', icon: 'share', label: 'Share a copy', disabled, onPress: () => run(() => shareCopy(doc)) },
    ...viewerActions.map(item => ({ ...item, onPress: () => run(item.onPress) })),
    libraryEntry && { key: 'star', icon: 'star', filled: libraryEntry.favorite, separated: true,
      label: libraryEntry.favorite ? 'Remove from starred' : 'Add to starred',
      disabled, onPress: () => run(() => favoriteEntry(libraryEntry)) },
    libraryEntry && { key: 'remove', icon: 'close', label: 'Remove app copy', destructive: true,
      detail: 'Your original and phone copies stay', disabled, onPress: () => run(() => removeEntry(libraryEntry)) },
  ];
  return <SafeAreaView style={styles.root}>
    <StatusBar style={theme.statusBar} />
    <View style={styles.header}>
      {doc || activeTool ? <IconButton name="back" label={doc ? 'Close document' : 'Close tool'} onPress={doc ? close : () => setActiveTool(null)} disabled={disabled} /> : <BrandMark size={36} />}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.brand, doc && type.heading]} numberOfLines={1}>{doc ? doc.name : activeTool === 'ocr' ? 'Scan to text' : activeTool === 'pages' ? 'PDF to images' : 'File Viewer'}</Text>
        {!!doc && <Text style={styles.caption} numberOfLines={1}>{doc.kind === 'pdf' ? 'PDF' : doc.kind === 'image' ? 'Image' : 'Text'} · {formatSize(doc.size)} · {mode === 'view' ? 'Reading' : 'Editing'}</Text>}
      </View>
      {!doc && <Pressable accessibilityRole="button" accessibilityLabel={`Switch to ${themeMode === 'light' ? 'dark' : 'light'} theme`} onPress={toggle} disabled={disabled} style={styles.themeToggle}>
        {themeMode === 'light' ? <MoonIcon color={theme.text} size={20} /> : <SunIcon color={theme.text} size={20} />}
      </Pressable>}
      {doc && <IconButton name="more" label="Document options" disabled={disabled} onPress={() => setMenuOpen(true)} />}
    </View>
    {!!error && <Banner tone="danger" icon="shield" message={error} onDismiss={() => setError('')} />}
    {!!saveBanner && <Banner tone={saveBanner.status === 'saved' ? 'success' : 'info'}
      icon={saveBanner.status === 'saved' ? 'check' : 'download'} message={saveBanner.message}
      busy={exportBusy} onDismiss={exportBusy ? undefined : () => setSaveBanner(null)}>
      {!exportBusy && !!saveBanner.pending?.length && <View style={styles.saveActions}>
        {saveBanner.status !== 'needs-folder' && <Button styles={styles} label="Retry save" onPress={() => saveCopies(saveBanner.pending)} disabled={busy || loading} quiet />}
        {Platform.OS === 'android' && <Button styles={styles} label="Choose folder" onPress={changeFolder} disabled={busy || loading} quiet />}
      </View>}
    </Banner>}
    {loading ? (doc || activeTool ? <View style={styles.center}><ActivityIndicator color={theme.primary} size="large" /><Text accessibilityLiveRegion="polite" style={styles.muted}>{scanProgress || 'Getting your file ready...'}</Text></View>
      : <View style={styles.loadingList}><Text accessibilityLiveRegion="polite" style={styles.muted}>{scanProgress || 'Getting your file ready...'}</Text><FileListSkeleton /></View>) :
      doc ? <View style={{ flex: 1 }} key={doc.uri + '-' + mode}>{mode === 'view' ? <DocumentViewer doc={doc} onProgressSaved={refreshExports} onActionsChange={setViewerActions} /> :
        doc.kind === 'image' ? <ImageEditor {...editorProps} /> : doc.kind === 'pdf' ? <PdfEditor {...editorProps} /> : <TextEditor {...editorProps} />}</View> :
      activeTool ? <DocumentTools key={activeTool} mode={activeTool} onBusyChange={setBusy} onTextReady={openRecognizedText} onSave={saveCopies} onExportsChanged={refreshExports} /> :
      tab === 'home' ? <Dashboard recent={recent} drafts={drafts} onResumeDraft={resumeDraft} onDiscardDraft={discardSavedDraft} onOpen={open} onScan={scanDocument} onConvert={imagesToPdf} onFiles={showFiles} disabled={disabled} /> :
      tab === 'files' ? <FilesScreen recent={recent} exports={exports} initialKind={filesKind} initialCollection={filesCollection}
        onOpen={open} onSave={saveCopies} onShare={shareCopy} onRemove={removeEntry} onRename={renameEntry} onFavorite={favoriteEntry}
        onFolder={changeFolder} folder={saveFolder} disabled={disabled} /> :
      <ToolsScreen onOpen={open} onScan={scanDocument} onConvert={imagesToPdf} onFolder={changeFolder} folder={saveFolder}
        onOcr={() => setActiveTool('ocr')} onPdfImages={() => setActiveTool('pages')}
        onPrivacy={() => setPrivacyVisible(true)} onLicenses={() => setLicensesVisible(true)} disabled={disabled} />}
    {!doc && !activeTool && !loading && <View style={styles.nav}>
      {[['home', 'Home', 'home'], ['files', 'My Files', 'folder'], ['tools', 'Tools', 'tools']].map(([value, label, icon]) => <Pressable key={value} accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected: tab === value, disabled }} disabled={disabled} onPress={() => value === 'files' ? showFiles() : setTab(value)}
        android_ripple={disabled ? undefined : { color: theme.ripple, borderless: true, radius: 40 }} style={styles.navTab}>
        <AppIcon name={icon} color={tab === value ? theme.primary : theme.textMuted} size={21} />
        <Text style={[styles.navText, tab === value && { color: theme.primary, fontWeight: '600' }]}>{label}</Text>
      </Pressable>)}
    </View>}
    <MenuSheet visible={menuOpen && !!doc} title={doc?.name}
      detail={doc ? `${doc.kind === 'pdf' ? 'PDF' : doc.kind === 'image' ? 'Image' : 'Text'} · ${formatSize(doc.size)} · original protected` : undefined}
      items={documentMenu} onClose={() => setMenuOpen(false)} />
    <Licenses visible={licensesVisible} onClose={() => setLicensesVisible(false)} />
    <PrivacyInfo visible={privacyVisible} onClose={() => setPrivacyVisible(false)} />
  </SafeAreaView>;
}

function saveResultMessage(result) {
  if (result.status === 'saved') {
    const count = result.saved.length;
    return `${count === 1 ? result.saved[0].name : `${count} files`} saved to ${result.folder.label}.` +
      (result.remembered === false ? ' Save history could not be stored for the next app launch.' : '');
  }
  if (result.status === 'cancelled') return 'Phone save cancelled. Your copies are safe in My Files; retry whenever you are ready.';
  const completed = result.saved.length ? `${result.saved.length} saved; ${result.pending.length} remaining. ` : '';
  return completed + result.error + ' Your app copies are safe in My Files.';
}

function chooseScanFormat(pageCount) {
  return new Promise(resolve => {
    Alert.alert('Save scan as', `${pageCount} scanned page${pageCount === 1 ? '' : 's'}. Save each page as a JPG image, or combine all pages into one PDF.`, [
      { text: 'JPG image' + (pageCount === 1 ? '' : 's'), onPress: () => resolve('image') },
      { text: 'PDF document', onPress: () => resolve('pdf') },
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
    ], { cancelable: true, onDismiss: () => resolve(null) });
  });
}

function Button({ label, onPress, disabled, quiet, styles }) {
  const { theme } = useTheme();
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} onPress={onPress} disabled={disabled}
    android_ripple={disabled ? undefined : rippleFor(quiet ? theme.ripple : theme.primaryText + '33')}
    style={({ pressed }) => [quiet ? styles.quietButton : styles.button, { opacity: pressedOpacity(pressed, disabled) }]}>
    <Text style={quiet ? styles.quietLabel : styles.buttonLabel}>{label}</Text>
  </Pressable>;
}
function makeStyles(t) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg },
    header: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.sm, backgroundColor: t.bg },
    brand: { ...type.title, color: t.text },
    caption: { ...type.caption, color: t.textMuted, marginTop: 2 },
    themeToggle: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', borderWidth: hairline, borderColor: t.border, backgroundColor: t.surface },
    button: { paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: 44, backgroundColor: t.primary, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
    buttonLabel: { ...type.label, color: t.primaryText },
    quietButton: { paddingHorizontal: space.md, paddingVertical: space.md, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    quietLabel: { ...type.label, color: t.primary },
    nav: { flexDirection: 'row', borderTopWidth: hairline, borderColor: t.border, paddingHorizontal: space.sm, paddingTop: space.sm, paddingBottom: space.xs, backgroundColor: t.surface },
    navTab: { flex: 1, alignItems: 'center', gap: space.xs, minHeight: 54, paddingTop: space.xs },
    navText: { ...type.caption, color: t.textMuted },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.lg },
    loadingList: { flex: 1, padding: space.lg, gap: space.lg },
    muted: { ...type.body, color: t.textMuted, textAlign: 'center' },
    saveActions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, alignItems: 'center' },
  });
}
