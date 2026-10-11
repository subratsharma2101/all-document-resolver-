import { Directory, File, Paths } from 'expo-file-system';
import { StorageAccessFramework, EncodingType } from 'expo-file-system/legacy';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Platform } from 'react-native';
import { safeName, validateDocument, detectKind } from './fileUtils.cjs';
import { resizeForPdf, PDF_IMAGE_QUALITY, MAX_CONVERT_IMAGES, MAX_OUTPUT_BYTES } from './conversions.cjs';
import { inspectImageFile, loadBoundedImage } from './safeImage';
import { createListCache } from './listCache.cjs';

const workDir = () => new Directory(Paths.cache, 'fileviewer-work');
const exportDir = () => new Directory(Paths.document, 'exports');
const pendingDir = () => new Directory(Paths.document, 'export-pending');
let serial = 0;
let exportQueue = Promise.resolve();

export function ensureWorkingSpace(bytes = 0) {
  const available = Paths.availableDiskSpace;
  if (Number.isFinite(available) && available < bytes + 16 * 1024 * 1024) {
    throw new Error('Not enough device storage to save safely. Free some space and try again.');
  }
}

export function newWorkingFile(name) {
  ensureWorkingSpace();
  const dir = workDir();
  dir.create({ idempotent: true, intermediates: true });
  return new File(dir, `${Date.now()}-${++serial}-${safeName(name)}`);
}

export async function importDocument(asset) {
  if (!/^(file|content):\/\//i.test(asset.uri || '')) {
    throw new Error('Only local files are supported. Download the file first.');
  }
  const source = new File(asset.uri);
  if (!source.exists) throw new Error('This file is no longer available. Choose it again from the file picker.');
  const size = source.size;
  const name = asset.name || source.name;
  const mimeType = asset.mimeType || source.type || '';
  const kind = validateDocument({ name, mimeType, size });
  const local = newWorkingFile(name);
  try {
    ensureWorkingSpace(size);
    await source.copy(local);
    validateDocument({ name, mimeType, size: local.size });
    if (local.size !== size) throw new Error('The source changed while it was being opened. Choose it again.');
    const imageMetadata = kind === 'image' ? inspectImageFile(local.uri) : undefined;
    let text;
    if (kind === 'text') {
      text = await local.text();
      if (text.includes('\u0000') || text.includes('\ufffd')) {
        throw new Error('This text encoding is not supported. Convert it to UTF-8 before editing.');
      }
    }
    return { name, uri: local.uri, size: local.size, mimeType, kind, text, imageMetadata };
  } catch (error) {
    removeWorkingFile(local.uri);
    throw error;
  }
}

export async function pickDocument(kind) {
  const type = { pdf: 'application/pdf', image: 'image/*', text: ['text/*', 'application/json'] }[kind] || '*/*';
  const result = await DocumentPicker.getDocumentAsync({ type, copyToCacheDirectory: true });
  if (result.canceled) return null;
  const asset = result.assets[0];
  try {
    return await importDocument(asset);
  } finally {
    // The document picker explicitly returns a disposable copy, never the source.
    if (asset.uri.startsWith(Paths.cache.uri)) {
      try { new File(asset.uri).delete(); } catch { /* Cache cleanup is best effort. */ }
    }
  }
}

// Downscale and JPEG-re-encode one image so it embeds compactly in a PDF. pdf-lib
// embeds the original pixels as-is, so full-resolution phone photos or 100%-quality
// scans blow past the combined size limit after only a few pages. Rendering to a
// bounded dimension and lossy JPEG keeps each page small. Reject failures rather
// than silently embedding an unbounded or unsupported original.
export async function compressImageForPdf(uri) {
  const source = new File(uri);
  if (!source.exists) throw new Error('An image is no longer available. Choose it again.');
  validateDocument({ name: source.name, mimeType: 'image/jpeg', size: source.size });
  const resources = [];
  let file;
  try {
    const loaded = await loadBoundedImage(uri, 2200); resources.push(loaded.ref);
    const context = ImageManipulator.manipulate(loaded.ref); resources.push(context);
    const ref = await context.renderAsync(); resources.push(ref);
    const resize = resizeForPdf(ref.width, ref.height);
    let rendered = ref;
    if (resize) {
      const resized = ImageManipulator.manipulate(ref); resources.push(resized);
      resized.resize(resize);
      rendered = await resized.renderAsync(); resources.push(rendered);
    }
    const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: PDF_IMAGE_QUALITY });
    file = new File(saved.uri);
    return await file.bytes();
  } finally {
    try { if (file?.exists) file.delete(); } catch { /* Temp cleanup is best effort. */ }
    while (resources.length) resources.pop().release?.();
  }
}

