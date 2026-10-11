import { Directory, File, Paths } from 'expo-file-system';
import { ensureWorkingSpace } from './fileService';
import { safeName, validateDocument } from './fileUtils.cjs';
import { fingerprint, sampleRanges } from './fileIdentity.cjs';
import { createListCache } from './listCache.cjs';
import { readStoredJson, writeStoredJson } from './storedJson';

// Bounded sampled read instead of a full-file native hash on the JS thread.
function identify(file) {
  const size = file.size;
  const handle = file.open();
  try {
    return fingerprint(size, sampleRanges(size).map(range => {
      handle.offset = range.offset;
      return handle.readBytes(range.length);
    }));
  } finally { handle.close(); }
}

const folder = () => new Directory(Paths.document, 'library');
const recordFile = item => new File(folder(), item.id, item.fileName);
const indexFile = () => new File(Paths.document, 'library-index.json');
const MAX_FILES = 100;
const MAX_BYTES = 200_000_000;
let queue = Promise.resolve();
function serialize(task) {
  const result = queue.then(task);
  queue = result.catch(() => {});
  return result;
}
function records() {
  const file = indexFile();
  const parsed = readStoredJson(file);
  if (!parsed) return [];
  if (!Array.isArray(parsed)) throw new Error('My Files could not be read. You can still open files from your phone.');
  return parsed.filter(item => /^[a-f0-9]{32}-\d+$/.test(item?.id || '') &&
    typeof item.fileName === 'string' && item.fileName.length > 0 && safeName(item.fileName) === item.fileName &&
    ['pdf', 'image', 'text'].includes(item.kind) && typeof item.name === 'string' &&
    Number.isFinite(item.size) && item.size >= 0);
}
async function commit(items) {
  try { await writeStoredJson(indexFile(), items); }
  finally { libraryCache.invalidate(); }
}
function exposed(item) { return { ...item, uri: recordFile(item).uri, libraryId: item.id }; }
function cleanReading(item = {}) {
  const pageCount = Number.isInteger(item.pageCount) && item.pageCount > 0 ? item.pageCount : 0;
  const page = Number.isInteger(item.page) && item.page > 0 ? Math.min(item.page, pageCount || item.page) : 1;
  const bookmarks = [...new Set((Array.isArray(item.bookmarks) ? item.bookmarks : [])
    .filter(value => Number.isInteger(value) && value > 0 && (!pageCount || value <= pageCount)))].sort((a, b) => a - b).slice(0, 100);
  return { page, pageCount, bookmarks };
}

const libraryCache = createListCache(() => records().filter(item => recordFile(item).exists)
  .sort((a, b) => (b.openedAt || 0) - (a.openedAt || 0)).map(exposed));

export function listLibrary() {
  return libraryCache.read();
}

// Own a durable copy: picker/cache URLs can disappear after the document closes.
// Content identity keeps reading progress when the same file is picked again;
// two different documents with the same name and size never share that progress.
export function rememberDocument(doc) {
  return serialize(async () => {
    const source = new File(doc.uri);
    const kind = validateDocument({ ...doc, size: source.size });
    const hash = identify(source);
    if (!/^[a-f0-9]{32}$/i.test(hash || '')) throw new Error('This file could not be added to My Files.');
    const id = `${hash.toLowerCase()}-${source.size}`;
    const all = records().filter(item => recordFile(item).exists);
    const existing = all.find(item => item.id === id);
    if (existing) {
      existing.openedAt = Date.now();
      await commit(all);
      return exposed(existing);
    }
    if (all.length >= MAX_FILES || all.reduce((sum, item) => sum + item.size, 0) + source.size > MAX_BYTES) {
      throw new Error('My Files is full (100 files / 200 MB). Remove an app copy to make room. This file can still be viewed.');
    }
    ensureWorkingSpace(source.size);
    folder().create({ idempotent: true, intermediates: true });
    const documentFolder = new Directory(folder(), id);
    documentFolder.create({ idempotent: true, intermediates: true });
    const fileName = safeName(doc.name);
    const destination = new File(documentFolder, fileName);
    const pending = new File(documentFolder, '.pending');
    const item = { id, fileName, name: safeName(doc.name), size: source.size, kind,
      mimeType: doc.mimeType, openedAt: Date.now(), favorite: false, ...cleanReading() };
    let published = false;
    try {
      // A previous interrupted commit may have left the complete content-addressed copy.
      if (destination.exists && (destination.size !== source.size || identify(destination) !== hash)) destination.delete();
      if (!destination.exists) {
        if (pending.exists) pending.delete();
        await source.copy(pending);
        if (pending.size !== source.size || identify(pending) !== hash) throw new Error('The recent file copy was incomplete.');
        await pending.move(destination);
        published = true;
      }
      await commit([...all, item]);
      return exposed(item);
    } catch (error) {
      if (published) { try { if (destination.exists) destination.delete(); } catch {} }
      throw error;
    } finally { try { if (pending.exists && pending.uri !== destination.uri) pending.delete(); } catch {} }
  });
}

