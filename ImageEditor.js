import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { File } from 'expo-file-system';
import { formatSize } from './fileUtils.cjs';
import { useTheme } from './theme';
import { FORMATS, formatFor, guardDimensions, ImageOperationError, outputName, resolveMaxWidth, targetBytes, searchQuality, scaleWidths } from './imageOperations.cjs';

const FORMAT_KEYS = ['jpeg', 'png', 'webp'];
// A JPEG source has no transparency, so PNG/WebP export of it is the natural default anyway.
const defaultFormat = (mimeType = '', name = '') => {
  const hint = `${mimeType} ${name}`.toLowerCase();
  if (hint.includes('png')) return 'png';
  if (hint.includes('webp')) return 'webp';
  return 'jpeg';
};

export default function ImageEditor({ doc, onExport, onBusyChange, onDirtyChange }) {
  const { theme } = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [format, setFormat] = useState(defaultFormat(doc.mimeType, doc.name));
  const [targetKb, setTargetKb] = useState('');
  const [maxWidth, setMaxWidth] = useState('');
  const [rotation, setRotation] = useState(0);
  const [source, setSource] = useState(null); // { width, height } of the original
  const [result, setResult] = useState(null); // { uri, size, width, height, quality, fits }
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const cancelled = useRef(false);
  const resultUri = useRef(null);
  const temps = useRef(new Set());

  const clearTemps = (keep) => {
    for (const uri of temps.current) {
      if (uri === keep) continue;
      try { const file = new File(uri); if (file.exists) file.delete(); } catch { /* Best effort cleanup. */ }
    }
    temps.current = keep ? new Set([keep]) : new Set();
  };
  const dropResult = () => {
    if (resultUri.current) { try { const f = new File(resultUri.current); if (f.exists) f.delete(); } catch { /* Best effort. */ } }
    resultUri.current = null;
    setResult(null);
  };

  // Decode the original once to read dimensions and enforce the pixel guard early.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const ref = await ImageManipulator.manipulate(doc.uri).renderAsync();
        guardDimensions(ref.width, ref.height);
        if (alive) setSource({ width: ref.width, height: ref.height });
      } catch (e) {
        if (alive) setError(e instanceof ImageOperationError ? e.message : 'This image could not be opened. It may be corrupt or an unsupported format on this device.');
      }
    })();
    return () => { alive = false; cancelled.current = true; clearTemps(); dropResult(); };
  }, [doc.uri]);

  useEffect(() => { onDirtyChange?.(!!result); }, [result, onDirtyChange]);

  const setWorking = (value) => { setBusy(value); onBusyChange?.(value); };

  async function process() {
    if (busy || !source) return;
    setError('');
    setNotice('');
    dropResult();
    clearTemps();
    cancelled.current = false;
    setWorking(true);
    setProgress('Preparing image...');
    try {
      const meta = formatFor(format);
      const formatKey = SaveFormat[meta.key.toUpperCase()];
      // After a 90/270 rotation the width becomes the original height.
      const orientedWidth = rotation % 180 === 0 ? source.width : source.height;
      // Honor an explicit max width as the cap; otherwise start from full resolution.
      const startWidth = resolveMaxWidth(maxWidth, orientedWidth) || orientedWidth;
      const hasTarget = !!targetKb.trim();
      const target = hasTarget ? targetBytes(targetKb) : null;

      // Always start from the untouched original so we never recompress a prior lossy export.
      const renderAt = async (width) => {
        const context = ImageManipulator.manipulate(doc.uri);
        if (rotation) context.rotate(rotation);
        if (width < orientedWidth) context.resize({ width });
        const ref = await context.renderAsync();
        guardDimensions(ref.width, ref.height);
        return ref;
      };
      const encode = async (ref, quality) => {
        if (cancelled.current) throw new ImageOperationError('CANCELLED', 'Compression cancelled.');
        const saved = await ref.saveAsync({ format: formatKey, compress: quality });
        temps.current.add(saved.uri);
        return { uri: saved.uri, size: new File(saved.uri).size };
      };

      let chosen = null; // { uri, size, width, height, quality, fits }
      let downscaled = false;

      if (!hasTarget) {
        setProgress('Encoding...');
        const ref = await renderAt(startWidth);
        const quality = meta.lossy ? 0.92 : 0.9;
        const out = await encode(ref, quality);
        chosen = { ...out, width: ref.width, height: ref.height, quality, fits: true };
      } else {
        // Quality alone caps out on large images; step the resolution down until the
        // byte target is met, keeping the highest-resolution result that fits.
        const widths = scaleWidths(startWidth);
        for (let i = 0; i < widths.length; i++) {
          if (cancelled.current) throw new ImageOperationError('CANCELLED', 'Compression cancelled.');
          setProgress(i === 0 ? 'Searching for the best quality under your target...'
            : `Reducing resolution to ${widths[i]} px wide to reach the target...`);
          const ref = await renderAt(widths[i]);
          let quality = 0.9;
          if (meta.lossy) {
            const found = await searchQuality({
              targetBytes: target,
              measure: async (q) => (await encode(ref, q)).size,
              shouldCancel: () => cancelled.current,
            });
            quality = found.quality;
          }
          const out = await encode(ref, quality);
          const candidate = { ...out, width: ref.width, height: ref.height, quality, fits: out.size <= target };
          if (i > 0) downscaled = true;
          // Keep the smallest result as the honest fallback if nothing ever fits.
          if (!chosen || candidate.size < chosen.size) chosen = candidate;
          if (candidate.fits) { chosen = candidate; break; }
        }
      }

      if (cancelled.current) throw new ImageOperationError('CANCELLED', 'Compression cancelled.');
      clearTemps(chosen.uri);
      resultUri.current = chosen.uri;
      setResult({ uri: chosen.uri, size: chosen.size, width: chosen.width, height: chosen.height, quality: chosen.quality, fits: chosen.fits });
      if (hasTarget && !chosen.fits) {
        setNotice(meta.lossy
          ? 'Even at the lowest quality and smallest size, this could not reach the target. This is the smallest possible result. Try a larger target.'
          : 'PNG is lossless. Even after downscaling it did not reach the target. Switch to JPG or WebP for smaller files.');
      } else if (hasTarget && downscaled) {
        setNotice('Reached your target by reducing the resolution as well as the quality.');
      }
    } catch (e) {
      clearTemps();
      if (e instanceof ImageOperationError && e.code === 'CANCELLED') setNotice('Cancelled. Nothing was changed.');
      else setError(e instanceof ImageOperationError ? e.message : (e.message || 'Could not process this image.'));
    } finally {
      setWorking(false);
      setProgress('');
    }
  }

  async function save() {
    if (busy || !result) return;
    setWorking(true);
    try {
      await onExport({ uri: result.uri, name: outputName(doc.name, format), mimeType: formatFor(format).mimeType });
      dropResult(); // Parent has copied it into Exports; the working file is no longer needed.
      setNotice('Saved a copy. Adjust settings and process again to make another.');
    } catch (e) {
      setError(e.message || 'Could not export the image.');
    } finally {
      setWorking(false);
    }
  }

  const meta = FORMATS[format];
  const transparencyWarning = !meta.alpha && defaultFormat(doc.mimeType, doc.name) !== 'jpeg';
  const savings = result && doc.size ? Math.round((1 - result.size / doc.size) * 100) : null;

  return <ScrollView style={styles.root} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <Text style={styles.title}>Image studio</Text>
    <Text style={styles.muted}>{formatSize(doc.size)} original{source ? ` / ${source.width}x${source.height}` : ''}. Compress and convert without touching the original.</Text>

    {!!error && <View accessibilityRole="alert" style={styles.errorBox}><Text style={styles.error}>{error}</Text></View>}

    <Text style={styles.label}>Output format</Text>
    <View style={styles.row}>
      {FORMAT_KEYS.map(key => <Pressable key={key} accessibilityRole="button" accessibilityState={{ selected: format === key }}
        disabled={busy} onPress={() => { setFormat(key); }} style={[styles.chip, format === key && styles.chipOn]}>
        <Text style={[styles.chipText, format === key && styles.chipTextOn]}>{FORMATS[key].label}</Text>
      </Pressable>)}
    </View>
    {transparencyWarning && <Text style={styles.warn}>JPG has no transparency; transparent areas become solid. Use PNG or WebP to keep transparency.</Text>}
    {!meta.lossy && <Text style={styles.warn}>PNG is lossless. To shrink it, reduce the max width. JPG or WebP reach small target sizes better.</Text>}
    <Text style={styles.warn}>Only the first frame of animated images is kept, and camera metadata (EXIF, location) is not carried over.</Text>

    <Text style={styles.label}>Target size (KB, optional)</Text>
    <TextInput accessibilityLabel="Target size in kilobytes" style={styles.input} value={targetKb} onChangeText={setTargetKb}
      editable={!busy} keyboardType="number-pad" placeholder="e.g. 400" placeholderTextColor={theme.textFaint} />

    <Text style={styles.label}>Max width (px, optional)</Text>
    <TextInput accessibilityLabel="Maximum width in pixels" style={styles.input} value={maxWidth} onChangeText={setMaxWidth}
      editable={!busy} keyboardType="number-pad" placeholder="keep original" placeholderTextColor={theme.textFaint} />

    <Text style={styles.label}>Rotate</Text>
    <View style={styles.row}>
      {[0, 90, 180, 270].map(angle => <Pressable key={angle} accessibilityRole="button" accessibilityState={{ selected: rotation === angle }}
        disabled={busy} onPress={() => setRotation(angle)} style={[styles.chip, rotation === angle && styles.chipOn]}>
        <Text style={[styles.chipText, rotation === angle && styles.chipTextOn]}>{angle}°</Text>
      </Pressable>)}
    </View>

    {busy ? <View style={styles.progress}><ActivityIndicator color={theme.primary} /><Text style={styles.muted}>{progress || 'Working...'}</Text>
      <Pressable accessibilityRole="button" onPress={() => { cancelled.current = true; }} style={styles.cancel}><Text style={styles.white}>Cancel</Text></Pressable></View> :
      <Pressable accessibilityRole="button" disabled={!source} onPress={process} style={[styles.primary, !source && { opacity: 0.5 }]}><Text style={styles.white}>Process image</Text></Pressable>}

    {!!notice && <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text>}

    {result && <View style={styles.resultBox}>
      <Text style={styles.resultTitle}>Result</Text>
      <Image accessibilityLabel="Processed image preview" source={{ uri: result.uri }} style={styles.preview} resizeMode="contain" />
      <Text style={styles.resultLine}>{formatSize(result.size)} / {result.width}x{result.height} / {FORMATS[format].label}</Text>
      <Text style={styles.muted}>{savings !== null && savings > 0 ? `${savings}% smaller than the original.` : savings !== null && savings < 0 ? `${-savings}% larger than the original.` : 'Similar size to the original.'}{meta.lossy ? ` Quality ${Math.round(result.quality * 100)}%.` : ''}</Text>
      {targetKb.trim() && result.fits && <Text style={styles.ok}>At or below your {targetKb.trim()} KB target.</Text>}
      <Pressable accessibilityRole="button" disabled={busy} onPress={save} style={styles.primary}><Text style={styles.white}>Save a copy</Text></Pressable>
    </View>}

    <Text style={styles.footnote}>Larger output does not restore detail. Target size means at or below the limit; when that is impossible the smallest result is kept and reported.</Text>
  </ScrollView>;
}

