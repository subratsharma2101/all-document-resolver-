import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { File } from 'expo-file-system';
import PdfViewer from './PdfViewer';
import SignaturePad from './SignaturePad';
import { useTheme } from './theme';
import { newWorkingFile, pickDocument, removeWorkingFile } from './fileService';
import { copyName } from './fileUtils.cjs';
import { applyPdfOperation, inspectPdf, MAX_PDF_PAGES, PdfOperationError } from './pdfOperations.cjs';

const MAX_HISTORY = 20;
const TOOLS = [{ key: 'text', label: 'Text' }, { key: 'whiteout', label: 'Whiteout' }, { key: 'image', label: 'Image' }, { key: 'highlight', label: 'Highlight' }, { key: 'signature', label: 'Signature' }];

export default function PdfEditor({ doc, onExport, onBusyChange, onDirtyChange }) {
  const { theme } = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [workingUri, setWorkingUri] = useState(doc.uri);
  const [info, setInfo] = useState(null); // { pageCount, pages, warnings }
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [pagesInput, setPagesInput] = useState('');
  const [angle, setAngle] = useState(90);
  const [tool, setTool] = useState(null);
  const [text, setText] = useState('');
  const [fontSize, setFontSize] = useState(16);
  const [widthPct, setWidthPct] = useState('40');
  const [heightPct, setHeightPct] = useState('6');
  const [strokes, setStrokes] = useState([]);
  const [stamp, setStamp] = useState(null); // { bytes, name } for the image tool
  const [armed, setArmed] = useState(false); // Waiting for a page tap to place the overlay.

  const undo = useRef([]);
  const redo = useRef([]);
  const owned = useRef(new Set()); // Working files we created, for cleanup. Never includes doc.uri.

  const dirty = workingUri !== doc.uri;
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  // Inspect the original once. Blocks encrypted/signed/form PDFs before any editing UI is usable.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const bytes = await new File(doc.uri).bytes();
        const described = await inspectPdf(bytes);
        if (alive) setInfo(described);
      } catch (e) {
        if (alive) setError(e instanceof PdfOperationError ? e.message : 'This PDF could not be opened for editing.');
      }
    })();
    return () => {
      alive = false;
      for (const uri of owned.current) removeWorkingFile(uri);
    };
  }, [doc.uri]);

  const setWorking = (value) => { setBusy(value); onBusyChange?.(value); };

  function writeWorking(bytes) {
    const file = newWorkingFile(doc.name);
    file.write(bytes);
    owned.current.add(file.uri);
    return file.uri;
  }

  function forget(uri) {
    if (uri !== doc.uri && owned.current.has(uri)) { removeWorkingFile(uri); owned.current.delete(uri); }
  }

  function pushHistory(previousUri) {
    undo.current.push(previousUri);
    // Discard the redo branch; its files are no longer reachable.
    for (const uri of redo.current) forget(uri);
    redo.current = [];
    while (undo.current.length > MAX_HISTORY) forget(undo.current.shift());
  }

  async function refreshInfo(uri) {
    const bytes = await new File(uri).bytes();
    setInfo(await inspectPdf(bytes));
  }

  async function run(operation) {
    if (busy || !info) return;
    setError('');
    setNotice('');
    setWorking(true);
    try {
      const bytes = await new File(workingUri).bytes();
      const result = await applyPdfOperation(bytes, operation);
      const uri = writeWorking(result.bytes);
      pushHistory(workingUri);
      setWorkingUri(uri);
      setInfo({ pageCount: result.pageCount, pages: result.pages, warnings: result.warnings });
      setPage(current => Math.min(current, result.pageCount));
      setNotice('Applied. Preview updated. Use Undo to revert.');
    } catch (e) {
      setError(e instanceof PdfOperationError ? e.message : (e.message || 'Could not apply this change.'));
    } finally {
      setWorking(false);
    }
  }

  async function step(fromStack, toStack) {
    if (busy || !fromStack.current.length) return;
    setWorking(true);
    setError('');
    try {
      const target = fromStack.current.pop();
      toStack.current.push(workingUri);
      setWorkingUri(target);
      await refreshInfo(target);
      setPage(1);
      setNotice(fromStack === undo ? 'Reverted the last change.' : 'Reapplied the change.');
    } catch (e) {
      setError(e.message || 'Could not change history.');
    } finally {
      setWorking(false);
    }
  }

  async function merge() {
    if (busy) return;
    setError('');
    setNotice('');
    let picked;
    try {
      picked = await pickDocument('pdf');
    } catch (e) {
      setError(e.message || 'Could not open that PDF.');
      return;
    }
    if (!picked) return;
    try {
      const additionalBytes = await new File(picked.uri).bytes();
      await run({ type: 'merge', additionalBytes });
    } finally {
      removeWorkingFile(picked.uri);
    }
  }

  // Pick a PNG/JPG to stamp onto a page. We read the bytes now and hold them in
  // state; the actual placement waits for the user to tap the page.
  async function pickStamp() {
    if (busy) return;
    setError('');
    setNotice('');
    let picked;
    try {
      picked = await pickDocument('image');
    } catch (e) {
      setError(e.message || 'Could not open that image.');
      return;
    }
    if (!picked) return;
    try {
      const bytes = await new File(picked.uri).bytes();
      setStamp({ bytes, name: picked.name });
      setNotice(`Image ready: ${picked.name}. Now tap the page to place it.`);
    } catch (e) {
      setError(e.message || 'Could not read that image.');
    } finally {
      removeWorkingFile(picked.uri);
    }
  }

  function placeOverlay(tap) {
    if (!armed || !tool) return;
    setArmed(false);
    const base = { page: tap.page, x: tap.x, y: tap.y };
    const size = { width: Number(widthPct) / 100, height: Number(heightPct) / 100 };
    if (tool === 'text') {
      run({ ...base, type: 'text', text, fontSize });
    } else if (tool === 'highlight') {
      run({ ...base, type: 'highlight', ...size });
    } else if (tool === 'whiteout') {
      run({ ...base, type: 'whiteout', ...size });
    } else if (tool === 'image') {
      run({ ...base, type: 'image', ...size, imageBytes: stamp?.bytes });
    } else {
      run({ ...base, type: 'signature', ...size, strokes });
    }
  }

  async function save() {
    if (busy || !info) return;
    setWorking(true);
    try {
      await onExport({ uri: workingUri, name: copyName(doc.name), mimeType: 'application/pdf' });
      setNotice('Saved a copy to Exports. Keep editing or export it to a folder.');
    } catch (e) {
      setError(e.message || 'Could not export the PDF.');
    } finally {
      setWorking(false);
    }
  }

  if (!info && !error) return <View style={styles.center}><ActivityIndicator color={theme.primary} /><Text style={styles.muted}>Reading the PDF...</Text></View>;

  const toolReady = tool === 'text' ? text.trim().length > 0 : tool === 'signature' ? strokes.length > 0
    : tool === 'image' ? !!stamp : tool === 'highlight' || tool === 'whiteout';

  return <View style={styles.root}>
    <View style={styles.previewBox}>
      {info ? <PdfViewer uri={workingUri} name={doc.name} initialPage={Math.min(page, info.pageCount)}
        onPageChange={message => setPage(message.page)} onPageTap={placeOverlay} /> :
        <View style={styles.center}><Text style={styles.error}>{error}</Text></View>}
      {armed && <View pointerEvents="none" style={styles.armBanner}><Text style={styles.armText}>Tap the page to place the {tool}</Text></View>}
    </View>

    <ScrollView style={styles.controls} contentContainerStyle={styles.controlsContent} keyboardShouldPersistTaps="handled">
      {!!error && info && <View accessibilityRole="alert" style={styles.errorBox}><Text style={styles.error}>{error}</Text></View>}
      {!!notice && <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text>}

      {info && <>
        <View style={styles.headerRow}>
          <Text style={styles.title}>PDF workspace</Text>
          <Text style={styles.muted}>{info.pageCount} page{info.pageCount === 1 ? '' : 's'} / page {Math.min(page, info.pageCount)}</Text>
        </View>

        <View style={styles.row}>
          <Action styles={styles} label="Undo" disabled={busy || !undo.current.length} onPress={() => step(undo, redo)} />
          <Action styles={styles} label="Redo" disabled={busy || !redo.current.length} onPress={() => step(redo, undo)} />
          <Action styles={styles} label={busy ? 'Working...' : 'Save a copy'} primary disabled={busy} onPress={save} />
        </View>

        <Text style={styles.section}>Pages</Text>
        <TextInput accessibilityLabel="Page numbers or ranges" style={styles.input} value={pagesInput} onChangeText={setPagesInput}
          editable={!busy} placeholder="e.g. 1-3,5" placeholderTextColor={theme.textFaint} />
        <View style={styles.row}>
          <Action styles={styles} label="Extract" disabled={busy || !pagesInput.trim()} onPress={() => run({ type: 'extract', pages: pagesInput })} />
          <Action styles={styles} label="Delete" disabled={busy || !pagesInput.trim()} onPress={() => run({ type: 'delete', pages: pagesInput })} />
          <Action styles={styles} label="Reorder" disabled={busy || !pagesInput.trim()} onPress={() => run({ type: 'reorder', pages: pagesInput })} />
        </View>
        <View style={styles.row}>
          {[90, 180, 270].map(a => <Chip key={a} styles={styles} label={`${a}°`} on={angle === a} disabled={busy} onPress={() => setAngle(a)} />)}
          <Action styles={styles} label="Rotate" disabled={busy || !pagesInput.trim()} onPress={() => run({ type: 'rotate', pages: pagesInput, angle })} />
        </View>
        <Text style={styles.hint}>Reorder must list every page exactly once. Extract makes a subset. Delete keeps at least one page.</Text>

        <Text style={styles.section}>Combine</Text>
        <Action styles={styles} label="Merge another PDF at the end" disabled={busy} onPress={merge} block />
        <Text style={styles.hint}>Combined size must stay under 25 MiB and {MAX_PDF_PAGES} pages.</Text>

        <Text style={styles.section}>Add to a page</Text>
        <View style={styles.row}>{TOOLS.map(t => <Chip key={t.key} styles={styles} label={t.label} on={tool === t.key} disabled={busy}
          onPress={() => { setTool(tool === t.key ? null : t.key); setArmed(false); }} />)}</View>

        {tool === 'text' && <>
          <TextInput accessibilityLabel="Overlay text" style={styles.input} value={text} onChangeText={setText} editable={!busy}
            placeholder="One line of Latin text" placeholderTextColor={theme.textFaint} maxLength={500} />
          <View style={styles.row}>
            <Chip styles={styles} label="A-" disabled={busy} onPress={() => setFontSize(s => Math.max(8, s - 2))} />
            <Text style={styles.sizeText}>{fontSize} pt</Text>
            <Chip styles={styles} label="A+" disabled={busy} onPress={() => setFontSize(s => Math.min(72, s + 2))} />
          </View>
          <Text style={styles.hint}>Standard Latin font only. Hindi and other scripts need an embedded font and are not supported.</Text>
        </>}

        {tool === 'highlight' && <SizeInputs styles={styles} widthPct={widthPct} heightPct={heightPct} setWidthPct={setWidthPct} setHeightPct={setHeightPct} busy={busy} />}

        {tool === 'whiteout' && <>
          <Text style={styles.hint}>White box to cover content, then use Text to type over it. This hides content visually only; the original stays in the file and is recoverable.</Text>
          <SizeInputs styles={styles} widthPct={widthPct} heightPct={heightPct} setWidthPct={setWidthPct} setHeightPct={setHeightPct} busy={busy} />
        </>}

        {tool === 'image' && <>
          <Action styles={styles} label={stamp ? `Image: ${stamp.name}` : 'Choose a PNG or JPG'} disabled={busy} onPress={pickStamp} block />
          <Text style={styles.hint}>The image fits inside the box you set, keeping its shape. Tap the page to place it.</Text>
          <SizeInputs styles={styles} widthPct={widthPct} heightPct={heightPct} setWidthPct={setWidthPct} setHeightPct={setHeightPct} busy={busy} />
        </>}

        {tool === 'signature' && <>
          <SignaturePad value={strokes} onChange={setStrokes} disabled={busy} />
          <SizeInputs styles={styles} widthPct={widthPct} heightPct={heightPct} setWidthPct={setWidthPct} setHeightPct={setHeightPct} busy={busy} />
        </>}

        {tool && <Action styles={styles} label={armed ? 'Tap the page above...' : `Place ${tool} by tapping the page`} primary
          disabled={busy || !toolReady || armed} onPress={() => { setError(''); setArmed(true); }} block />}

        <View style={styles.warnBox}>{info.warnings.map((warning, i) => <Text key={i} style={styles.warn}>• {warning}</Text>)}</View>
      </>}
    </ScrollView>
  </View>;
}