// Pick multiple images, downscale each, and return the compressed bytes in the order
// chosen, for building a combined PDF. Disposable picker copies are deleted after reading.
export async function pickImageBytes() {
  const result = await DocumentPicker.getDocumentAsync({ type: 'image/*', multiple: true, copyToCacheDirectory: true });
  if (result.canceled) return null;
  const assets = result.assets || [];
  const images = [];
  try {
    if (assets.length > MAX_CONVERT_IMAGES) throw new Error(`Choose up to ${MAX_CONVERT_IMAGES} images at once.`);
    let total = 0;
    for (const asset of assets) {
      if (!/^(file|content):\/\//i.test(asset.uri || '')) throw new Error('Only local image files can be converted.');
      const file = new File(asset.uri);
      const bytes = await compressImageForPdf(asset.uri);
      total += bytes.byteLength;
      if (total > MAX_OUTPUT_BYTES) throw new Error('Combined images exceed 25 MiB. Choose fewer or smaller images.');
      images.push({ name: asset.name || file.name, bytes });
    }
    return images;
  } finally {
    for (const asset of assets) {
      if (asset.uri?.startsWith(Paths.cache.uri)) {
        try { new File(asset.uri).delete(); } catch { /* Cache cleanup is best effort. */ }
      }
    }
  }
}

export function removeWorkingFile(uri) {
  if (uri?.startsWith(`${workDir().uri.replace(/\/$/, '')}/`)) {
    try { const file = new File(uri); if (file.exists) file.delete(); } catch { /* Best effort. */ }
  }
}

export function cleanOldWorkingFiles() {
  for (const dir of [workDir(), pendingDir()]) {
    if (!dir.exists) continue;
    for (const item of dir.list()) {
      if (item instanceof File && item.modificationTime < Date.now() - 24 * 60 * 60 * 1000) {
        try { item.delete(); } catch { /* Do not block startup for an old cache file. */ }
      }
    }
  }
}

export async function keepExport({ uri, name, mimeType }) {
  let release;
  const previous = exportQueue;
  exportQueue = new Promise(resolve => { release = resolve; });
  await previous;
  let pending;
  try {
    const source = new File(uri);
    if (!source.exists) throw new Error('The generated file is no longer available. Generate it again.');
    const kind = validateDocument({ name, mimeType, size: source.size });
    const expectedSize = source.size;
    ensureWorkingSpace(expectedSize);
    const staging = pendingDir();
    staging.create({ idempotent: true, intermediates: true });
    pending = new File(staging, `${Date.now()}-${++serial}.pending`);
    await source.copy(pending);
    if (pending.size !== expectedSize) throw new Error('The copy was incomplete. Nothing was published to Exports. Try again.');
    const dir = exportDir();
    dir.create({ idempotent: true, intermediates: true });
    const clean = safeName(name);
    const dot = clean.lastIndexOf('.');
    const stem = dot > 0 ? clean.slice(0, dot) : clean;
    const ext = dot > 0 ? clean.slice(dot) : '';
    let destination = new File(dir, clean);
    let suffix = 1;
    while (destination.exists) destination = new File(dir, `${stem} (${suffix++})${ext}`);
    // Rename only a complete same-filesystem copy into the visible export list.
    // A crash during copying leaves an invisible owned staging file, not a corrupt export.
    await pending.move(destination);
    pending = null;
    return { uri: destination.uri, name: destination.name, mimeType: mimeType || destination.type,
      size: destination.size, kind };
  } finally {
    try { if (pending?.exists) pending.delete(); } catch { /* Cleaned on a later startup. */ }
    exportsCache.invalidate();
    release();
  }
}

const exportsCache = createListCache(() => {
  const dir = exportDir();
  if (!dir.exists) return [];
  return dir.list().filter(item => item instanceof File)
    .map(file => ({ uri: file.uri, name: file.name, size: file.size, mimeType: file.type, modified: file.modificationTime }))
    .map(item => ({ ...item, kind: detectKind(item.name, item.mimeType) }))
    .sort((a, b) => b.modified - a.modified);
});

export function listExports() {
  return exportsCache.read();
}

export function deleteExport(uri) {
  if (!uri.startsWith(`${exportDir().uri.replace(/\/$/, '')}/`)) throw new Error('Not an app export.');
  try { new File(uri).delete(); } finally { exportsCache.invalidate(); }
}

export async function shareExport(output) {
  if (!await Sharing.isAvailableAsync()) throw new Error('Sharing is unavailable on this device. Use Save to folder instead.');
  await Sharing.shareAsync(output.uri, { mimeType: output.mimeType, dialogTitle: `Share ${output.name}` });
}

export async function saveToFolder(output) {
  if (Platform.OS !== 'android') {
    await shareExport(output);
    return false;
  }
  const access = await StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!access.granted) return false;
  const name = safeName(output.name).replace(/\.[^.]+$/, '');
  const uri = await StorageAccessFramework.createFileAsync(access.directoryUri, name, output.mimeType || 'application/octet-stream');
  try {
    // SAF's writer writes the newly created document; copy(overwrite) deletes SAF targets.
    await StorageAccessFramework.writeAsStringAsync(uri, await new File(output.uri).base64(), { encoding: EncodingType.Base64 });
  } catch (error) {
    try { await StorageAccessFramework.deleteAsync(uri, { idempotent: true }); } catch { /* Preserve original write error. */ }
    throw error;
  }
  return true;
}
