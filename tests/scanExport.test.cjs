const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const { transformFileSync } = require('@babel/core');
const { MAX_CONVERT_IMAGES, MAX_OUTPUT_BYTES } = require('../conversions.cjs');
const { code } = transformFileSync(path.join(__dirname, '../scanExport.js'), {
  configFile: false, babelrc: false, plugins: ['@babel/plugin-transform-modules-commonjs'],
});

function setup() {
  const inputs = new Map([['file:///source/a.jpg', Buffer.from('first scanned image')], ['content://scanner/b', Buffer.from('second scanned image')]]);
  const files = new Map(inputs), exported = [], cleaned = [], compressed = [], progress = [];
  const state = { imports: 0, keeps: 0, builds: 0, imageType: 'jpg' };
  files.set('file:///exports/older.jpg', Buffer.from('older user export'));
  const service = {
    importDocument: async asset => {
      state.imports++;
      if (state.imports === state.failImportAt) throw new Error('Source unavailable');
      assert.ok(inputs.has(asset.uri), 'source must be a scanner URI');
      const uri = `file:///work/page-${state.imports}.jpg`;
      files.set(uri, Buffer.from(inputs.get(asset.uri)));
      return { uri, name: asset.name, imageMetadata: { type: state.imageType } };
    },
    compressImageForPdf: async uri => {
      compressed.push(uri);
      if (state.oversize) return { byteLength: MAX_OUTPUT_BYTES + 1 };
      return Buffer.from(files.get(uri));
    },
    keepExport: async output => {
      state.keeps++;
      if (state.keeps === state.failKeepAt) throw new Error('Disk full');
      const uri = `file:///exports/${output.name}`;
      files.set(uri, Buffer.from(files.get(output.uri)));
      const saved = { ...output, uri, size: files.get(uri).length };
      exported.push(saved);
      return saved;
    },
    deleteExport: uri => { if (state.failRollback) throw new Error('Delete failed'); files.delete(uri); },
    ensureWorkingSpace: () => {},
    newWorkingFile: name => ({
      uri: `file:///work/${name}`,
      write(bytes) { files.set(this.uri, Buffer.from(bytes)); if (state.failWrite) throw new Error('Write failed'); },
    }),
    removeWorkingFile: uri => { assert.ok(uri.startsWith('file:///work/')); cleaned.push(uri); files.delete(uri); },
  };
  const exports = {};
  vm.runInNewContext(code, { exports, Date, require: name => {
    if (name === './fileService') return service;
    if (name === './conversions.cjs') return { MAX_CONVERT_IMAGES, MAX_OUTPUT_BYTES, buildPdfFromImages: async images => {
      state.builds++; state.pdfInputs = images.map(bytes => Buffer.from(bytes));
      return Buffer.from('%PDF-test-output');
    } };
    throw new Error(name);
  } });
  return { save: (uris, format) => exports.exportScannedPages(uris, format, value => progress.push(value)), files, inputs, exported, cleaned, compressed, progress, state };
}

test('image choice saves separate JPG copies, preserves bytes and never builds a PDF', async () => {
  const f = setup();
  const saved = await f.save(['/source/a.jpg', 'content://scanner/b'], 'image');
  assert.equal(saved.length, 2);
  assert.match(saved[0].name, /page-01\.jpg$/);
  assert.match(saved[1].name, /page-02\.jpg$/);
  assert.equal(saved[0].mimeType, 'image/jpeg');
  assert.deepEqual(f.files.get(saved[0].uri), f.inputs.get('file:///source/a.jpg'));
  assert.deepEqual(f.files.get(saved[1].uri), f.inputs.get('content://scanner/b'));
  assert.equal(f.compressed.length, 0);
  assert.equal(f.state.builds, 0);
  assert.equal(f.cleaned.length, 2);
  assert.equal(f.files.has('content://scanner/b'), true);
  assert.equal(f.files.has('file:///exports/older.jpg'), true);
});

test('PDF choice combines the pages in order and cleans temporary inputs and output', async () => {
  const f = setup();
  const saved = await f.save([...f.inputs.keys()], 'pdf');
  assert.equal(saved.length, 1);
  assert.match(saved[0].name, /\.pdf$/);
  assert.equal(saved[0].mimeType, 'application/pdf');
  assert.equal(f.compressed.length, 2);
  assert.equal(f.state.builds, 1);
  assert.deepEqual(f.state.pdfInputs[0], f.inputs.get('file:///source/a.jpg'));
  assert.deepEqual(f.state.pdfInputs[1], f.inputs.get('content://scanner/b'));
  assert.equal(f.cleaned.length, 3);
  assert.equal([...f.files.keys()].some(uri => uri.startsWith('file:///work/')), false);
});

