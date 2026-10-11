import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { discardDraft, saveDraft } from './draftStorage';

export default function useDraftAutosave({ doc, dirty, revision, snapshot, restored, onDraftChange, onDraftStored }) {
  const [status, setStatus] = useState(restored ? 'Draft restored' : '');
  const timer = useRef(null), pending = useRef(null), alive = useRef(true), sequence = useRef(0);
  const inFlight = useRef(Promise.resolve());
  const wasDirty = useRef(false);
  const latest = useRef({ doc, snapshot, onDraftChange, onDraftStored }); latest.current = { doc, snapshot, onDraftChange, onDraftStored };
  async function flush() {
    clearTimeout(timer.current);
    const job = pending.current; pending.current = null;
    if (!job) return inFlight.current;
    const task = saveDraft(job.doc, job.snapshot);
    inFlight.current = task.catch(() => {});
    try {
      await task;
      latest.current.onDraftStored?.();
      if (alive.current && sequence.current === job.sequence) { setStatus('Draft saved on this device'); latest.current.onDraftChange?.(true); }
    } catch (error) {
      if (alive.current && sequence.current === job.sequence) { setStatus(error.message || 'Draft could not be saved'); latest.current.onDraftChange?.(false); }
    }
  }
  useEffect(() => {
    sequence.current++;
    clearTimeout(timer.current);
    const reverted = wasDirty.current && !dirty;
    wasDirty.current = dirty;
    if (!dirty) {
      pending.current = null; onDraftChange?.(true);
      if (reverted) clear();
      return;
    }
    onDraftChange?.(false);
    if (!doc.libraryId) { setStatus('Add this file to My Files to keep an automatic draft.'); return; }
    pending.current = { doc, snapshot: latest.current.snapshot, sequence: sequence.current };
    setStatus('Saving draft…');
    timer.current = setTimeout(flush, 500);
  }, [doc.libraryId, dirty, revision]);
  useEffect(() => {
    alive.current = true;
    const subscription = AppState.addEventListener('change', value => { if (value !== 'active') flush(); });
    return () => { alive.current = false; subscription.remove(); flush(); };
  }, []);
  async function clear() {
    const clearedSequence = ++sequence.current;
    clearTimeout(timer.current); pending.current = null;
    try {
      await discardDraft(latest.current.doc);
      latest.current.onDraftStored?.();
      if (alive.current && sequence.current === clearedSequence) { setStatus('No unfinished draft'); latest.current.onDraftChange?.(true); }
    } catch {
      if (alive.current && sequence.current === clearedSequence) { setStatus('The older draft could not be cleared.'); latest.current.onDraftChange?.(true); }
    }
  }
  return { status, flush, clear };
}
