// Pure, node-testable image helpers. Native encoding lives in ImageEditor.js;
// this file only decides quality/scale so the search can be unit tested.

// KB contract: 1 KB = 1000 bytes, consistent with formatSize in fileUtils.cjs.
const KB = 1000;
const MAX_TARGET_KB = 25 * 1000; // 25 MB ceiling; larger targets are meaningless here.
const MAX_MEGAPIXELS = 80;       // Header validation cap; actual decode is separately sampled.
const MAX_OUTPUT_DIMENSION = 12000;

const FORMATS = {
  jpeg: { key: 'jpeg', ext: 'jpg', mimeType: 'image/jpeg', label: 'JPG', lossy: true, alpha: false },
  png: { key: 'png', ext: 'png', mimeType: 'image/png', label: 'PNG', lossy: false, alpha: true },
  webp: { key: 'webp', ext: 'webp', mimeType: 'image/webp', label: 'WebP', lossy: true, alpha: true },
};

class ImageOperationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ImageOperationError';
    this.code = code;
  }
}

function check(condition, code, message) {
  if (!condition) throw new ImageOperationError(code, message);
}

function formatFor(key) {
  const format = FORMATS[key];
  check(format, 'INVALID_FORMAT', 'Choose JPG, PNG or WebP output.');
  return format;
}

// Reject targets that are not a usable positive size before any native work runs.
function targetBytes(kb) {
  const value = typeof kb === 'string' ? Number(kb.trim()) : kb;
  check(Number.isFinite(value) && value > 0, 'INVALID_TARGET', 'Enter a target size in KB greater than zero.');
  check(value <= MAX_TARGET_KB, 'INVALID_TARGET', `Target size must be ${MAX_TARGET_KB / 1000} MB or smaller.`);
  return Math.max(1, Math.round(value * KB));
}

// Guard against decoding an image so large it would exhaust memory.
function guardDimensions(width, height) {
  check(Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0,
    'INVALID_IMAGE', 'This image reported invalid dimensions and cannot be processed.');
  check((width * height) / 1e6 <= MAX_MEGAPIXELS,
    'IMAGE_TOO_LARGE', `Images above ${MAX_MEGAPIXELS} megapixels are not supported. Reduce the resolution first.`);
}

// Clamp a user-entered max width to a valid downscale target, or null to keep original width.
function resolveMaxWidth(value, currentWidth) {
  if (value === undefined || value === null || value === '') return null;
  const width = typeof value === 'string' ? Number(value.trim()) : value;
  check(Number.isFinite(width) && width >= 16 && width <= MAX_OUTPUT_DIMENSION,
    'INVALID_WIDTH', `Max width must be between 16 and ${MAX_OUTPUT_DIMENSION} pixels.`);
  const target = Math.round(width);
  return target < currentWidth ? target : null; // Never upscale; upscaling cannot restore detail.
}

// Produce the sequence of output widths to try when a target size cannot be met at
// full resolution: start at the requested width, then step down. Downscaling is what
// actually lets a fixed pixel budget reach a small byte target; quality alone caps out.
function scaleWidths(startWidth, options = {}) {
  const steps = options.steps ?? 6;
  const factor = options.factor ?? 0.7;
  const minWidth = options.minWidth ?? 64;
  const start = Math.max(1, Math.round(startWidth));
  const widths = [start];
  let width = start;
  for (let i = 1; i < steps && width > minWidth; i++) {
    width = Math.round(width * factor);
    if (width < minWidth || width >= widths[widths.length - 1]) break;
    widths.push(width);
  }
  return widths;
}

function outputName(name, formatKey) {
  const format = formatFor(formatKey);
  const clean = String(name || 'image').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/^\.+/, '').trim() || 'image';
  const dot = clean.lastIndexOf('.');
  const stem = dot > 0 ? clean.slice(0, dot) : clean;
  return `${stem}-edited.${format.ext}`.slice(-120);
}

/**
 * Find the highest quality whose encoded size is at or below targetBytes.
 * `measure(quality)` must return the encoded byte count for that quality; it is
 * the only side-effecting piece and is injected so this search stays pure/testable.
 * Returns { quality, size, fits, attempts }. When even the lowest quality overshoots,
 * fits is false and the smallest achievable result is returned honestly.
 */
async function searchQuality(options) {
  const { targetBytes: target, measure } = options;
  const minQuality = options.minQuality ?? 0.1;
  const maxQuality = options.maxQuality ?? 1;
  const maxAttempts = options.maxAttempts ?? 8;
  const tolerance = options.tolerance ?? 0.02;
  const shouldCancel = options.shouldCancel;

  check(Number.isFinite(target) && target > 0, 'INVALID_TARGET', 'Target size must be greater than zero.');
  check(typeof measure === 'function', 'INVALID_MEASURE', 'A measure function is required.');
  check(minQuality > 0 && minQuality <= maxQuality && maxQuality <= 1, 'INVALID_RANGE', 'Quality range is invalid.');

  let attempts = 0;
  const sample = async (quality) => {
    if (shouldCancel && shouldCancel()) throw new ImageOperationError('CANCELLED', 'Compression cancelled.');
    attempts += 1;
    const size = await measure(quality);
    check(Number.isFinite(size) && size >= 0, 'INVALID_MEASURE', 'measure must return a byte count.');
    return { quality, size };
  };

  // Smallest possible output first: if even the lowest quality overshoots, report it honestly.
  const low = await sample(minQuality);
  if (low.size > target) return { ...low, fits: false, attempts };

  const high = await sample(maxQuality);
  if (high.size <= target) return { ...high, fits: true, attempts };

  // Binary search for the highest quality that still fits at or below target.
  let lo = minQuality;
  let hi = maxQuality;
  let best = low;
  while (attempts < maxAttempts && hi - lo > tolerance) {
    const mid = (lo + hi) / 2;
    const result = await sample(mid);
    if (result.size <= target) { best = result; lo = mid; } else { hi = mid; }
  }
  return { ...best, fits: true, attempts };
}

module.exports = {
  KB, MAX_TARGET_KB, MAX_MEGAPIXELS, MAX_OUTPUT_DIMENSION, FORMATS,
  ImageOperationError, formatFor, targetBytes, guardDimensions, resolveMaxWidth, outputName, searchQuality, scaleWidths,
};
