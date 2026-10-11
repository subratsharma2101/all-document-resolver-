// File identity without hashing whole documents.
//
// The library needs a stable id so reopening the same document restores its reading
// position, and two different documents never share one. Hashing a 25 MiB PDF on every
// open costs a full native read on the JS thread, three times over during an import.
// Instead we hash the exact size plus bounded samples from the start, middle and end.
// Files at or below SAMPLE_BYTES * 3 are hashed completely, so small documents keep
// exact identity.

const SAMPLE_BYTES = 128 * 1024;
const LANES = 4;
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

// Byte ranges to read, in ascending offset order, never overlapping.
function sampleRanges(size) {
  if (!Number.isSafeInteger(size) || size < 0) throw new Error('Invalid file size for identity.');
  if (size === 0) return [];
  if (size <= SAMPLE_BYTES * 3) return [{ offset: 0, length: size }];
  const middle = Math.floor((size - SAMPLE_BYTES) / 2);
  return [
    { offset: 0, length: SAMPLE_BYTES },
    { offset: middle, length: SAMPLE_BYTES },
    { offset: size - SAMPLE_BYTES, length: SAMPLE_BYTES },
  ];
}

function mix(lane, value) {
  return Math.imul(lane ^ (value >>> 0), FNV_PRIME) >>> 0;
}

// Four interleaved FNV-1a lanes give a 128-bit digest, matching the 32-hex-character
// id format the stored library index already validates.
function fingerprint(size, chunks) {
  const lanes = new Array(LANES);
  for (let i = 0; i < LANES; i++) lanes[i] = mix(FNV_OFFSET, size + i * 0x9e3779b9);
  const ranges = sampleRanges(size);
  if (chunks.length !== ranges.length) throw new Error('Incomplete file sample for identity.');
  for (let index = 0; index < chunks.length; index++) {
    const bytes = chunks[index];
    if (!bytes || bytes.length !== ranges[index].length) throw new Error('Incomplete file sample for identity.');
    let lane = index % LANES;
    lanes[lane] = mix(lanes[lane], ranges[index].offset);
    for (let i = 0; i < bytes.length; i++) {
      lane = (lane + 1) % LANES;
      lanes[lane] = mix(lanes[lane], bytes[i]);
    }
  }
  // One avalanche pass so a single changed byte spreads across every lane.
  for (let round = 0; round < 2; round++) {
    for (let i = 0; i < LANES; i++) lanes[i] = mix(lanes[i], lanes[(i + 1) % LANES]);
  }
  return lanes.map(lane => (lane >>> 0).toString(16).padStart(8, '0')).join('');
}

module.exports = { SAMPLE_BYTES, sampleRanges, fingerprint };