function SizeInputs({ widthPct, heightPct, setWidthPct, setHeightPct, busy, styles }) {
  return <View style={styles.row}>
    <View style={styles.sizeCol}><Text style={styles.hint}>Width %</Text>
      <TextInput accessibilityLabel="Overlay width percent" style={styles.smallInput} value={widthPct} onChangeText={setWidthPct} editable={!busy} keyboardType="number-pad" /></View>
    <View style={styles.sizeCol}><Text style={styles.hint}>Height %</Text>
      <TextInput accessibilityLabel="Overlay height percent" style={styles.smallInput} value={heightPct} onChangeText={setHeightPct} editable={!busy} keyboardType="number-pad" /></View>
  </View>;
}

function Action({ label, onPress, disabled, primary, block, styles }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress}
    style={[primary ? styles.primary : styles.action, block && { flexBasis: '100%' }, disabled && { opacity: 0.45 }]}>
    <Text style={primary ? styles.primaryText : styles.actionText}>{label}</Text></Pressable>;
}
function Chip({ label, on, onPress, disabled, styles }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected: !!on, disabled: !!disabled }} disabled={disabled} onPress={onPress}
    style={[styles.chip, on && styles.chipOn, disabled && { opacity: 0.45 }]}><Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text></Pressable>;
}

