import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import { buildPdfHtml } from './pdfViewerHtml.cjs';
import { LIMITS } from './fileUtils.cjs';
import { useTheme } from './theme';

// Map app theme tokens to the PDF viewer's chrome (toolbar/stage/status). Pages
// always render on white regardless of theme.
function chromeFor(t) {
  return { bg: t.overlayViewer, text: t.textMuted, toolbar: t.surface, toolbarBorder: t.border,
    controlBorder: t.border, controlText: t.text, control: t.surfaceAlt, total: t.textMuted, status: t.textMuted };
}

const pdfLibAsset = require('./assets/pdfjs/pdf.lib.txt');
const pdfWorkerAsset = require('./assets/pdfjs/pdf.worker.txt');
let assetsPromise;
function loadAssets() {
  if (!assetsPromise) assetsPromise = Promise.all([pdfLibAsset, pdfWorkerAsset].map(async module => {
    const asset = Asset.fromModule(module);
    await asset.downloadAsync();
    return new File(asset.localUri || asset.uri).text();
  })).catch(error => { assetsPromise = null; throw error; });
  return assetsPromise;
}

export default function PdfViewer({ uri, name, initialPage = 1, onPageChange, onPageTap }) {
  const { theme } = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [html, setHtml] = useState(null);
  const [error, setError] = useState(null);
  const initial = useRef(initialPage);
  initial.current = initialPage;

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    setError(null);
    (async () => {
      try {
        const file = new File(uri);
        if (file.size > LIMITS.pdf) throw new Error('PDF viewing is limited to 25 MiB in this version.');
        const [[lib, worker], base64] = await Promise.all([loadAssets(), file.base64()]);
        if (!cancelled) setHtml(buildPdfHtml(lib, worker, base64, initial.current, chromeFor(theme)));
      } catch (e) { if (!cancelled) setError(e.message || String(e)); }
    })();
    return () => { cancelled = true; };
  }, [uri, theme]);

  if (error) return <View style={styles.center}><Text style={styles.error}>PDF preview: {error}</Text></View>;
  if (!html) return <View style={styles.center}><ActivityIndicator color={theme.primary} /><Text style={styles.dim}>Loading {name}...</Text></View>;
  return <WebView key={uri} source={{ html }} originWhitelist={['about:*']}
    style={styles.web} javaScriptEnabled domStorageEnabled={false}
    allowFileAccess={false} allowFileAccessFromFileURLs={false} allowUniversalAccessFromFileURLs={false}
    mixedContentMode="never" setSupportMultipleWindows={false}
    onShouldStartLoadWithRequest={request => request.url === 'about:blank' || request.url === 'about:srcdoc'}
    onError={event => setError(event.nativeEvent.description)}
    onContentProcessDidTerminate={() => setError('Preview process stopped. Close and reopen the document.')}
    onRenderProcessGone={() => setError('Preview ran out of resources. Try a smaller PDF.')}
    onMessage={event => {
      try {
        const message = JSON.parse(event.nativeEvent.data);
        if (message.type === 'page' && Number.isInteger(message.page) && message.page > 0) onPageChange?.(message);
        if (message.type === 'tap' && Number.isInteger(message.page) && Number.isFinite(message.x) && Number.isFinite(message.y) && message.x >= 0 && message.x <= 1 && message.y >= 0 && message.y <= 1) onPageTap?.(message);
        if (message.type === 'error') setError(String(message.message));
      } catch { /* Ignore malformed messages from the isolated preview. */ }
    }} />;
}

function makeStyles(t) {
  return StyleSheet.create({
    web: { flex: 1, backgroundColor: t.overlayViewer },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20, gap: 12, backgroundColor: t.bg },
    dim: { color: t.textMuted, fontSize: 13 }, error: { color: t.danger, fontSize: 14, textAlign: 'center' },
  });
}
