import { useMemo } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import PdfViewer from './PdfViewer';
import { formatSize } from './fileUtils.cjs';
import { useTheme } from './theme';

// Read-only preview for every supported kind. No edit controls live here; editing
// is a separate, explicit mode the user opts into from the header.
export default function DocumentViewer({ doc }) {
  const { theme } = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  if (doc.kind === 'image') {
    return (
      <ScrollView
        style={styles.root}
        contentContainerStyle={styles.imageWrap}
        maximumZoomScale={5}
        minimumZoomScale={1}
        centerContent
      >
        <Image accessibilityLabel={doc.name} source={{ uri: doc.uri }} style={styles.image} resizeMode="contain" />
      </ScrollView>
    );
  }

  if (doc.kind === 'pdf') {
    return (
      <View style={styles.root}>
        <PdfViewer uri={doc.uri} name={doc.name} />
      </View>
    );
  }

  // text
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.textWrap}>
      <Text style={styles.meta}>{doc.text?.length.toLocaleString() ?? 0} characters / UTF-8 / {formatSize(doc.size)}</Text>
      <Text style={styles.body} selectable>{doc.text}</Text>
    </ScrollView>
  );
}

function makeStyles(t) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.overlayViewer },
    imageWrap: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 12 },
    image: { width: '100%', height: 520 },
    textWrap: { padding: 18, paddingBottom: 40, gap: 12 },
    meta: { color: t.textFaint, fontSize: 12 },
    body: { color: t.text, fontSize: 15, lineHeight: 24, fontFamily: 'monospace' },
  });
}
