import { File, Paths } from 'expo-file-system';
import { StorageAccessFramework as SAF, EncodingType } from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { safeName } from './fileUtils.cjs';
import { streamToDocument } from './nativeFileTools';
import { readStoredJson, writeStoredJson } from './storedJson';

const settingsFile = () => new File(Paths.document, 'phone-save.json');
let state;
let queue = Promise.resolve();

function settings() {
  if (!state) {
    state = { folder: null, receipts: {} };
    try {
      const file = settingsFile();
      const saved = readStoredJson(file);
      if (saved?.folder && /^content:\/\//i.test(saved.folder.uri)) {
        state.folder = { uri: saved.folder.uri, label: folderLabel(saved.folder.uri) };
      }
      if (saved?.receipts && typeof saved.receipts === 'object' && !Array.isArray(saved.receipts)) state.receipts = saved.receipts;
    } catch { /* A missing/corrupt preference can be set again without losing files. */ }
  }
  return state;
}

async function persist() {
  try { await writeStoredJson(settingsFile(), settings()); return true; }
  catch { return false; } // Keep this session's receipts even if preference storage is full.
}

function serialized(action) {
  const pending = queue.then(action);
  queue = pending.catch(() => {});
  return pending;
}

function folderLabel(uri) {
  try {
    const tree = decodeURIComponent(uri.split('/tree/')[1]?.split('/document/')[0] || '');
    const separator = tree.indexOf(':');
    if (separator >= 0) return tree.slice(separator + 1) || 'Phone storage';
  } catch { /* Providers may use opaque identifiers instead of paths. */ }
  return 'Selected folder';
}

export function getSaveFolder() { return settings().folder; }

async function pickFolder() {
  const access = await SAF.requestDirectoryPermissionsAsync(settings().folder?.uri);
  if (!access.granted) return null;
  if (!/^content:\/\//i.test(access.directoryUri || '')) throw new Error('Choose a folder on your phone.');
  // Android keeps the directory grant; storing its URI avoids asking on every save.
  await SAF.readDirectoryAsync(access.directoryUri);
  const folder = { uri: access.directoryUri, label: folderLabel(access.directoryUri) };
  settings().folder = folder;
  await persist();
  return folder;
}

export function chooseSaveFolder() {
  return serialized(() => Platform.OS === 'android' ? pickFolder() : null);
}

const receiptKey = (folder, output) => JSON.stringify([folder.uri, output.uri]);

export function getPhoneSaveReceipt(output) {
  const folder = getSaveFolder();
  if (!folder) return null;
  const receipt = settings().receipts[receiptKey(folder, output)];
  return receipt?.size === output.size && typeof receipt.uri === 'string' ? { ...receipt, folderLabel: folder.label } : null;
}

// One directory choice for a whole batch, reused on later saves and app restarts.
// A receipt is written only after the provider finishes writing the new document.
export function saveOutputsToPhone(outputs, onProgress) {
  return serialized(async () => {
    if (Platform.OS !== 'android') return { status: 'share', saved: [], pending: outputs };
    if (!Array.isArray(outputs) || !outputs.length) throw new Error('Choose at least one file to save.');
    for (const output of outputs) {
      if (!/^file:\/\//i.test(output.uri || '') || !new File(output.uri).exists) {
        throw new Error('A file is no longer available in the app. Open or generate it again.');
      }
    }
    const folder = getSaveFolder() || await pickFolder();
    if (!folder) return { status: 'cancelled', saved: [], pending: outputs };
    let existing;
    try { existing = new Set(await SAF.readDirectoryAsync(folder.uri)); }
    catch {
      return { status: 'needs-folder', folder, saved: [], pending: outputs,
        error: 'The save folder is unavailable. Choose a folder to continue.' };
    }
    const saved = [];
    let remembered = true;
    for (let index = 0; index < outputs.length; index++) {
      const output = outputs[index], source = new File(output.uri);
      onProgress?.(`Saving ${index + 1} of ${outputs.length}...`);
      const key = receiptKey(folder, output), receipt = settings().receipts[key];
      if (receipt?.size === source.size && existing.has(receipt.uri)) {
        saved.push({ ...output, phoneUri: receipt.uri, alreadySaved: true });
        continue;
      }
      let created;
      try {
        const name = safeName(output.name).replace(/\.[^.]+$/, '');
        const uri = await SAF.createFileAsync(folder.uri, name, output.mimeType || 'application/octet-stream');
        // Never write/delete an older document even if a provider reuses its URI.
        if (existing.has(uri)) throw new Error('This folder returned an existing file. Choose another folder to save a new copy.');
        created = uri;
        // Stream when the native module is present; base64 would hold the whole file in memory.
        if (!await streamToDocument(output.uri, uri)) {
          await SAF.writeAsStringAsync(uri, await source.base64(), { encoding: EncodingType.Base64 });
        }
        settings().receipts[key] = { uri, size: source.size, folderLabel: folder.label, savedAt: Date.now() };
        remembered = await persist() && remembered;
        existing.add(uri);
        saved.push({ ...output, phoneUri: uri });
      } catch (error) {
        let cleanupNote = '';
        if (created) {
          try { await SAF.deleteAsync(created, { idempotent: true }); }
          catch { cleanupNote = ' An incomplete copy may remain in that folder.'; }
        }
        return { status: 'failed', folder, saved, pending: outputs.slice(index),
          error: (error.message || 'Could not save this file.') + cleanupNote };
      }
    }
    return { status: 'saved', folder, saved, pending: [], remembered };
  });
}
