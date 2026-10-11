const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, elements, button, text } = require('./helpers/saveFlowHarness.cjs');
const child = (tree, type) => elements(tree).find(node => node.type === type);

test('text recovery opens the last draft and exporting clears it without changing original text', async () => {
  const f = setup('TextEditor.js', { './draftStorage': { readDraft: () => ({ kind: 'text', text: 'Recovered नमस्ते' }) } });
  assert.equal(child(f.render(), 'TextInput').props.value, 'Recovered नमस्ते');
  assert.equal(f.stats.dirty.at(-1), true);
  await button(f.render(), 'Save text').props.onPress();
  assert.equal(f.stats.discarded.length, 1); assert.equal(f.doc.text, 'Original text');
});

test('recovered PDFs use an independent editing copy and saving never modifies the draft or original', async () => {
  const snapshot = 'file:///documents/drafts/snapshot.pdf';
  const f = setup('PdfEditor.js', { './draftStorage': { readDraft: () => ({ kind: 'pdf', uri: snapshot }) } });
  Object.assign(f.doc, { kind: 'pdf', uri: 'file:///source.pdf', name: 'source.pdf' });
  f.files.set(snapshot, new Uint8Array([8, 9])); f.files.set(f.doc.uri, new Uint8Array([1, 2]));
  f.render(); await f.flush();
  const working = child(f.render(), 'PdfViewer').props.uri;
  assert.notEqual(working, snapshot); assert.notEqual(working, f.doc.uri);
  assert.deepEqual(Array.from(f.files.get(working)), [8, 9]);
  await button(f.render(), 'Save').props.onPress();
  assert.equal(f.stats.keeps[0].uri, working); assert.equal(f.stats.discarded.length, 1);
  assert.deepEqual(Array.from(f.files.get(snapshot)), [8, 9]);
  assert.deepEqual(Array.from(f.files.get(f.doc.uri)), [1, 2]); f.unmount();
});

test('recovered image previews preserve export format, applied rotation and original bytes', async () => {
  const snapshot = 'file:///documents/drafts/snapshot.png';
  const f = setup('ImageEditor.js', {
    './draftStorage': { readDraft: () => ({ kind: 'image', uri: snapshot, options: { format: 'png', rotation: 90, quality: 1, fits: true, targetKb: '400', maxWidth: '800' } }) },
    './safeImage': { inspectImageFile: () => ({ width: 500, height: 800 }) },
    './imageOperations.cjs': require('../imageOperations.cjs'),
    './imageSafety.cjs': require('../imageSafety.cjs'),
    'expo-image': { Image: 'Image' },
    'expo-image-manipulator': {},
  });
  Object.assign(f.doc, { kind: 'image', uri: 'file:///source.jpg', name: 'source.jpg', mimeType: 'image/jpeg' });
  f.files.set(snapshot, new Uint8Array([8, 9])); f.files.set(f.doc.uri, new Uint8Array([1, 2]));
  f.render(); await f.flush();
  const preview = child(f.render(), 'Image').props.source.uri;
  assert.notEqual(preview, snapshot); assert.deepEqual(Array.from(f.files.get(preview)), [8, 9]);
  assert.equal(button(f.render(), '90°').props.accessibilityState.selected, true);
  await button(f.render(), 'Save a copy').props.onPress();
  assert.equal(f.stats.keeps[0].mimeType, 'image/png'); assert.equal(f.stats.discarded.length, 1);
  assert.equal(f.files.has(preview), false); assert.equal(f.files.has(snapshot), true);
  assert.deepEqual(Array.from(f.files.get(f.doc.uri)), [1, 2]); f.unmount();
});

test('failed image reprocessing preserves the previous preview and its recovery state', async () => {
  const snapshot = 'file:///documents/drafts/ready.png';
  const Image = Object.assign(function Image() {}, { clearMemoryCache: async () => {} });
  const f = setup('ImageEditor.js', {
    './draftStorage': { readDraft: () => ({ kind: 'image', uri: snapshot, options: { format: 'png', rotation: 0, quality: 1, fits: true, targetKb: '', maxWidth: '' } }) },
    './safeImage': { inspectImageFile: () => ({ width: 500, height: 800 }), loadBoundedImage: async () => { throw new Error('Decode failed'); } },
    './imageOperations.cjs': require('../imageOperations.cjs'), './imageSafety.cjs': require('../imageSafety.cjs'),
    'expo-image': { Image }, 'expo-image-manipulator': {},
  });
  Object.assign(f.doc, { kind: 'image', uri: 'file:///source.jpg', name: 'source.jpg', mimeType: 'image/jpeg' });
  f.files.set(snapshot, new Uint8Array([8, 9])); f.render(); await f.flush();
  const preview = elements(f.render()).find(node => node.props?.accessibilityLabel === 'Processed image preview').props.source.uri;
  await button(f.render(), 'Process image').props.onPress();
  assert.match(text(f.render()), /Decode failed/); assert.equal(f.files.has(preview), true);
  assert.equal(f.stats.dirty.at(-1), true); assert.equal(f.stats.discarded.length, 0);
  assert.equal(button(f.render(), 'Save a copy').props.disabled, false);
  f.unmount();
});

