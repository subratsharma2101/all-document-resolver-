import { File } from 'expo-file-system';

const sibling = (file, suffix) => new File(file.uri + suffix);

function readRecord(file) {
  let failure;
  for (const candidate of [file, sibling(file, '.backup')]) {
    if (!candidate.exists) continue;
    try { return { value: JSON.parse(candidate.textSync()), primary: candidate.uri === file.uri }; }
    catch (error) { failure = error; }
  }
  if (failure) throw failure;
  return null;
}

export function readStoredJson(file) { return readRecord(file)?.value ?? null; }

// Expo's Android overwrite move deletes the old destination before renaming.
// Retain a verified backup until the replacement itself has been read back.
// Callers serialize writes to each store, including removals.
export async function writeStoredJson(file, value) {
  const encoded = JSON.stringify(value);
  if (typeof encoded !== 'string') throw new Error('Settings could not be encoded.');
  const pendingUri = file.uri + '.pending', backupPendingUri = file.uri + '.backup.pending';
  const pending = new File(pendingUri), backupPending = new File(backupPendingUri), backup = sibling(file, '.backup');
  try {
    pending.write(encoded);
    if (pending.textSync() !== encoded) throw new Error('Settings write was incomplete.');
    let previous;
    try { previous = readRecord(file); } catch { /* A valid new value can repair corrupt settings. */ }
    if (previous?.primary) {
      const priorText = JSON.stringify(previous.value);
      backupPending.write(priorText);
      if (backupPending.textSync() !== priorText) throw new Error('Settings backup was incomplete.');
      await backupPending.move(backup, { overwrite: true });
      if (backup.textSync() !== priorText) throw new Error('Settings backup was incomplete.');
    }
    // If recovery was read from the backup, leave that only valid copy in place.
    try { await pending.move(file, { overwrite: true }); }
    catch (error) {
      // A copy+delete fallback can finish the destination, then fail cleanup.
      // Do not roll back document bytes when the new metadata is already valid.
      if (!file.exists || file.textSync() !== encoded) throw error;
    }
    if (file.textSync() !== encoded) throw new Error('Settings replacement was incomplete.');
    try { if (backup.exists) backup.delete(); } catch {}
  } finally {
    for (const uri of [pendingUri, backupPendingUri]) {
      try { const staged = new File(uri); if (staged.exists) staged.delete(); } catch {}
    }
  }
}

export function removeStoredJson(file) {
  const backup = sibling(file, '.backup');
  if (backup.exists) backup.delete();
  if (file.exists) file.delete();
  for (const suffix of ['.pending', '.backup.pending']) {
    try { const staged = sibling(file, suffix); if (staged.exists) staged.delete(); } catch {}
  }
}
