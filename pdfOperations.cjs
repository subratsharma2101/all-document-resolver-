const { PDFDocument, PDFDict, PDFArray, PDFName, PDFNumber, StandardFonts, degrees, rgb } = require('pdf-lib');

const MAX_PDF_BYTES = 25 * 1024 * 1024;
const MAX_PDF_PAGES = 300;
const MAX_SIGNATURE_POINTS = 2000;
const MAX_SIGNATURE_STROKES = 32;
const MAX_STAMP_BYTES = 10 * 1024 * 1024; // Embedded image ceiling, independent of the PDF budget.

// Identify a stamp image by its magic bytes rather than trusting a caller-supplied
// type. pdf-lib only embeds PNG and JPEG, so anything else is rejected up front.
function detectImageFormat(bytes) {
  check(bytes instanceof Uint8Array && bytes.byteLength > 0, 'INVALID_IMAGE', 'The image is empty or unreadable.');
  check(bytes.byteLength <= MAX_STAMP_BYTES, 'IMAGE_SIZE_LIMIT', 'Stamp images must be 10 MiB or smaller.');
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  throw new PdfOperationError('UNSUPPORTED_IMAGE', 'Only PNG and JPG images can be placed on a PDF. Convert the image first.');
}
const PDF_WARNINGS = [
  'Edits invalidate digital signatures. Detected signed and form PDFs are blocked; signature detection is not a verification service.',
  'Page operations can lose or break bookmarks, links, annotations, tags, attachments and document metadata. Review the exported copy.',
  'Text, highlights and handwriting are overlays, not redaction. Existing text and underlying content remain recoverable.',
];

class PdfOperationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PdfOperationError';
    this.code = code;
  }
}

function check(condition, code, message) {
  if (!condition) throw new PdfOperationError(code, message);
}

function checkBytes(bytes) {
  check(bytes instanceof Uint8Array, 'INVALID_BYTES', 'PDF input must be a Uint8Array.');
  check(bytes.byteLength > 0, 'INVALID_PDF', 'The PDF is empty.');
  check(bytes.byteLength <= MAX_PDF_BYTES, 'SIZE_LIMIT', 'PDFs must be 25 MiB or smaller. Choose a smaller document.');
}

function parsePageRange(value, pageCount) {
  check(Number.isInteger(pageCount) && pageCount > 0 && pageCount <= MAX_PDF_PAGES,
    'PAGE_LIMIT', `PDFs must contain 1-${MAX_PDF_PAGES} pages.`);
  check(typeof value === 'string' && value.trim().length > 0 && value.length <= 5000,
    'INVALID_RANGE', 'Enter page numbers or ranges, for example 1-3,5.');
  const pages = [];
  const seen = new Set();
  for (const token of value.split(',')) {
    const match = token.trim().match(/^(\d+)\s*(?:-\s*(\d+))?$/);
    check(match, 'INVALID_RANGE', 'Use page numbers and comma-separated ranges, for example 3,1-2.');
    const start = Number(match[1]);
    const end = match[2] === undefined ? start : Number(match[2]);
    check(Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 1 && end >= 1 && start <= pageCount && end <= pageCount,
      'INVALID_RANGE', `Page numbers must be between 1 and ${pageCount}.`);
    const step = start <= end ? 1 : -1;
    for (let page = start; ; page += step) {
      check(!seen.has(page), 'DUPLICATE_PAGE', `Page ${page} occurs more than once. List each page only once.`);
      seen.add(page);
      pages.push(page);
      if (page === end) break;
    }
  }
  return pages;
}

function selectedPages(value, pageCount) {
  if (typeof value === 'string') return parsePageRange(value, pageCount);
  check(Array.isArray(value) && value.length > 0 && value.length <= pageCount,
    'INVALID_RANGE', 'Select at least one valid page.');
  const seen = new Set();
  for (const page of value) {
    check(Number.isInteger(page) && page >= 1 && page <= pageCount,
      'INVALID_RANGE', `Page numbers must be between 1 and ${pageCount}.`);
    check(!seen.has(page), 'DUPLICATE_PAGE', `Page ${page} occurs more than once.`);
    seen.add(page);
  }
  return value.slice();
}

