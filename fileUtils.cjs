const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'heic', 'heif'];
const TEXT_EXTS = ['txt', 'md', 'json', 'js', 'jsx', 'ts', 'tsx', 'csv', 'log',
  'xml', 'html', 'css', 'yml', 'yaml', 'ini', 'py', 'java', 'c', 'cpp'];
const LIMITS = { pdf: 25 * 1024 * 1024, image: 30 * 1024 * 1024, text: 1024 * 1024 };

function detectKind(name = '', mimeType = '') {
  const ext = name.split('.').pop().toLowerCase();
  if (ext === 'pdf' || mimeType === 'application/pdf') return 'pdf';
  if (IMAGE_EXTS.includes(ext) || mimeType.startsWith('image/')) return 'image';
  if (TEXT_EXTS.includes(ext) || mimeType.startsWith('text/')) return 'text';
  return 'unsupported';
}

function formatSize(size) {
  if (!Number.isFinite(size) || size < 0) return 'Unknown size';
  if (size < 1000) return `${size} B`;
  if (size < 1000000) return `${(size / 1000).toFixed(1)} KB`;
  return `${(size / 1000000).toFixed(1)} MB`;
}

function utf8Size(text) {
  let size = 0;
  for (const character of text) {
    const code = character.codePointAt(0);
    size += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  return size;
}

function safeName(name = 'document') {
  const clean = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/^\.+/, '').trim();
  return clean.slice(-120) || 'document';
}

function copyName(name) {
  const clean = safeName(name);
  const dot = clean.lastIndexOf('.');
  return dot > 0 ? `${clean.slice(0, dot)}-edited${clean.slice(dot)}` : `${clean}-edited.txt`;
}

function validateDocument({ name, mimeType, size }) {
  const kind = detectKind(name, mimeType);
  if (kind === 'unsupported') throw new Error('Choose a PDF, image or text file. This format is not supported.');
  if (!Number.isFinite(size) || size < 0) throw new Error('Could not read the file size. Download the file to your phone first.');
  if (size > LIMITS[kind]) {
    throw new Error(`${kind === 'pdf' ? 'PDF' : kind} files must be under ${formatSize(LIMITS[kind])} in this version.`);
  }
  if (size === 0 && kind !== 'text') throw new Error('This file is empty. Choose another file.');
  return kind;
}

module.exports = { detectKind, formatSize, utf8Size, safeName, copyName, validateDocument, LIMITS };
