const MAX_HISTORY_COUNT = 20;
const MAX_HISTORY_BYTES = 75 * 1024 * 1024;

// Preserve nearest undo steps. The caller retains the active document separately.
function trimHistory(uris, sizeOf, byteLimit = MAX_HISTORY_BYTES, countLimit = MAX_HISTORY_COUNT) {
  const sizes = uris.map(uri => sizeOf(uri));
  if (sizes.some(size => !Number.isSafeInteger(size) || size < 0)) throw new Error('Invalid history checkpoint size.');
  let bytes = sizes.reduce((sum, size) => sum + size, 0), start = 0;
  while (start < uris.length && (uris.length - start > countLimit || bytes > byteLimit)) bytes -= sizes[start++];
  return { keep: uris.slice(start), discard: uris.slice(0, start), bytes };
}
module.exports = { trimHistory, MAX_HISTORY_BYTES, MAX_HISTORY_COUNT };