function makeStyles(t) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg }, content: { padding: 18, gap: 10, paddingBottom: 40 },
    title: { color: t.text, fontSize: 19, fontWeight: '700' }, muted: { color: t.textMuted, fontSize: 12, lineHeight: 19 },
    label: { color: t.text, fontSize: 13, fontWeight: '600', marginTop: 8 },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { minHeight: 44, paddingHorizontal: 16, justifyContent: 'center', borderRadius: 10, backgroundColor: t.chip },
    chipOn: { backgroundColor: t.chipOn }, chipText: { color: t.chipText, fontWeight: '600' }, chipTextOn: { color: t.chipTextOn },
    input: { minHeight: 48, backgroundColor: t.surface, borderRadius: 12, paddingHorizontal: 14, color: t.text, borderWidth: 1, borderColor: t.border },
    warn: { color: t.warn, fontSize: 12, lineHeight: 18 },
    primary: { backgroundColor: t.primary, borderRadius: 14, padding: 15, alignItems: 'center', minHeight: 50, marginTop: 6, justifyContent: 'center' },
    white: { color: t.primaryText, fontWeight: '700' },
    progress: { alignItems: 'center', gap: 12, paddingVertical: 14 },
    cancel: { backgroundColor: t.surfaceAlt, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 12, minHeight: 44, justifyContent: 'center' },
    notice: { color: t.textMuted, fontSize: 13, lineHeight: 20 },
    resultBox: { backgroundColor: t.surface, borderRadius: 14, padding: 14, gap: 8, borderWidth: 1, borderColor: t.border, marginTop: 6 },
    resultTitle: { color: t.text, fontWeight: '700', fontSize: 15 }, resultLine: { color: t.text, fontWeight: '600' },
    preview: { width: '100%', height: 200, backgroundColor: t.overlayViewer, borderRadius: 10 },
    ok: { color: t.success, fontSize: 12, fontWeight: '600' },
    errorBox: { padding: 12, backgroundColor: t.dangerBg, borderRadius: 10 }, error: { color: t.danger, lineHeight: 20 },
    footnote: { color: t.textFaint, fontSize: 11, lineHeight: 17, marginTop: 10 },
  });
}
