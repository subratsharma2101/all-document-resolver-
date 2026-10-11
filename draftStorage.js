import { Directory, File, Paths } from 'expo-file-system';
import { ensureWorkingSpace } from './fileService';
import { LIMITS, utf8Size } from './fileUtils.cjs';
import { readStoredJson, writeStoredJson, removeStoredJson } from './storedJson';
import { createListCache } from './listCache.cjs';

const root = () => new Directory(Paths.document, 'drafts');
const validId = id => typeof id === 'string' && /^[a-f0-9]{32}-\d+$/.test(id);
const snapshotPattern = /^\d+-\d+\.(txt|pdf|png|jpg|jpeg|webp)$/;
let queue = Promise.resolve(), serial = 0;
function serialized(fn) { const next = queue.then(fn); queue = next.catch(() => {}); return next; }
function folder(id) { if (!validId(id)) throw new Error('This file needs a copy in My Files before draft recovery is available.'); return new Directory(root(), id); }
function metadata(id) { return new File(folder(id), 'draft.json'); }
function readRecord(id, includeText = true) {
  const file = metadata(id);
  const record = readStoredJson(file);
  if (!record) return null;
  if (!snapshotPattern.test(record?.fileName || '') || !['text', 'pdf', 'image'].includes(record.kind) || record.id !== id || !Number.isFinite(record.size) || record.size < 0) throw new Error('This saved draft could not be read.');
  const snapshot = new File(folder(id), record.fileName);
  if (!snapshot.exists || snapshot.size !== record.size || record.size > LIMITS[record.kind]) throw new Error('This draft is incomplete. The original in My Files is safe.');
  return { ...record, uri: snapshot.uri, ...(includeText && record.kind === 'text' ? { text: snapshot.textSync() } : {}) };
}
export function readDraft(doc) {
  if (!validId(doc?.libraryId)) return null;
  try { const record = readRecord(doc.libraryId); return record?.kind === doc.kind ? record : null; } catch { return null; }
}
const draftsCache = createListCache(() => {
  if (!root().exists) return [];
  return root().list().filter(item => item instanceof Directory && validId(item.name)).flatMap(item => {
    try { const record = readRecord(item.name, false); return record ? [record] : []; } catch { return []; }
  }).sort((a, b) => b.savedAt - a.savedAt);
});
export function listDrafts() {
  return draftsCache.read();
}
export function saveDraft(doc, snapshot) {
  return serialized(async () => {
    try {
      return await storeDraft(doc, snapshot);
    } finally { draftsCache.invalidate(); }
  });
}
function storeDraft(doc, snapshot) {
  return (async () => {
    const id = doc.libraryId, dir = folder(id);
    const kind = doc.kind;
    let size, extension, source;
    if (kind === 'text') {
      if (typeof snapshot.text !== 'string') throw new Error('Draft text is missing.');
      size = utf8Size(snapshot.text); extension = 'txt';
    } else {
      if (!['pdf', 'image'].includes(kind) || !/^(file):\/\//.test(snapshot.uri || '')) throw new Error('The draft source is unavailable.');
      source = new File(snapshot.uri);
      if (!source.exists) throw new Error('The draft source is unavailable.');
      size = source.size;
      extension = kind === 'pdf' ? 'pdf' : ['png', 'webp', 'jpeg'].includes(snapshot.options?.format) ? snapshot.options.format : 'jpg';
    }
    if (size > LIMITS[kind] || size < 0 || !Number.isFinite(size)) throw new Error('This draft exceeds the file size limit.');
    const used = listDrafts().filter(item => item.id !== id).reduce((sum, item) => sum + item.size, 0);
    if (used + size > 200_000_000) throw new Error('Draft storage is full. Save or discard an older draft to make room.');
    ensureWorkingSpace(size);
    dir.create({ intermediates: true, idempotent: true });
    const fileName = `${Date.now()}-${++serial}.${extension}`, copy = new File(dir, fileName);
    let committed = false;
    try {
      if (kind === 'text') copy.write(snapshot.text);
      else await source.copy(copy);
      if (copy.size !== size || source && copy.md5 !== source.md5) throw new Error('The draft copy was incomplete.');
      const record = { id, name: doc.name, kind, mimeType: doc.mimeType, fileName, size, savedAt: Date.now(), options: snapshot.options || {} };
      await writeStoredJson(metadata(id), record);
      committed = true;
      // Also clear snapshots left behind by a process exit after a previous commit.
      try {
        for (const item of dir.list()) {
          if (item instanceof File && snapshotPattern.test(item.name) && item.name !== fileName) {
            try { item.delete(); } catch {}
          }
        }
      } catch {}
      return { ...record, uri: copy.uri };
    } finally {
      if (!committed) { try { if (copy.exists) copy.delete(); } catch {} }
    }
  })();
}
export function discardDraft(docOrId) {
  const id = typeof docOrId === 'string' ? docOrId : docOrId?.libraryId;
  if (!validId(id)) return Promise.resolve();
  return serialized(async () => {
    try {
      const dir = folder(id);
      if (!dir.exists) return;
      const meta = metadata(id);
      removeStoredJson(meta);
      for (const item of dir.list()) {
        if (item instanceof File && (snapshotPattern.test(item.name) || item.name === 'draft.pending.json')) {
          try { item.delete(); } catch {}
        }
      }
    } finally { draftsCache.invalidate(); }
  });
}
