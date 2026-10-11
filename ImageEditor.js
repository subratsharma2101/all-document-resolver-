import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { File } from 'expo-file-system';
import { formatSize } from './fileUtils.cjs';
import { useTheme, hairline, radius, space, type } from './theme';
import { inspectImageFile, loadBoundedImage } from './safeImage';
import { WORKING_IMAGE_EDGE } from './imageSafety.cjs';
import { ensureWorkingSpace, newWorkingFile, removeWorkingFile } from './fileService';
import { readDraft } from './draftStorage';
import useDraftAutosave from './useDraftAutosave';
import { FORMATS, formatFor, guardDimensions, ImageOperationError, outputName, resolveMaxWidth, targetBytes, searchQuality, scaleWidths } from './imageOperations.cjs';

const FORMAT_KEYS = ['jpeg', 'png', 'webp'];
// A JPEG source has no transparency, so PNG/WebP export of it is the natural default anyway.
const defaultFormat = (mimeType = '', name = '') => {
  const hint = `${mimeType} ${name}`.toLowerCase();
  if (hint.includes('png')) return 'png';
  if (hint.includes('webp')) return 'webp';
  return 'jpeg';
};

export default function ImageEditor({ doc, onExport, onBusyChange, onDirtyChange, onDraftChange, onDraftStored }) {
  const { theme } = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [restored] = useState(() => readDraft(doc));
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
  const locked = useRef(false);
  const resultUri = useRef(null);
  const temps = useRef(new Set());
  const autosave = useDraftAutosave({ doc, dirty: !!result, revision: result?.uri,
    snapshot: { uri: result?.uri, options: result ? { ...result, uri: undefined } : {} }, restored, onDraftChange, onDraftStored });

  const clearTemps = (keep, preserve) => {
    for (const uri of temps.current) {
      if (uri === keep || uri === preserve) continue;
      try { const file = new File(uri); if (file.exists) file.delete(); } catch { /* Best effort cleanup. */ }
    }
    temps.current = new Set([keep, preserve].filter(Boolean));
  };
  const dropResult = () => {
    if (resultUri.current) { try { const f = new File(resultUri.current); if (f.exists) f.delete(); } catch { /* Best effort. */ } }
    resultUri.current = null;
    setResult(null);
  };

  // Parse a bounded header before any decode; never load a full bitmap just for dimensions.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const metadata = doc.imageMetadata || inspectImageFile(doc.uri);
        if (restored && FORMAT_KEYS.includes(restored.options?.format)) {
          const copy = newWorkingFile(`recovered.${restored.options.format}`);
          try {
            await new File(restored.uri).copy(copy);
            if (!alive) { removeWorkingFile(copy.uri); return; }
            const restoredMetadata = inspectImageFile(copy.uri);
            resultUri.current = copy.uri;
            setResult({ ...restored.options, ...restoredMetadata, uri: copy.uri, size: copy.size });
            setFormat(restored.options.format);
            setTargetKb(restored.options.targetKb || ''); setMaxWidth(restored.options.maxWidth || '');
            setRotation([0, 90, 180, 270].includes(restored.options.rotation) ? restored.options.rotation : 0);
          } catch (error) { removeWorkingFile(copy.uri); throw error; }
        }
        if (alive) setSource(metadata);
      } catch (e) {
        if (alive) setError(e instanceof ImageOperationError ? e.message : 'This image could not be opened. It may be corrupt or an unsupported format on this device.');
      }
    })();
    return () => { alive = false; cancelled.current = true; autosave.flush().finally(() => { clearTemps(); if (resultUri.current) { try { new File(resultUri.current).delete(); } catch {} } }); };
  }, [doc.uri]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => { if (state !== 'active') cancelled.current = true; });
    return () => subscription.remove();
  }, []);

  useEffect(() => { onDirtyChange?.(!!result); }, [result, onDirtyChange]);

  const setWorking = (value) => { locked.current = value; setBusy(value); onBusyChange?.(value); };

  async function process() {
    if (locked.current || !source) return;
    setError('');
    setNotice('');
    cancelled.current = false;
    setWorking(true);
    setProgress('Preparing image...');
    const resources = [];
    const previousUri = resultUri.current;
    let input;
    try {
      await autosave.flush();
      clearTemps(previousUri);
      ensureWorkingSpace(48 * 1024 * 1024);
      input = await loadBoundedImage(doc.uri);
      if (cancelled.current) throw new ImageOperationError('CANCELLED', 'Compression cancelled.');
      const meta = formatFor(format);
      const formatKey = SaveFormat[meta.key.toUpperCase()];
      // After a 90/270 rotation the width becomes the original height.
      const orientedWidth = rotation % 180 === 0 ? input.width : input.height;
      // Honor an explicit max width as the cap; otherwise start from full resolution.
      const startWidth = resolveMaxWidth(maxWidth, orientedWidth) || orientedWidth;
      const hasTarget = !!targetKb.trim();
      const target = hasTarget ? targetBytes(targetKb) : null;

      // Decode once with a native size bound, then start every attempt from that
      // immutable image reference. Never recompress a prior lossy output.
      const renderAt = async (width) => {
        const context = ImageManipulator.manipulate(input.ref);
        resources.push(context);
        if (rotation) context.rotate(rotation);
        if (width < orientedWidth) context.resize({ width });
        const ref = await context.renderAsync();
        resources.push(ref);
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
              measure: async (q) => {
                const probe = await encode(ref, q);
                try { return probe.size; }
                finally { new File(probe.uri).delete(); temps.current.delete(probe.uri); }
              },
              shouldCancel: () => cancelled.current,
            });
            quality = found.quality;
          }
          const out = await encode(ref, quality);
          const candidate = { ...out, width: ref.width, height: ref.height, quality, fits: out.size <= target };
          if (i > 0) downscaled = true;
          // Keep the smallest result as the honest fallback if nothing ever fits.
          if (!chosen || candidate.size < chosen.size) chosen = candidate;
          if (candidate.fits) { chosen = candidate; }
          clearTemps(chosen.uri, previousUri);
          // Release decoded pixels between resolution attempts, not at GC's discretion.
          while (resources.length) resources.pop().release?.();
          if (candidate.fits) break;
        }
      }

      if (cancelled.current) throw new ImageOperationError('CANCELLED', 'Compression cancelled.');
      clearTemps(chosen.uri);
      resultUri.current = chosen.uri;
      setResult({ uri: chosen.uri, size: chosen.size, width: chosen.width, height: chosen.height, quality: chosen.quality, fits: chosen.fits,
        format, targetKb: hasTarget ? targetKb.trim() : '', maxWidth, rotation });
      if (hasTarget && !chosen.fits) {
        setNotice(meta.lossy
          ? 'None of the tested quality and resolution settings reached the target. This is the smallest result tested. Try a larger target.'
          : 'PNG is lossless. Even after downscaling it did not reach the target. Switch to JPG or WebP for smaller files.');
      } else if (hasTarget && downscaled) {
        setNotice('Reached your target by reducing the resolution as well as the quality.');
      }
    } catch (e) {
      clearTemps(previousUri);
      if (e instanceof ImageOperationError && e.code === 'CANCELLED') setNotice(previousUri ? 'Cancelled. Your previous preview is still ready to save.' : 'Cancelled. Nothing was changed.');
      else setError(e instanceof ImageOperationError ? e.message : (e.message || 'Could not process this image.'));
    } finally {
      while (resources.length) resources.pop().release?.();
      input?.ref.release();
      Image.clearMemoryCache().catch(() => {});
      setWorking(false);
      setProgress('');
    }
  }

  async function save() {
    if (locked.current || !result) return;
    setWorking(true);
    try {
      const saved = await onExport({ uri: result.uri, name: outputName(doc.name, result.format), mimeType: formatFor(result.format).mimeType });
      await autosave.clear();
      dropResult(); // Parent has copied it into Exports; the working file is no longer needed.
      setNotice(saved?.saveMessage || 'Your copy is in Exports.');
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
    {!!source && (source.width > WORKING_IMAGE_EDGE || source.height > WORKING_IMAGE_EDGE) && <Text style={styles.warn}>This large image is sampled to at most {WORKING_IMAGE_EDGE} pixels on its longest edge for safe processing. The original file stays unchanged.</Text>}

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
    <Text style={styles.warn}>Use static images. Animated formats are rejected for safe processing. Camera metadata (EXIF, location) is not carried over to processed copies.</Text>

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

    {!!autosave.status && <Text accessibilityLiveRegion="polite" style={styles.notice}>{autosave.status}</Text>}
    {!!notice && <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text>}

    {result && <View style={styles.resultBox}>
      <Text style={styles.resultTitle}>Result</Text>
      <Image accessibilityLabel="Processed image preview" source={{ uri: result.uri }} style={styles.preview} contentFit="contain" cachePolicy="none" allowDownscaling />
      <Text style={styles.resultLine}>{formatSize(result.size)} / {result.width}x{result.height} / {FORMATS[result.format].label}</Text>
      <Text style={styles.muted}>{savings !== null && savings > 0 ? `${savings}% smaller than the original.` : savings !== null && savings < 0 ? `${-savings}% larger than the original.` : 'Similar size to the original.'}{FORMATS[result.format].lossy ? ` Quality ${Math.round(result.quality * 100)}%.` : ''}</Text>
      {result.targetKb && result.fits && <Text style={styles.ok}>At or below the processed {result.targetKb} KB target.</Text>}
      {(result.format !== format || result.targetKb !== targetKb.trim() || result.rotation !== rotation || result.maxWidth !== maxWidth) && <Text style={styles.warn}>Settings changed. Process again to apply them; Save keeps the preview above.</Text>}
      <Pressable accessibilityRole="button" disabled={busy} onPress={save} style={styles.primary}><Text style={styles.white}>Save a copy</Text></Pressable>
    </View>}

    <Text style={styles.footnote}>Larger output does not restore detail. Target size means at or below the limit. If no tested setting fits, the smallest tested result is kept and reported.</Text>
  </ScrollView>;
}

function makeStyles(t) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg }, content: { padding: space.lg, gap: space.sm, paddingBottom: space.xxl, width: '100%', maxWidth: 760, alignSelf: 'center' },
    title: { ...type.title, color: t.text }, muted: { ...type.caption, color: t.textMuted },
    label: { ...type.label, color: t.text, marginTop: space.sm },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
    chip: { minHeight: 44, paddingHorizontal: space.lg, justifyContent: 'center', borderRadius: radius.sm, backgroundColor: t.chip },
    chipOn: { backgroundColor: t.chipOn }, chipText: { ...type.label, color: t.chipText }, chipTextOn: { color: t.chipTextOn },
    input: { minHeight: 48, backgroundColor: t.surface, borderRadius: radius.sm, paddingHorizontal: space.md, color: t.text, borderWidth: hairline, borderColor: t.border, ...type.body },
    warn: { ...type.caption, color: t.warn },
    primary: { backgroundColor: t.primary, borderRadius: radius.md, padding: space.md, alignItems: 'center', minHeight: 48, marginTop: space.xs, justifyContent: 'center' },
    white: { ...type.label, color: t.primaryText },
    progress: { alignItems: 'center', gap: space.md, paddingVertical: space.md },
    cancel: { backgroundColor: t.surfaceAlt, borderRadius: radius.sm, paddingHorizontal: space.xl, paddingVertical: space.md, minHeight: 44, justifyContent: 'center' },
    notice: { ...type.caption, color: t.textMuted },
    resultBox: { backgroundColor: t.surface, borderRadius: radius.md, padding: space.lg, gap: space.sm, borderWidth: hairline, borderColor: t.border, marginTop: space.xs },
    resultTitle: { ...type.heading, color: t.text }, resultLine: { ...type.label, color: t.text },
    preview: { width: '100%', height: 200, backgroundColor: t.overlayViewer, borderRadius: radius.sm },
    ok: { ...type.caption, color: t.success, fontWeight: '600' },
    errorBox: { padding: space.md, backgroundColor: t.dangerBg, borderRadius: radius.sm }, error: { ...type.caption, color: t.danger },
    footnote: { ...type.caption, color: t.textFaint, marginTop: space.sm },
  });
}
