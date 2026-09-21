import { Directory, File, Paths } from 'expo-file-system';
import { StorageAccessFramework, EncodingType } from 'expo-file-system/legacy';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { safeName, validateDocument } from './fileUtils.cjs';

const workDir = () => new Directory(Paths.cache, 'fileviewer-work');
const exportDir = () => new Directory(Paths.document, 'exports');
let serial = 0;

export function newWorkingFile(name) {
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
    await source.copy(local);
    let text;
    if (kind === 'text') {
      text = await local.text();
      if (text.includes('\u0000') || text.includes('\ufffd')) {
        throw new Error('This text encoding is not supported. Convert it to UTF-8 before editing.');
      }
    }
    return { name, uri: local.uri, size: local.size, mimeType, kind, text };
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

// Pick multiple images and return their raw bytes in the order chosen, for building
// a combined PDF. Disposable picker copies are deleted after reading.
export async function pickImageBytes() {
  const result = await DocumentPicker.getDocumentAsync({ type: 'image/*', multiple: true, copyToCacheDirectory: true });
  if (result.canceled) return null;
  const assets = result.assets || [];
  const images = [];
  try {
    for (const asset of assets) {
      if (!/^(file|content):\/\//i.test(asset.uri || '')) continue;
      const file = new File(asset.uri);
      if (file.exists) images.push({ name: asset.name || file.name, bytes: await file.bytes() });
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
  const dir = workDir();
  if (!dir.exists) return;
  for (const item of dir.list()) {
    if (item instanceof File && item.modificationTime < Date.now() - 24 * 60 * 60 * 1000) {
      try { item.delete(); } catch { /* Do not block startup for an old cache file. */ }
    }
  }
}

export async function keepExport({ uri, name, mimeType }) {
  const source = new File(uri);
  if (!source.exists) throw new Error('The generated file is no longer available. Generate it again.');
  const kind = validateDocument({ name, mimeType, size: source.size });
  const dir = exportDir();
  dir.create({ idempotent: true, intermediates: true });
  const clean = safeName(name);
  const dot = clean.lastIndexOf('.');
  const stem = dot > 0 ? clean.slice(0, dot) : clean;
  const ext = dot > 0 ? clean.slice(dot) : '';
  let destination = new File(dir, clean);
  let suffix = 1;
  while (destination.exists) destination = new File(dir, `${stem} (${suffix++})${ext}`);
  try {
    await source.copy(destination);
  } catch (error) {
    try { if (destination.exists) destination.delete(); } catch { /* Preserve copy error. */ }
    throw error;
  }
  return { uri: destination.uri, name: destination.name, mimeType: mimeType || destination.type,
    size: destination.size, kind };
}

export function listExports() {
  const dir = exportDir();
  if (!dir.exists) return [];
  return dir.list().filter(item => item instanceof File)
    .sort((a, b) => b.modificationTime - a.modificationTime)
    .map(file => ({ uri: file.uri, name: file.name, size: file.size, mimeType: file.type }));
}

export function deleteExport(uri) {
  if (!uri.startsWith(`${exportDir().uri.replace(/\/$/, '')}/`)) throw new Error('Not an app export.');
  new File(uri).delete();
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
