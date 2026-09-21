import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { buildTextImageHtml } from './textToImageHtml.cjs';

// Off-screen WebView that renders text to a PNG on a canvas and reports the base64
// data back through onResult. Rendered 1x1 and invisible; it exists only to run the
// canvas code. Mount it only while a render is in flight.
export default function TextImageRenderer({ text, theme, onResult, onError }) {
  const html = useMemo(
    () => buildTextImageHtml(text, { bg: '#ffffff', fg: '#12151c' }),
    [text],
  );

  return (
    <View style={styles.hidden} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <WebView
        source={{ html }}
        originWhitelist={['about:*']}
        javaScriptEnabled
        domStorageEnabled={false}
        allowFileAccess={false}
        allowUniversalAccessFromFileURLs={false}
        onShouldStartLoadWithRequest={request => request.url === 'about:blank' || request.url === 'about:srcdoc'}
        onError={() => onError?.('The image renderer failed to load.')}
        onMessage={event => {
          try {
            const message = JSON.parse(event.nativeEvent.data);
            if (message.type === 'png' && typeof message.base64 === 'string' && message.base64.length > 0) {
              onResult?.(message.base64);
            } else if (message.type === 'error') {
              onError?.(String(message.message));
            }
          } catch {
            onError?.('The image renderer returned an unreadable result.');
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hidden: { position: 'absolute', width: 1, height: 1, opacity: 0, left: -9999, top: -9999 },
});
