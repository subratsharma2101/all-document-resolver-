const test = require('node:test');
const assert = require('node:assert/strict');
const { detectKind, safeName, copyName, validateDocument, formatSize, utf8Size, LIMITS } = require('../fileUtils.cjs');

test('file detection works with extensions and provider MIME types', () => {
  assert.equal(detectKind('REPORT.PDF'), 'pdf');
  assert.equal(detectKind('opaque-id', 'image/jpeg'), 'image');
  assert.equal(detectKind('data.json'), 'text');
  assert.equal(detectKind('data.zip'), 'unsupported');
});
test('export names cannot contain traversal or control characters', () => {
  assert.equal(safeName('../../test.txt'), '_.._test.txt');
  assert.equal(safeName('a\u0000b/c.txt'), 'a_b_c.txt');
  assert.equal(copyName('notes.md'), 'notes-edited.md');
  assert.equal(copyName('untitled'), 'untitled-edited.txt');
});
test('size limits and empty documents are validated before parsing', () => {
  assert.equal(validateDocument({ name: 'empty.txt', size: 0 }), 'text');
  assert.throws(() => validateDocument({ name: 'empty.pdf', size: 0 }), /empty/);
  assert.throws(() => validateDocument({ name: 'big.pdf', size: LIMITS.pdf + 1 }), /under/);
  assert.throws(() => validateDocument({ name: 'bad.txt', size: NaN }), /size/);
  assert.throws(() => validateDocument({ name: 'file.exe', size: 25 }), /not supported/);
});
test('file sizes use decimal KB consistently with upload targets', () => {
  assert.equal(formatSize(50000), '50.0 KB');
  assert.equal(formatSize(0), '0 B');
  assert.equal(formatSize(undefined), 'Unknown size');
});
test('text editing limits match the exported UTF-8 byte count', () => {
  for (const text of ['', 'a'.repeat(300000), '\u0939\u093f\u0928\u094d\u0926\u0940', '\u00e9', '\ud83d\ude00', '\ud800']) {
    assert.equal(utf8Size(text), Buffer.byteLength(text, 'utf8'));
  }
  assert.ok(utf8Size('a'.repeat(300000)) < LIMITS.text);
});