function assertEditable(pdf) {
  check(!pdf.isEncrypted && !pdf.context.trailerInfo.Encrypt,
    'ENCRYPTED_PDF', 'Encrypted or password-protected PDFs cannot be edited. Use an unencrypted copy you are authorized to edit.');
  check(pdf.getPageCount() > 0 && pdf.getPageCount() <= MAX_PDF_PAGES,
    'PAGE_LIMIT', `PDF editing is limited to 1-${MAX_PDF_PAGES} pages.`);
  check(!pdf.catalog.has(PDFName.of('Perms')), 'SIGNED_PDF', 'This PDF has signature permissions. Editing would invalidate them. Use an unsigned copy.');

  // Walk direct containers as well as indirect objects: a signature dictionary may be nested.
  const objects = pdf.context.enumerateIndirectObjects();
  check(objects.length <= 50000, 'COMPLEX_PDF', 'This PDF is too complex for safe mobile editing. Use a simpler copy.');
  const pending = objects.map(([, object]) => object);
  const visited = new Set();
  while (pending.length) {
    const object = pending.pop();
    if (!(object instanceof PDFDict) && !(object instanceof PDFArray)) continue;
    if (visited.has(object)) continue;
    visited.add(object);
    check(visited.size <= 100000, 'COMPLEX_PDF', 'This PDF is too complex for safe mobile editing.');
    if (object instanceof PDFDict) {
      const type = pdf.context.lookup(object.get(PDFName.of('Type')));
      const fieldType = pdf.context.lookup(object.get(PDFName.of('FT')));
      check(type !== PDFName.of('Sig') && type !== PDFName.of('DocTimeStamp') && fieldType !== PDFName.of('Sig') && !object.has(PDFName.of('ByteRange')),
        'SIGNED_PDF', 'This PDF contains a digital signature or signature field. Editing invalidates signatures. Use an unsigned, flattened copy.');
      for (const [, child] of object.entries()) pending.push(child);
    } else {
      for (let i = 0; i < object.size(); i += 1) pending.push(object.get(i));
    }
  }
  check(!pdf.catalog.has(PDFName.of('AcroForm')), 'FORM_PDF',
    'Interactive forms and XFA PDFs are not supported. Flatten the form in a trusted PDF app, then import that copy.');
}

async function loadEditable(bytes) {
  checkBytes(bytes);
  let pdf;
  try {
    pdf = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false, throwOnInvalidObject: true });
    assertEditable(pdf);
    return pdf;
  } catch (error) {
    if (error instanceof PdfOperationError) throw error;
    if (error.name === 'EncryptedPDFError' || /encrypted/i.test(error.message)) {
      throw new PdfOperationError('ENCRYPTED_PDF', 'Encrypted or password-protected PDFs cannot be edited. Use an unencrypted copy you are authorized to edit.');
    }
    throw new PdfOperationError('INVALID_PDF', 'This PDF is damaged or unsupported. Open and repair a copy in a trusted PDF app first.');
  }
}

function pageGeometry(page) {
  const media = page.getMediaBox();
  const crop = page.getCropBox();
  const rotation = ((page.getRotation().angle % 360) + 360) % 360;
  const userUnit = page.node.lookupMaybe(PDFName.of('UserUnit'), PDFNumber)?.asNumber() ?? 1;
  let overlayReason = null;
  if (rotation !== 0) overlayReason = 'Overlays need an unrotated page. Rotate this page back to 0 degrees first, then place the overlay.';
  else if (['x', 'y', 'width', 'height'].some(key => Math.abs(media[key] - crop[key]) > 0.001) || media.x !== 0 || media.y !== 0) {
    overlayReason = 'Overlays on cropped or offset pages are not supported. Use an uncropped, zero-origin copy to place them accurately.';
  } else if (userUnit !== 1 || !Number.isFinite(media.width) || !Number.isFinite(media.height) || media.width <= 0 || media.height <= 0 || media.width > 14400 || media.height > 14400) {
    overlayReason = 'This page has nonstandard dimensions or scaling. Use a standard-size PDF copy for overlays.';
  }
  return { width: media.width, height: media.height, rotation, overlayAllowed: !overlayReason, overlayReason };
}

function describe(pdf) {
  return { pageCount: pdf.getPageCount(), pages: pdf.getPages().map(pageGeometry), warnings: PDF_WARNINGS.slice() };
}

async function inspectPdf(bytes) {
  return describe(await loadEditable(bytes));
}

function unit(value, label, positive = false) {
  check(typeof value === 'number' && Number.isFinite(value) && (positive ? value > 0 : value >= 0) && value <= 1,
    'INVALID_POSITION', `${label} must be ${positive ? 'greater than 0 and ' : ''}between 0 and 1.`);
  return value;
}

