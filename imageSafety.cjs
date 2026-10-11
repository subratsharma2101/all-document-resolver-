const { imageSize } = require('image-size');
const { guardDimensions } = require('./imageOperations.cjs');

const HEADER_BYTES = 512 * 1024;
const WORKING_IMAGE_EDGE = 3072;
const TYPES = new Set(['jpg', 'png', 'webp', 'bmp', 'heic', 'heif', 'avif']);

function inspectImageHeader(bytes) {
  let metadata;
  try { metadata = imageSize(bytes); }
  catch { throw new Error('Cannot safely read this image header. Use a valid JPG, PNG, WebP, BMP or supported HEIF image.'); }
  if (!TYPES.has(metadata.type)) throw new Error('This image format is not supported for safe processing. Use a static JPG, PNG or WebP.');
  guardDimensions(metadata.width, metadata.height);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (metadata.type === 'png') {
    let foundImage = false;
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const size = view.getUint32(offset);
      const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
      if (type === 'acTL') throw new Error('Animated PNG is not supported. Export a still frame first.');
      if (type === 'IDAT') { foundImage = true; break; }
      offset += size + 12;
    }
    if (!foundImage) throw new Error('PNG metadata is incomplete or too large to validate safely.');
  }
  if (metadata.type === 'webp' && bytes.length > 20 && String.fromCharCode(...bytes.subarray(12, 16)) === 'VP8X' && (bytes[20] & 2)) {
    throw new Error('Animated WebP is not supported. Export a still frame first.');
  }
  const swap = metadata.orientation >= 5 && metadata.orientation <= 8;
  return { width: swap ? metadata.height : metadata.width, height: swap ? metadata.width : metadata.height, type: metadata.type };
}

function boundedDimensions(width, height, edge = WORKING_IMAGE_EDGE) {
  guardDimensions(width, height);
  if (!Number.isFinite(edge) || edge < 1 || edge > WORKING_IMAGE_EDGE) throw new Error('Invalid image decode limit.');
  const scale = Math.min(1, edge / width, edge / height);
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}

module.exports = { HEADER_BYTES, WORKING_IMAGE_EDGE, inspectImageHeader, boundedDimensions };