function makeStyles(t) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg }, previewBox: { height: '42%', backgroundColor: t.overlayViewer, borderBottomWidth: 1, borderColor: t.border },
    armBanner: { position: 'absolute', top: 8, alignSelf: 'center', backgroundColor: t.primary, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
    armText: { color: t.primaryText, fontWeight: '700', fontSize: 12 },
    controls: { flex: 1 }, controlsContent: { padding: 16, gap: 10, paddingBottom: 40 },
    headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    title: { color: t.text, fontSize: 18, fontWeight: '700' }, muted: { color: t.textMuted, fontSize: 12 },
    section: { color: t.primary, fontSize: 11, letterSpacing: 1.4, fontWeight: '700', marginTop: 10 },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
    input: { minHeight: 48, backgroundColor: t.surface, borderRadius: 12, paddingHorizontal: 14, color: t.text, borderWidth: 1, borderColor: t.border },
    smallInput: { minHeight: 44, backgroundColor: t.surface, borderRadius: 10, paddingHorizontal: 12, color: t.text, borderWidth: 1, borderColor: t.border },
    sizeCol: { flex: 1, gap: 4 }, sizeText: { color: t.text, fontWeight: '600', minWidth: 48, textAlign: 'center' },
    action: { minHeight: 44, paddingHorizontal: 16, justifyContent: 'center', borderRadius: 10, backgroundColor: t.surfaceAlt },
    actionText: { color: t.text, fontWeight: '600' },
    primary: { minHeight: 44, paddingHorizontal: 18, justifyContent: 'center', borderRadius: 10, backgroundColor: t.primary, alignItems: 'center' },
    primaryText: { color: t.primaryText, fontWeight: '700' },
    chip: { minHeight: 44, paddingHorizontal: 16, justifyContent: 'center', borderRadius: 10, backgroundColor: t.chip },
    chipOn: { backgroundColor: t.chipOn }, chipText: { color: t.chipText, fontWeight: '600' }, chipTextOn: { color: t.chipTextOn },
    hint: { color: t.textMuted, fontSize: 12, lineHeight: 18 }, notice: { color: t.textMuted, fontSize: 13, lineHeight: 20 },
    warnBox: { marginTop: 12, gap: 6, borderLeftWidth: 2, borderLeftColor: t.primary, paddingLeft: 12 },
    warn: { color: t.textMuted, fontSize: 11, lineHeight: 17 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 20 },
    errorBox: { padding: 12, backgroundColor: t.dangerBg, borderRadius: 10 }, error: { color: t.danger, lineHeight: 20, textAlign: 'center' },
  });
}
