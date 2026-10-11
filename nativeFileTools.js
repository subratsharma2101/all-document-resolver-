import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import NativeTools from './modules/file-tools';
import { loadBoundedImage } from './safeImage';
import { buildPdfFromText } from './conversions.cjs';
import { newWorkingFile, removeWorkingFile } from './fileService';

export const nativeToolsAvailable = Platform.OS === 'android' && !!NativeTools;
export function requireFileTools() {
  if (!nativeToolsAvailable) throw new Error(Platform.OS === 'android'
    ? 'Install the updated Android build to use text recognition and page conversion.'
    : 'Text recognition and page conversion are available in the Android app.');
  return NativeTools;
}
export function removeGeneratedFile(uri) {
  const root = new Directory(Paths.cache, 'file-tools').uri.replace(/\/$/, '') + '/';
  if (typeof uri !== 'string') return;
  if (uri.startsWith(root)) {
    if (!/^[a-f\d-]+\.(pdf|jpg|png)$/.test(uri.slice(root.length))) return;
    try { const file = new File(uri); if (file.exists) file.delete(); } catch {}
  } else removeWorkingFile(uri);
}
export async function createTextPdf(text, name, fontSize = 12) {
  if (nativeToolsAvailable) return { ...await NativeTools.textToPdf(text, fontSize), name, mimeType: 'application/pdf' };
  let file;
  try {
    const bytes = await buildPdfFromText(text, { fontSize });
    file = newWorkingFile(name); file.write(bytes);
    return { uri: file.uri, size: bytes.byteLength, name, mimeType: 'application/pdf' };
  } catch (error) {
    if (file) removeWorkingFile(file.uri);
    if (error.code === 'UNSUPPORTED_TEXT' && Platform.OS === 'android') throw new Error('Hindi PDF export needs the updated Android build. Your text can still be saved as a text file.');
    throw error;
  }
}
// Streams an app copy straight into a document the Storage Access Framework already
// created. Returns false when the native module is unavailable, so the caller can fall
// back to the base64 writer. Base64 holds roughly 1.33x the file in JS memory.
export async function streamToDocument(sourceUri, documentUri) {
  if (!nativeToolsAvailable || typeof NativeTools.writeToDocument !== 'function') return false;
  await NativeTools.writeToDocument(sourceUri, documentUri);
  return true;
}

export async function normalizeOcrImage(uri) {
  const refs = [];
  try {
    const input = await loadBoundedImage(uri, 2400); refs.push(input.ref);
    const context = ImageManipulator.manipulate(input.ref); refs.push(context);
    const rendered = await context.renderAsync(); refs.push(rendered);
    return await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.98 });
  } finally { while (refs.length) refs.pop().release?.(); }
}