function overlayPage(pdf, operation) {
  check(Number.isInteger(operation.page) && operation.page >= 1 && operation.page <= pdf.getPageCount(),
    'INVALID_RANGE', 'Choose a valid page for the overlay.');
  const page = pdf.getPage(operation.page - 1);
  const geometry = pageGeometry(page);
  check(geometry.overlayAllowed, 'UNSUPPORTED_GEOMETRY', geometry.overlayReason);
  unit(operation.x, 'Left position');
  unit(operation.y, 'Top position');
  return { page, width: geometry.width, height: geometry.height };
}

function overlayRectangle(operation, width, height) {
  unit(operation.width, 'Overlay width', true);
  unit(operation.height, 'Overlay height', true);
  check(operation.x + operation.width <= 1 + 1e-9 && operation.y + operation.height <= 1 + 1e-9,
    'OVERLAY_BOUNDS', 'The overlay would extend beyond the page. Tap nearer the top-left or reduce its size.');
  return { x: operation.x * width, y: (1 - operation.y - operation.height) * height, width: operation.width * width, height: operation.height * height };
}

async function applyPdfOperation(bytes, operation) {
  check(operation && typeof operation === 'object', 'INVALID_OPERATION', 'Choose a PDF operation.');
  const validTypes = ['extract', 'delete', 'rotate', 'reorder', 'merge', 'text', 'highlight', 'signature', 'whiteout', 'image'];
  check(validTypes.includes(operation.type), 'INVALID_OPERATION', 'Unknown PDF operation.');
  // Reject a merge's combined byte budget before parsing either document.
  if (operation.type === 'merge') {
    checkBytes(bytes);
    checkBytes(operation.additionalBytes);
    check(bytes.byteLength + operation.additionalBytes.byteLength <= MAX_PDF_BYTES,
      'MERGE_SIZE_LIMIT', 'The current PDF and added PDF together must be 25 MiB or smaller.');
  }
  let pdf = await loadEditable(bytes);
  const type = operation.type;
  if (['extract', 'delete', 'rotate', 'reorder'].includes(type)) {
    const pages = selectedPages(operation.pages, pdf.getPageCount());
    if (type === 'delete') {
      check(pages.length < pdf.getPageCount(), 'DELETE_ALL', 'Keep at least one page. You cannot delete every page.');
      for (const page of pages.sort((a, b) => b - a)) pdf.removePage(page - 1);
    } else if (type === 'rotate') {
      check(Number.isInteger(operation.angle) && [-270, -180, -90, 90, 180, 270].includes(operation.angle),
        'INVALID_ROTATION', 'Choose a rotation of 90, 180 or 270 degrees clockwise or counterclockwise.');
      for (const index of pages) {
        const page = pdf.getPage(index - 1);
        const angle = page.getRotation().angle;
        check(Number.isInteger(angle) && angle % 90 === 0, 'INVALID_ROTATION', 'This page has an invalid existing rotation. Repair the PDF first.');
        page.setRotation(degrees(((angle + operation.angle) % 360 + 360) % 360));
      }
    } else {
      if (type === 'reorder') check(pages.length === pdf.getPageCount(), 'INCOMPLETE_ORDER', 'Reordering must list every page exactly once. Use Extract to create a subset.');
      const output = await PDFDocument.create();
      const copies = await output.copyPages(pdf, pages.map(page => page - 1));
      copies.forEach(page => output.addPage(page));
      pdf = output;
    }
  } else if (type === 'merge') {
    const additional = await loadEditable(operation.additionalBytes);
    check(pdf.getPageCount() + additional.getPageCount() <= MAX_PDF_PAGES,
      'PAGE_LIMIT', `Merged PDFs must contain no more than ${MAX_PDF_PAGES} pages.`);
    const copies = await pdf.copyPages(additional, additional.getPageIndices());
    copies.forEach(page => pdf.addPage(page));
  } else {
    const { page, width, height } = overlayPage(pdf, operation);
    if (type === 'text') {
      check(typeof operation.text === 'string' && operation.text.trim().length > 0 && operation.text.length <= 500,
        'INVALID_TEXT', 'Enter 1-500 characters for the text overlay.');
      check(!/[\r\n\t\x00-\x1f\x7f]/.test(operation.text), 'INVALID_TEXT', 'Text overlays support one line only, without tabs or control characters.');
      check(Number.isFinite(operation.fontSize) && operation.fontSize >= 8 && operation.fontSize <= 72,
        'INVALID_FONT_SIZE', 'Text size must be between 8 and 72 points.');
      const font = await pdf.embedFont(StandardFonts.Helvetica);
      for (const character of operation.text) {
        try { font.encodeText(character); } catch {
          throw new PdfOperationError('UNSUPPORTED_TEXT', `The standard Latin font cannot render "${character}" (U+${character.codePointAt(0).toString(16).toUpperCase()}). Hindi and other unsupported scripts need an embedded font and are not supported here.`);
        }
      }
      const textWidth = font.widthOfTextAtSize(operation.text, operation.fontSize);
      const ascent = font.heightAtSize(operation.fontSize, { descender: false });
      const totalHeight = font.heightAtSize(operation.fontSize, { descender: true });
      check(operation.x * width + textWidth <= width && operation.y * height + totalHeight <= height,
        'OVERLAY_BOUNDS', 'The text would extend beyond the page. Use shorter text, a smaller size, or tap nearer the top-left.');
      page.drawText(operation.text, { x: operation.x * width, y: (1 - operation.y) * height - ascent, size: operation.fontSize, font, color: rgb(0.08, 0.1, 0.15) });
    } else {
      const rectangle = overlayRectangle(operation, width, height);
      if (type === 'highlight') {
        page.drawRectangle({ ...rectangle, color: rgb(1, 0.85, 0), opacity: 0.32, borderWidth: 0 });
      } else if (type === 'whiteout') {
        // Opaque white cover to hide content underneath, then type over it. This is a
        // visual cover only: the original text stays in the file and is recoverable.
        page.drawRectangle({ ...rectangle, color: rgb(1, 1, 1), opacity: 1, borderWidth: 0 });
      } else if (type === 'image') {
        const format = detectImageFormat(operation.imageBytes);
        const embedded = format === 'png' ? await pdf.embedPng(operation.imageBytes) : await pdf.embedJpg(operation.imageBytes);
        // Fit the image inside the drawn rectangle without distorting its aspect ratio.
        const scale = Math.min(rectangle.width / embedded.width, rectangle.height / embedded.height);
        const drawWidth = embedded.width * scale;
        const drawHeight = embedded.height * scale;
        page.drawImage(embedded, {
          x: rectangle.x + (rectangle.width - drawWidth) / 2,
          y: rectangle.y + (rectangle.height - drawHeight) / 2,
          width: drawWidth,
          height: drawHeight,
        });
      } else {
        const strokes = operation.strokes;
        check(Array.isArray(strokes) && strokes.length > 0 && strokes.length <= MAX_SIGNATURE_STROKES,
          'INVALID_SIGNATURE', `Draw a signature with 1-${MAX_SIGNATURE_STROKES} strokes first.`);
        let pointCount = 0;
        for (const stroke of strokes) {
          check(Array.isArray(stroke) && stroke.length > 0, 'INVALID_SIGNATURE', 'Signature strokes cannot be empty.');
          pointCount += stroke.length;
          check(pointCount <= MAX_SIGNATURE_POINTS, 'INVALID_SIGNATURE', 'The signature is too detailed. Clear it and draw a simpler signature.');
          for (const point of stroke) {
            check(point && typeof point === 'object', 'INVALID_SIGNATURE', 'Invalid signature point.');
            unit(point.x, 'Signature x');
            unit(point.y, 'Signature y');
          }
        }
        const color = rgb(0.06, 0.13, 0.28);
        const thickness = Math.max(0.6, Math.min(2, rectangle.width / 200));
        const position = point => ({ x: rectangle.x + point.x * rectangle.width, y: rectangle.y + (1 - point.y) * rectangle.height });
        for (const stroke of strokes) {
          if (stroke.length === 1) page.drawCircle({ ...position(stroke[0]), size: thickness / 2, color });
          for (let i = 1; i < stroke.length; i += 1) {
            page.drawLine({ start: position(stroke[i - 1]), end: position(stroke[i]), thickness, color });
          }
        }
      }
    }
  }
  const result = await pdf.save({ useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: false, objectsPerTick: 30 });
  check(result.byteLength <= MAX_PDF_BYTES, 'SIZE_LIMIT', 'The edited PDF exceeds 25 MiB. Undo changes or use a smaller source PDF.');
  return { bytes: result, ...describe(pdf) };
}

module.exports = { MAX_PDF_BYTES, MAX_PDF_PAGES, MAX_SIGNATURE_POINTS, MAX_SIGNATURE_STROKES, MAX_STAMP_BYTES, PDF_WARNINGS, PdfOperationError, parsePageRange, detectImageFormat, inspectPdf, applyPdfOperation };
