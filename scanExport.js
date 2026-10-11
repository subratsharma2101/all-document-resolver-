import { buildPdfFromImages, MAX_CONVERT_IMAGES, MAX_OUTPUT_BYTES } from './conversions.cjs';
import { compressImageForPdf, deleteExport, ensureWorkingSpace, importDocument, keepExport, newWorkingFile, removeWorkingFile } from './fileService';

export async function exportScannedPages(paths, format, onProgress) {
  if (format !== 'image' && format !== 'pdf') throw new Error('Choose JPG images or a PDF document.');
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > MAX_CONVERT_IMAGES) {
    throw new Error(`Scan between 1 and ${MAX_CONVERT_IMAGES} pages at once.`);
  }
  const uris = paths.map(path => {
    if (typeof path !== 'string') throw new Error('The scanner returned an invalid page. Scan again.');
    const uri = path.startsWith('/') ? `file://${path}` : path;
    if (!/^(file|content):\/\//i.test(uri)) throw new Error('The scanner must return local image files.');
    return uri;
  });

  const saved = [], images = [];
  const group = `scan-${Date.now()}`;
  let pdfFile, total = 0;
  try {
    for (const [index, uri] of uris.entries()) {
      onProgress?.(`Preparing page ${index + 1} of ${uris.length}...`);
      const name = `${group}-page-${String(index + 1).padStart(2, '0')}.jpg`;
      // Own only this imported copy, never the scanner/provider source.
      const copy = await importDocument({ uri, name, mimeType: 'image/jpeg' });
      try {
        if (format === 'image') {
          // ML Kit and the iOS scanner return JPEG. Never rename other bytes to JPG.
          if (copy.imageMetadata?.type !== 'jpg') throw new Error('The scanner did not return a JPG image. Try saving as PDF instead.');
          saved.push(await keepExport({ uri: copy.uri, name, mimeType: 'image/jpeg' }));
        } else {
          const bytes = await compressImageForPdf(copy.uri);
          total += bytes.byteLength;
          if (total > MAX_OUTPUT_BYTES) throw new Error('This scan exceeds 25 MiB. Scan fewer pages at a time.');
          images.push(bytes);
        }
      } finally { removeWorkingFile(copy.uri); }
    }
    if (format === 'pdf') {
      onProgress?.('Combining scanned pages into PDF...');
      const bytes = await buildPdfFromImages(images);
      ensureWorkingSpace(bytes.byteLength);
      pdfFile = newWorkingFile(`${group}.pdf`);
      pdfFile.write(bytes);
      saved.push(await keepExport({ uri: pdfFile.uri, name: `${group}.pdf`, mimeType: 'application/pdf' }));
    }
    return saved;
  } catch (error) {
    // Roll back only exports created by this attempt, not older exports or inputs.
    const retained = [];
    for (const output of saved) {
      try { deleteExport(output.uri); } catch { retained.push(output.name); }
    }
    if (retained.length) throw new Error(`${error.message || 'Scan export failed.'} ${retained.length} partial image copy/copies remain in Exports; review them before retrying.`);
    throw error;
  } finally {
    if (pdfFile) removeWorkingFile(pdfFile.uri);
  }
}
