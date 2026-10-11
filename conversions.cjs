const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const MAX_OUTPUT_BYTES = 25 * 1024 * 1024;
const MAX_CONVERT_IMAGES = 50;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_CHARS = 500000;
// A US Letter page holds an image roughly 558x738 pt. Rendering at ~2x that (about
// 200 dpi) stays crisp on screen and in print while keeping each embedded photo small,
// so several images fit comfortably under MAX_OUTPUT_BYTES.
const PDF_IMAGE_MAX_DIMENSION = 1600;
const PDF_IMAGE_QUALITY = 0.7;

// US Letter at 72 dpi, with a comfortable margin.
const PAGE = { width: 612, height: 792, margin: 54 };

class ConversionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ConversionError';
    this.code = code;
  }
}

function check(condition, code, message) {
  if (!condition) throw new ConversionError(code, message);
}

function detectImageFormat(bytes) {
  check(bytes instanceof Uint8Array && bytes.byteLength > 0, 'INVALID_IMAGE', 'One of the images is empty or unreadable.');
  check(bytes.byteLength <= MAX_IMAGE_BYTES, 'IMAGE_SIZE_LIMIT', 'Each image must be 10 MiB or smaller.');
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  throw new ConversionError('UNSUPPORTED_IMAGE', 'Only PNG and JPG images can be turned into a PDF. Convert other formats first.');
}

// Decide how to downscale an image so its longest side fits PDF_IMAGE_MAX_DIMENSION,
// preserving aspect ratio. expo-image-manipulator keeps the ratio when only one axis
// is given, so we constrain the larger axis. Returns null when the image already fits
// (never upscale — that only adds bytes without adding detail).
function resizeForPdf(width, height, max = PDF_IMAGE_MAX_DIMENSION) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const longest = Math.max(width, height);
  if (longest <= max) return null;
  return width >= height ? { width: max } : { height: max };
}

// Break text into lines that fit maxWidth at the given font size, honoring existing
// newlines and splitting over-long words so nothing overflows the page.
function wrapLines(text, font, fontSize, maxWidth) {
  const lines = [];
  for (const rawLine of text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n')) {
    if (rawLine.length === 0) { lines.push(''); continue; }
    let current = '';
    for (const word of rawLine.split(/(\s+)/)) {
      if (word === '') continue;
      const candidate = current + word;
      if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) { current = candidate; continue; }
      if (current) { lines.push(current.trimEnd()); current = ''; }
      // This also handles a long word after a short word, not just at line start.
      for (const char of word.trimStart()) {
        if (current && font.widthOfTextAtSize(current + char, fontSize) > maxWidth) {
          lines.push(current); current = '';
        }
        current += char;
      }
    }
    lines.push(current.trimEnd());
  }
  return lines;
}

async function buildPdfFromText(text, options = {}) {
  check(typeof text === 'string' && text.trim().length > 0, 'EMPTY_TEXT', 'There is no text to turn into a PDF.');
  check(text.length <= MAX_TEXT_CHARS, 'TEXT_TOO_LONG', 'This text is too long to convert. Split it into smaller files.');

  check(Number.isFinite(options.fontSize ?? 12), 'INVALID_FONT_SIZE', 'Choose a finite font size.');
  const fontSize = Math.max(8, Math.min(24, options.fontSize ?? 12));
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const lineHeight = fontSize * 1.4;
  const maxWidth = PAGE.width - PAGE.margin * 2;

  // Standard Helvetica cannot encode every glyph (e.g. Devanagari). Report clearly.
  for (const char of text) {
    if (char === '\n' || char === '\r' || char === '\t') continue;
    try { font.encodeText(char); } catch {
      throw new ConversionError('UNSUPPORTED_TEXT', `The standard Latin font cannot render "${char}" (U+${char.codePointAt(0).toString(16).toUpperCase()}). Hindi and other scripts are not supported in text-to-PDF yet.`);
    }
  }

  const lines = wrapLines(text, font, fontSize, maxWidth);
  let page = pdf.addPage([PAGE.width, PAGE.height]);
  let y = PAGE.height - PAGE.margin;
  for (const line of lines) {
    if (y < PAGE.margin) {
      page = pdf.addPage([PAGE.width, PAGE.height]);
      y = PAGE.height - PAGE.margin;
    }
    if (line) page.drawText(line, { x: PAGE.margin, y: y - fontSize, size: fontSize, font, color: rgb(0.08, 0.1, 0.15) });
    y -= lineHeight;
  }

  const bytes = await pdf.save({ useObjectStreams: true });
  check(bytes.byteLength <= MAX_OUTPUT_BYTES, 'OUTPUT_TOO_LARGE', 'The generated PDF is too large. Use less text.');
  return bytes;
}

async function buildPdfFromImages(images) {
  check(Array.isArray(images) && images.length > 0, 'NO_IMAGES', 'Choose at least one image to make a PDF.');
  check(images.length <= MAX_CONVERT_IMAGES, 'TOO_MANY_IMAGES', `You can combine up to ${MAX_CONVERT_IMAGES} images at once.`);
  let total = 0;
  for (const bytes of images) {
    detectImageFormat(bytes);
    total += bytes.byteLength;
    check(total <= MAX_OUTPUT_BYTES, 'INPUT_TOO_LARGE', 'Combined images exceed 25 MiB. Choose fewer or smaller images.');
  }

  const pdf = await PDFDocument.create();
  for (const bytes of images) {
    const format = detectImageFormat(bytes);
    const image = format === 'png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
    // Each image gets its own page sized to fit within US Letter, centered, no upscaling beyond page.
    const maxW = PAGE.width - PAGE.margin;
    const maxH = PAGE.height - PAGE.margin;
    const scale = Math.min(maxW / image.width, maxH / image.height, 1);
    const drawWidth = image.width * scale;
    const drawHeight = image.height * scale;
    const page = pdf.addPage([PAGE.width, PAGE.height]);
    page.drawImage(image, {
      x: (PAGE.width - drawWidth) / 2,
      y: (PAGE.height - drawHeight) / 2,
      width: drawWidth,
      height: drawHeight,
    });
  }

  const bytes = await pdf.save({ useObjectStreams: true });
  check(bytes.byteLength <= MAX_OUTPUT_BYTES, 'OUTPUT_TOO_LARGE', 'The generated PDF is too large. Use fewer or smaller images.');
  return bytes;
}

module.exports = {
  MAX_OUTPUT_BYTES, MAX_CONVERT_IMAGES, MAX_IMAGE_BYTES, MAX_TEXT_CHARS,
  PDF_IMAGE_MAX_DIMENSION, PDF_IMAGE_QUALITY,
  ConversionError, detectImageFormat, resizeForPdf, wrapLines, buildPdfFromText, buildPdfFromImages,
};
