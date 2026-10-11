const test = require('node:test');
const assert = require('node:assert/strict');
const { createListCache } = require('../listCache.cjs');

test('a listing is read once and reused until something changes it', () => {
  let reads = 0;
  const cache = createListCache(() => { reads++; return ['a', 'b']; });
  assert.deepEqual(cache.read(), ['a', 'b']);
  cache.read();
  cache.read();
  assert.equal(reads, 1);
  cache.invalidate();
  assert.deepEqual(cache.read(), ['a', 'b']);
  assert.equal(reads, 2);
});

test('an empty listing is cached too, instead of rescanning every refresh', () => {
  let reads = 0;
  const cache = createListCache(() => { reads++; return []; });
  cache.read(); cache.read();
  assert.equal(reads, 1);
});

test('a mutation always drops the cache, including when it fails', async () => {
  let items = ['first'], reads = 0;
  const cache = createListCache(() => { reads++; return [...items]; });
  assert.deepEqual(cache.read(), ['first']);
  const add = cache.around(async value => { items.push(value); return value; });
  assert.equal(await add('second'), 'second');
  assert.deepEqual(cache.read(), ['first', 'second']);
  const fail = cache.around(async () => { items.push('partial'); throw new Error('Disk full'); });
  await assert.rejects(fail(), /Disk full/);
  assert.deepEqual(cache.read(), ['first', 'second', 'partial'], 'a partial change is still visible');
  assert.equal(reads, 3);
});

test('a read that throws is not cached as a result', () => {
  let fail = true;
  const cache = createListCache(() => { if (fail) throw new Error('Unreadable'); return ['ok']; });
  assert.throws(() => cache.read(), /Unreadable/);
  fail = false;
  assert.deepEqual(cache.read(), ['ok']);
});