test('failed image batch rolls back only new exports and leaves scanner originals intact', async () => {
  const f = setup(); f.state.failKeepAt = 2;
  await assert.rejects(f.save([...f.inputs.keys()], 'image'), /Disk full/);
  assert.equal([...f.files.keys()].filter(uri => uri.startsWith('file:///exports/')).length, 1);
  assert.equal(f.files.has('file:///exports/older.jpg'), true);
  assert.equal([...f.files.keys()].some(uri => uri.startsWith('file:///work/')), false);
  for (const [uri, bytes] of f.inputs) assert.deepEqual(f.files.get(uri), bytes);
});

test('rollback errors explicitly disclose retained partial copies', async () => {
  const f = setup(); f.state.failKeepAt = 2; f.state.failRollback = true;
  await assert.rejects(f.save([...f.inputs.keys()], 'image'), /1 partial image copy\/copies remain/);
});

test('unavailable later pages roll back images and clean earlier working copies', async () => {
  const f = setup(); f.state.failImportAt = 2;
  await assert.rejects(f.save([...f.inputs.keys()], 'image'), /Source unavailable/);
  assert.equal([...f.files.keys()].filter(uri => uri.startsWith('file:///exports/')).length, 1);
  assert.equal(f.cleaned.length, 1);
});

test('invalid formats, page counts and remote URIs fail before any processing', async () => {
  const f = setup();
  await assert.rejects(f.save([], 'image'), /between 1/);
  await assert.rejects(f.save(Array(MAX_CONVERT_IMAGES + 1).fill('/source/a.jpg'), 'pdf'), /between 1/);
  await assert.rejects(f.save(['/source/a.jpg'], 'zip'), /Choose/);
  await assert.rejects(f.save(['https://example.com/a.jpg'], 'image'), /local/);
  assert.equal(f.state.imports, 0);
});

test('JPEG export refuses other byte formats, instead of mislabeling them', async () => {
  const f = setup(); f.state.imageType = 'png';
  await assert.rejects(f.save(['/source/a.jpg'], 'image'), /did not return a JPG/);
  assert.equal(f.state.keeps, 0);
  assert.equal(f.cleaned.length, 1);
});

test('PDF input size and failed output writes are handled without leaked working files', async () => {
  const f = setup(); f.state.oversize = true;
  await assert.rejects(f.save(['/source/a.jpg'], 'pdf'), /25 MiB/);
  assert.equal(f.state.builds, 0);
  f.state.oversize = false; f.state.failWrite = true;
  await assert.rejects(f.save(['/source/a.jpg'], 'pdf'), /Write failed/);
  assert.equal([...f.files.keys()].some(uri => uri.startsWith('file:///work/')), false);
});

test('scan format dialog resolves image, PDF, cancel and Android back dismissal', async () => {
  const compiled = transformFileSync(path.join(__dirname, '../App.js'), {
    configFile: false, babelrc: false, plugins: ['@babel/plugin-transform-modules-commonjs', '@babel/plugin-transform-react-jsx'],
  }).code;
  let dialog;
  const context = vm.createContext({ exports: {}, require: name => name === 'react-native'
    ? { Alert: { alert: (title, message, buttons, options) => { dialog = { title, message, buttons, options }; } } }
    : {} });
  vm.runInContext(`${compiled}\nglobalThis.choose = chooseScanFormat;`, context);
  for (const [label, expected] of [['JPG images', 'image'], ['PDF document', 'pdf'], ['Cancel', null]]) {
    const pending = context.choose(3);
    assert.match(dialog.message, /3 scanned pages/);
    dialog.buttons.find(button => button.text === label).onPress();
    dialog.options.onDismiss(); // Native dismissal cannot overwrite the selected result.
    assert.equal(await pending, expected);
  }
  const dismissed = context.choose(1);
  assert.equal(dialog.buttons[0].text, 'JPG image');
  dialog.options.onDismiss();
  assert.equal(await dismissed, null);
});
