const vm = require('node:vm');
const path = require('node:path');
const { transformFileSync } = require('@babel/core');
const utils = require(path.join(process.cwd(), 'fileUtils.cjs'));

function elements(node) {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object') return [];
  return [node, ...elements(node.props?.children), ...elements(node.props?.ListHeaderComponent)];
}
function text(node) {
  if (Array.isArray(node)) return node.map(text).join('');
  if (node && typeof node === 'object') return text(node.props?.children);
  return node == null ? '' : String(node);
}
function button(tree, label) {
  const result = elements(tree).find(node => node.props?.label === label || node.props?.accessibilityLabel === label && node.props?.onPress || node.type === 'Pressable' && text(node) === label);
  if (!result) throw new Error(`Button not found: ${label}`);
  return result;
}
// Document actions live behind the header's overflow menu, so tests take the same
// route a user does: open the menu, then pick an item.
function menu(tree) {
  const sheet = elements(tree).find(node => node.type === 'MenuSheet');
  if (!sheet) throw new Error('The overflow menu is not rendered');
  return sheet;
}
function menuItems(tree) {
  return (menu(tree).props.items || []).filter(Boolean);
}
function menuItem(tree, label) {
  const found = menuItems(tree).find(item => item.label === label);
  if (!found) throw new Error(`Menu item not found: ${label}. Available: ${menuItems(tree).map(item => item.label).join(', ')}`);
  return found;
}

