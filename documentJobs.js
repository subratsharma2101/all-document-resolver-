import { File, Paths } from 'expo-file-system';
import { keepExport } from './fileService';
import { normalizeOcrImage, removeGeneratedFile, requireFileTools } from './nativeFileTools';
import { utf8Size, LIMITS } from './fileUtils.cjs';

export function parseToolPages(value, pageCount, limit) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 30) throw new Error('Choose a valid page batch size.');
  if (!Number.isInteger(pageCount) || pageCount < 1) throw new Error('This PDF has no readable pages.');
  if (typeof value !== 'string' || !value.trim() || value.length > 500) throw new Error('Enter pages such as 1-3,5.');
  const pages = [], seen = new Set();
  for (const piece of value.split(',')) {
    const match = piece.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!match) throw new Error('Use page numbers or ranges, such as 1-3,5.');
    const start = Number(match[1]), end = Number(match[2] || match[1]);
    if (![start, end].every(page => Number.isSafeInteger(page) && page >= 1 && page <= pageCount)) throw new Error(`Choose pages between 1 and ${pageCount}.`);
    if (pages.length + Math.abs(end - start) + 1 > limit) throw new Error(`Choose up to ${limit} pages at a time.`);
    for (let page = start; ; page += start <= end ? 1 : -1) {
      if (seen.has(page)) throw new Error(`Page ${page} was selected more than once.`);
      seen.add(page); pages.push(page); if (page === end) break;
    }
  }
  return pages;
}

function validatePages(pages, limit) {
  if (!Array.isArray(pages) || !pages.length || pages.length > limit || new Set(pages).size !== pages.length ||
      !pages.every(page => Number.isSafeInteger(page) && page >= 1)) throw new Error(`Choose 1 to ${limit} different page numbers.`);
}

export async function recognizeDocument(doc, pages, language, { cancelled = () => false, progress = () => {} } = {}) {
  validatePages(pages, 20);
  if (!['image', 'pdf'].includes(doc.kind) || !['latin', 'devanagari'].includes(language)) throw new Error('Choose an image or PDF and a recognition language.');
  if (doc.kind === 'image' && (pages.length !== 1 || pages[0] !== 1)) throw new Error('An image has one page.');
  const native = requireFileTools(), chunks = [];
  let normalized, completed = 0, error = '';
  try {
    if (doc.kind === 'image') normalized = await normalizeOcrImage(doc.uri);
    for (const page of pages) {
      if (cancelled()) break;
      progress(`Recognizing page ${page} (${completed + 1} of ${pages.length})…`);
      const result = await native.recognize(normalized?.uri || doc.uri, doc.kind, page, language);
      if (typeof result?.text !== 'string') throw new Error('Text recognition returned an unreadable result.');
      const text = result.text.trim();
      if (text) {
        const candidate = [...chunks, text].join('\n\n');
        if (utf8Size(candidate) > LIMITS.text) throw new Error('Recognized text reached the 1 MiB limit. Process the remaining pages separately.');
        chunks.push(text);
      }
      completed++;
    }
  } catch (failure) { error = failure.message || 'Text recognition failed.'; }
  finally {
    if (normalized?.uri && normalized.uri !== doc.uri && normalized.uri.startsWith(Paths.cache.uri)) {
      try { new File(normalized.uri).delete(); } catch {}
    }
  }
  return { text: chunks.join('\n\n'), completed, total: pages.length, error, cancelled: cancelled() };
}

export async function exportPdfImages(doc, pages, format, { cancelled = () => false, progress = () => {}, cache = new Map() } = {}) {
  validatePages(pages, 30);
  if (doc.kind !== 'pdf' || !['jpg', 'png'].includes(format)) throw new Error('Choose a PDF and JPG or PNG output.');
  const native = requireFileTools(), outputs = [];
  let error = '';
  const stem = doc.name.replace(/\.[^.]+$/, '');
  for (const page of pages) {
    if (cancelled()) break;
    const key = JSON.stringify([doc.uri, page, format]);
    let rendered;
    try {
      progress(`Preparing page ${page} (${outputs.length + 1} of ${pages.length})…`);
      let saved = cache.get(key);
      if (!saved || !new File(saved.uri).exists) {
        rendered = await native.renderPdfPage(doc.uri, page, format);
        saved = await keepExport({ uri: rendered.uri, name: `${stem}-page-${page}.${format}`, mimeType: format === 'png' ? 'image/png' : 'image/jpeg' });
        cache.set(key, saved);
      }
      outputs.push(saved);
    } catch (failure) { error = failure.message || 'This page could not be converted.'; break; }
    finally { if (rendered?.uri) removeGeneratedFile(rendered.uri); }
  }
  return { outputs, completed: outputs.length, total: pages.length, error, cancelled: cancelled() };
}