test('Home resumes a draft directly into editing and saved recovery avoids another close prompt', async () => {
  const f = setup(), item = { ...f.doc, id: 'library-id', libraryId: 'library-id' };
  f.stats.library.push(item); f.stats.drafts.push({ ...item, uri: 'file:///draft.txt' });
  f.render();
  await child(f.render(), 'Dashboard').props.onResumeDraft(f.stats.drafts[0]);
  await f.flush();
  const editor = child(f.render(), 'TextEditor'); assert.ok(editor);
  editor.props.onDirtyChange(true); editor.props.onDraftChange(true);
  button(f.render(), 'Close document').props.onPress();
  assert.equal(f.alerts.length, 0); assert.ok(child(f.render(), 'Dashboard'));
});

function tools(mode = 'ocr') {
  const calls = { recognition: 0, saves: [], opened: [] };
  const f = setup('DocumentTools.js', { './documentJobs': {
    parseToolPages: () => [1, 2],
    recognizeDocument: async () => { calls.recognition++; return { text: 'नमस्ते hello', completed: 1, total: 1, error: '', cancelled: false }; },
    exportPdfImages: async () => ({ outputs: [{ uri: 'file:///exports/one.png', name: 'one.png' }], completed: 1, total: 2, error: 'Second page failed', cancelled: false }),
  } });
  Object.assign(f.doc, { kind: mode === 'ocr' ? 'image' : 'pdf', name: mode === 'ocr' ? 'scan.jpg' : 'report.pdf' });
  Object.assign(f.props, { mode, onSave: async copies => calls.saves.push(copies), onTextReady: async (...args) => calls.opened.push(args) });
  return { ...f, calls };
}

test('OCR rapid taps and repeated recognition keep one result copy, with a direct phone save and editable text', async () => {
  const f = tools(); await button(f.render(), 'Choose image').props.onPress();
  const run = button(f.render(), 'Recognize text').props.onPress;
  await Promise.all([run(), run()]); await button(f.render(), 'Recognize text').props.onPress();
  assert.equal(f.calls.recognition, 1); assert.equal(f.stats.keeps.length, 1);
  await button(f.render(), 'Save text to phone').props.onPress();
  assert.equal(f.calls.saves[0][0].uri, f.stats.exports[0].uri);
  await button(f.render(), 'Edit recognized text').props.onPress();
  assert.deepEqual(Array.from(f.calls.opened[0]), ['नमस्ते hello', 'scan-text.txt']);
  assert.equal(f.stats.busy.at(-1), false); f.unmount();
});

test('changing OCR language starts fresh recognition, while cancelled picking retains the previous image', async () => {
  const f = tools(); await button(f.render(), 'Choose image').props.onPress();
  await button(f.render(), 'Recognize text').props.onPress();
  button(f.render(), 'English').props.onPress();
  await button(f.render(), 'Recognize text').props.onPress();
  assert.equal(f.calls.recognition, 2);
  f.modules['./fileService'].pickDocument = async () => null;
  await button(f.render(), 'Choose image').props.onPress();
  assert.match(text(f.render()), /scan.jpg/); f.unmount();
});

test('partial page conversion saves completed copies and retry uses those same exports', async () => {
  const f = tools('pages'); await button(f.render(), 'Choose PDF').props.onPress();
  await button(f.render(), 'Convert and save').props.onPress();
  assert.equal(f.calls.saves.length, 1); assert.match(text(f.render()), /Second page failed/);
  await button(f.render(), 'Save ready images').props.onPress();
  assert.equal(f.calls.saves.length, 2); assert.equal(f.calls.saves[0][0].uri, f.calls.saves[1][0].uri);
  assert.equal(f.stats.keeps.length, 0); f.unmount();
});