function setup(filename = 'App.js', overrides = {}, runtime = {}) {
  const slots = [], effects = [], alerts = [], files = new Map();
  let index = 0, sequence = 0;
  const stats = { saves: [], keeps: [], shares: [], exports: [], statuses: [], dirty: [], folder: null, busy: [], platform: 'android', library: [], reading: [], drafts: [], snapshots: [], discarded: [], draftReady: [], draftRefreshes: 0 };
  const React = {
    createElement(type, props, ...children) { return { type, props: { ...props, children } }; },
    useState(initial) {
      const position = index++;
      if (!slots[position]) {
        const slot = { value: typeof initial === 'function' ? initial() : initial };
        slot.set = value => { slot.value = typeof value === 'function' ? value(slot.value) : value; };
        slots[position] = slot;
      }
      return [slots[position].value, slots[position].set];
    },
    useRef(initial) { const position = index++; return slots[position] ||= { current: initial }; },
    useMemo(factory) { return factory(); },
    useEffect(callback, deps) {
      const position = index++, previous = slots[position];
      if (!previous || !deps || deps.some((value, i) => !Object.is(value, previous.deps?.[i]))) {
        const slot = { deps }; slots[position] = slot;
        effects.push(() => { previous?.cleanup?.(); slot.cleanup = callback(); });
      }
    },
  };
  class File {
    constructor(uri) { this.uri = uri; }
    get exists() { return files.has(this.uri); }
    get size() { return files.get(this.uri)?.length || 0; }
    async bytes() { return files.get(this.uri) || new Uint8Array([1, 2, 3]); }
    write(content) { files.set(this.uri, content); }
    async copy(destination) { files.set(destination.uri, files.get(this.uri)); }
    delete() { files.delete(this.uri); }
  }
  const doc = { uri: 'file:///source.txt', name: 'notes.txt', kind: 'text', mimeType: 'text/plain', text: 'Original text', size: 13 };
  const metadata = { pageCount: 1, pages: [{ width: 400, height: 500, overlayAllowed: true }], warnings: [] };
  const native = new Proxy({
    Platform: { get OS() { return stats.platform; } }, StyleSheet: { create: value => value },
    Alert: { alert: (title, message, buttons, options) => alerts.push({ title, message, buttons, options }) },
    BackHandler: { addEventListener: () => ({ remove() {} }) },
    Linking: { getInitialURL: async () => null, addEventListener: () => ({ remove() {} }) },
    AppState: { addEventListener: (_name, callback) => { stats.appStateChange = callback; return { remove() {} }; } },
  }, { get: (object, key) => object[key] || key });
  const modules = {
    react: React, 'react-native': native,
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView', SafeAreaProvider: 'SafeAreaProvider' },
    'expo-status-bar': { StatusBar: 'StatusBar' },
    'expo-file-system': { File },
    'expo-sharing': { getSharedPayloads: () => [], clearSharedPayloads() {} },
    'react-native-document-scanner-plugin': { scanDocument: async () => ({ status: 'success', scannedImages: ['/scan/a.jpg', '/scan/b.jpg', '/scan/c.jpg'] }) },
    // Real design tokens, so a screen using a token the theme does not export fails here.
    './theme': { ...require(path.join(process.cwd(), 'tests/helpers/themeTokens.cjs')),
      useTheme: () => ({ theme: { accents: { text: '#123' } }, ready: true }) },
    './icons': { FILE_ICON: { text: 'FileIcon', pdf: 'PdfIcon', image: 'ImageIcon' } },
    './workspaceUi': Object.fromEntries(['AppIcon', 'BrandMark', 'IconButton', 'ActionButton', 'FileTile', 'EmptyState',
      'MenuSheet', 'Banner', 'Skeleton', 'FileListSkeleton'].map(name => [name, name])),
    './fileLibrary': {
      listLibrary: () => stats.library,
      rememberDocument: async value => { const item = { ...value, id: 'library-id', libraryId: 'library-id' }; stats.library.push(item); return item; },
      getReadingState: () => ({ page: 4, pageCount: 8, bookmarks: [2] }),
      updateReadingState: async (...args) => stats.reading.push(args),
      togglePageBookmark: async () => ({ bookmarks: [2, 4] }),
    },
    './fileUtils.cjs': utils,
    './draftStorage': {
      readDraft: () => null, listDrafts: () => stats.drafts,
      saveDraft: async (document, snapshot) => stats.snapshots.push({ document, snapshot }),
      discardDraft: async document => stats.discarded.push(document),
    },
    './useDraftAutosave': { __esModule: true, default: () => ({ status: '', flush: async () => {}, clear: async () => stats.discarded.push(doc) }) },
    './nativeFileTools': {
      createTextPdf: async (_text, name) => ({ uri: 'file:///cache/file-tools/generated.pdf', name }),
      removeGeneratedFile() {}, nativeToolsAvailable: true,
      requireFileTools: () => ({ pdfInfo: async () => ({ pageCount: 4 }) }),
    },
    './historyPolicy.cjs': require(path.join(process.cwd(), 'historyPolicy.cjs')),
    './fileService': {
      cleanOldWorkingFiles() {}, listExports: () => stats.exports, removeWorkingFile() {}, ensureWorkingSpace() {},
      pickDocument: async () => doc, importDocument: async value => value, pickImageBytes: async () => [],
      newWorkingFile: () => new File(`file:///work/${++sequence}.txt`),
      async keepExport(output) {
        stats.keeps.push(output);
        const saved = { ...output, uri: `file:///exports/${++sequence}`, size: output.size || 10 };
        files.set(saved.uri, files.get(output.uri) || 'export');
        stats.exports.push(saved); return saved;
      },
      shareExport: async output => stats.shares.push(output),
    },
    './phoneStorage': {
      getSaveFolder: () => stats.folder, getPhoneSaveReceipt: () => null,
      chooseSaveFolder: async () => stats.folder = { uri: 'content://folder', label: 'Documents' },
      async saveOutputsToPhone(outputs) {
        stats.saves.push([...outputs]);
        const status = stats.statuses.shift() || 'saved';
        return { status, saved: status === 'saved' ? outputs : [], pending: status === 'saved' ? [] : outputs,
          folder: { uri: 'content://folder', label: 'Documents' }, remembered: true, error: 'Folder unavailable.' };
      },
    },
    './scanExport': { exportScannedPages: async () => ['a', 'b', 'c'].map(name => ({ uri: `file:///exports/${name}.jpg`, name: `${name}.jpg`, size: 10 })) },
    './conversions.cjs': { MAX_CONVERT_IMAGES: 50, buildPdfFromText: async () => new Uint8Array([1, 2, 3]) },
    './pdfOperations.cjs': { inspectPdf: async () => metadata, applyPdfOperation: async () => ({ ...metadata, bytes: new Uint8Array([4, 5, 6]) }), PdfOperationError: class extends Error {} },
    ...overrides,
  };
  const compiled = transformFileSync(path.join(__dirname, '../..', filename), {
    configFile: false, babelrc: false, plugins: ['@babel/plugin-transform-modules-commonjs', '@babel/plugin-transform-react-jsx'],
  }).code;
  const module = { exports: {} };
  const context = vm.createContext({ exports: module.exports, module, React, console, setTimeout, clearTimeout, ...runtime,
    require: name => modules[name] || { __esModule: true, default: name.slice(2) },
  });
  vm.runInContext(compiled + (filename === 'App.js' ? '\nglobalThis.Workspace = Workspace;' : ''), context);
  const component = filename === 'App.js' ? context.Workspace : module.exports.default;
  const props = { doc, onDirtyChange: dirty => stats.dirty.push(dirty), onBusyChange: value => stats.busy.push(value),
    onDraftChange: value => stats.draftReady.push(value), onDraftStored: () => stats.draftRefreshes++,
    onExport: async output => { stats.keeps.push(output); return { ...output, saveStatus: 'saved', saveMessage: 'Saved to Documents.' }; } };
  function render() { index = 0; const tree = component(props); while (effects.length) effects.shift()(); return tree; }
  return { render, props, stats, alerts, files, modules, doc, exports: module.exports, unmount() { for (const slot of slots) slot?.cleanup?.(); }, async flush() { await new Promise(resolve => setImmediate(resolve)); return render(); } };
}

module.exports = { setup, elements, text, button, menu, menuItems, menuItem };
