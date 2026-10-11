const test = require('node:test');
const assert = require('node:assert/strict');
const { trimHistory, MAX_HISTORY_BYTES } = require('../historyPolicy.cjs');

test('history retains nearest checkpoints under both byte and count limits', () => {
  const uris = ['oldest', 'middle', 'newest'];
  const result = trimHistory(uris, () => 30 * 1024 * 1024);
  assert.deepEqual(result.keep, ['middle', 'newest']);
  assert.deepEqual(result.discard, ['oldest']);
  assert.ok(result.bytes <= MAX_HISTORY_BYTES);
  assert.deepEqual(uris, ['oldest', 'middle', 'newest']);
  assert.equal(trimHistory(Array.from({ length: 30 }, (_, i) => String(i)), () => 1).keep.length, 20);
});
test('single oversized checkpoint is removed and invalid sizes do not bypass limits', () => {
  assert.equal(trimHistory(['huge'], () => MAX_HISTORY_BYTES + 1).keep.length, 0);
  assert.throws(() => trimHistory(['bad'], () => NaN), /Invalid/);
});