function update(id, edit) {
  return serialize(async () => {
    const all = records();
    const item = all.find(value => value.id === id);
    if (!item) throw new Error('This document is no longer in My Files.');
    edit(item);
    await commit(all);
    return exposed(item);
  });
}
export function renameLibraryDocument(id, value) {
  return serialize(async () => {
    const all = records(), item = all.find(entry => entry.id === id);
    if (!item) throw new Error('This document is no longer in My Files.');
    const name = safeName(value.trim());
    if (!value.trim()) throw new Error('Enter a file name.');
    const oldExtension = item.name.includes('.') ? item.name.split('.').pop() : '';
    if (oldExtension && !name.toLowerCase().endsWith(`.${oldExtension.toLowerCase()}`)) throw new Error(`Keep the .${oldExtension} file extension.`);
    if (name === item.name) return exposed(item);
    const old = { ...item }, source = recordFile(item);
    const destination = recordFile({ ...item, fileName: name });
    if (destination.exists) throw new Error('A copy with that name already exists. Choose another name.');
    // Publish the new name before dropping the old copy, so an interruption
    // during rename leaves a complete file reachable by the previous index.
    ensureWorkingSpace(item.size);
    try {
      await source.copy(destination);
      if (destination.size !== source.size || identify(destination) !== identify(source)) {
        throw new Error('The rename copy was incomplete. The previous name is unchanged.');
      }
      item.name = name; item.fileName = name;
      await commit(all);
    }
    catch (error) { try { if (destination.exists) destination.delete(); } catch {} throw error; }
    try { recordFile(old).delete(); } catch { /* The committed new name stays usable. */ }
    return exposed(item);
  });
}
export function setLibraryFavorite(id, favorite) { return update(id, item => { item.favorite = !!favorite; }); }
export function removeLibraryDocument(id) {
  return serialize(async () => {
    const all = records(), item = all.find(value => value.id === id);
    if (!item) return;
    const file = recordFile(item);
    // Delete only the owned library copy. Exports and the original are independent.
    if (file.exists) file.delete();
    await commit(all.filter(value => value.id !== id));
  });
}
export function getReadingState(id) { return cleanReading(id ? records().find(item => item.id === id) : undefined); }
export function updateReadingState(id, page, pageCount) {
  if (!Number.isInteger(pageCount) || pageCount < 1 || !Number.isInteger(page) || page < 1 || page > pageCount) return Promise.resolve();
  return update(id, item => { Object.assign(item, cleanReading({ ...item, page, pageCount })); });
}
export function togglePageBookmark(id, page) {
  return update(id, item => {
    const state = cleanReading(item);
    if (!Number.isInteger(page) || page < 1 || page > state.pageCount) throw new Error('Wait for this PDF page to finish loading.');
    if (!state.bookmarks.includes(page) && state.bookmarks.length >= 100) throw new Error('Up to 100 bookmarks can be saved per PDF.');
    item.bookmarks = state.bookmarks.includes(page) ? state.bookmarks.filter(value => value !== page) : [...state.bookmarks, page].sort((a, b) => a - b);
  });
}
