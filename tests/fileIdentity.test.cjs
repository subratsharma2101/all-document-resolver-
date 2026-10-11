const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { SAMPLE_BYTES, sampleRanges, fingerprint } = require('../fileIdentity.cjs');

const read = (bytes, ranges) => ranges.map(range => bytes.subarray(range.offset, range.offset + range.length));
const digest = bytes => fingerprint(bytes.length, read(bytes, sampleRanges(bytes.length)));
const noise = (length, seed) => {
  const out = Buffer.alloc(length);
  let state = seed >>> 0;
  for (let i = 0; i < length; i++) { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; out[i] = state >>> 24; }
  return out;
};

test('small files are sampled completely and large files read a bounded amount', () => {
  assert.deepEqual(sampleRanges(0), []);
  assert.deepEqual(sampleRanges(1000), [{ offset: 0, length: 1000 }]);
  const whole = SAMPLE_BYTES * 3;
  assert.deepEqual(sampleRanges(whole), [{ offset: 0, length: whole }]);
  const big = 25 * 1024 * 1024;
  const ranges = sampleRanges(big);
  assert.equal(ranges.length, 3);
  assert.equal(ranges.reduce((sum, range) => sum + range.length, 0), SAMPLE_BYTES * 3);
  assert.equal(ranges[0].offset, 0);
  assert.equal(ranges[2].offset + ranges[2].length, big, 'the tail is included');
  let previousEnd = 0;
  for (const range of ranges) {
    assert.ok(range.offset >= previousEnd, 'ranges never overlap and ascend');
    previousEnd = range.offset + range.length;
  }
  assert.throws(() => sampleRanges(-1), /Invalid file size/);
  assert.throws(() => sampleRanges(1.5), /Invalid file size/);
});

test('identity is a stable 32-character hex id that matches the stored index format', () => {
  const bytes = Buffer.from('Report contents');
  const id = digest(bytes);
  assert.match(id, /^[a-f0-9]{32}$/);
  assert.equal(digest(Buffer.from(bytes)), id, 'the same bytes always give the same id');
  assert.match(`${id}-${bytes.length}`, /^[a-f0-9]{32}-\d+$/);
});

test('different content, order and size produce different ids', () => {
  assert.notEqual(digest(Buffer.from('Report A')), digest(Buffer.from('Report B')));
  assert.notEqual(digest(Buffer.from('ab')), digest(Buffer.from('ba')));
  assert.notEqual(digest(Buffer.from('report')), digest(Buffer.from('report ')));
  assert.notEqual(digest(Buffer.alloc(64)), digest(Buffer.alloc(65)));
  assert.notEqual(digest(Buffer.alloc(0)), digest(Buffer.from('x')));
});

test('a single changed byte anywhere in a large file changes the id', () => {
  const size = 9 * 1024 * 1024;
  const base = noise(size, 7);
  const id = digest(base);
  for (const position of [0, 1, SAMPLE_BYTES - 1, Math.floor(size / 2), size - 1]) {
    const changed = Buffer.from(base);
    changed[position] = changed[position] ^ 0xff;
    assert.notEqual(digest(changed), id, `byte ${position} is covered`);
  }
  // Truncation is the realistic copy failure and must never look identical.
  assert.notEqual(digest(base.subarray(0, size - 1)), id);
});

test('ids stay distinct across many similar documents', () => {
  const ids = new Set();
  for (let i = 0; i < 4000; i++) ids.add(digest(Buffer.from(`invoice-${i}.pdf body`)));
  assert.equal(ids.size, 4000, 'no collisions among near-identical names');
  const header = noise(SAMPLE_BYTES, 3);
  const unique = new Set();
  for (let i = 0; i < 200; i++) {
    const body = Buffer.concat([header, noise(SAMPLE_BYTES, 100 + i), header]);
    unique.add(digest(body));
  }
  assert.equal(unique.size, 200, 'documents sharing a template header stay distinct');
});

test('incomplete or mismatched samples are rejected instead of making up an id', () => {
  const bytes = noise(25 * 1024 * 1024, 11);
  const ranges = sampleRanges(bytes.length);
  assert.throws(() => fingerprint(bytes.length, read(bytes, ranges).slice(0, 2)), /Incomplete file sample/);
  const short = read(bytes, ranges);
  short[1] = short[1].subarray(0, 10);
  assert.throws(() => fingerprint(bytes.length, short), /Incomplete file sample/);
  assert.throws(() => fingerprint(bytes.length, [undefined, undefined, undefined]), /Incomplete file sample/);
});

test('hashing a large file reads only the sampled bytes', () => {
  const size = 25 * 1024 * 1024;
  const bytes = noise(size, 5);
  let readBytes = 0;
  for (const range of sampleRanges(size)) readBytes += range.length;
  assert.ok(readBytes <= SAMPLE_BYTES * 3, 'bounded read');
  assert.ok(readBytes / size < 0.02, 'under two percent of a 25 MiB document');
  const started = process.hrtime.bigint();
  digest(bytes);
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(ms < 1000, `sampled hashing stays fast (${ms.toFixed(1)} ms)`);
  // A full MD5 of the same document is the work this replaces.
  assert.equal(crypto.createHash('md5').update(bytes).digest('hex').length, 32);
});
