import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import notices from './assets/third-party-notices.json';
import { useTheme, hairline, space, type } from './theme';

const nativeNotices = [{
  name: 'Google ML Kit Text Recognition', version: '16.0.1 (Latin and Devanagari)', license: 'Google APIs terms',
  text: 'Text recognition uses Google ML Kit bundled Latin and Devanagari models. The SDK and models are supplied by Google under the ML Kit terms and incorporated Google APIs Terms of Service. These terms are distinct from the licenses of Google documentation code samples.\n\nML Kit terms and privacy:\nhttps://developers.google.com/ml-kit/terms\n\nGoogle APIs Terms of Service:\nhttps://developers.google.com/terms\n\nGoogle privacy policy:\nhttps://policies.google.com/privacy',
}];

export default function Licenses({ visible, onClose }) {
  const { theme } = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [selected, setSelected] = useState(null);
  return <Modal visible={visible} animationType="slide" onRequestClose={() => selected ? setSelected(null) : onClose()}>
    <SafeAreaView style={styles.root}>
      <View style={styles.header}><Text style={styles.title}>{selected ? selected.name : 'Libraries & notices'}</Text><Pressable accessibilityRole="button" onPress={() => selected ? setSelected(null) : onClose()} style={styles.button}><Text style={styles.link}>{selected ? 'Back' : 'Close'}</Text></Pressable></View>
      <ScrollView contentContainerStyle={styles.content}>
        {selected ? <Text selectable style={styles.body}>{selected.text}</Text> : <>
          <Text style={styles.body}>These notices cover direct app libraries, PDF engine helpers and the text recognition SDK. Other native dependencies retain their own notices.</Text>
          {[...nativeNotices, ...notices].map(notice => <Pressable accessibilityRole="button" key={notice.name} style={styles.row} onPress={() => setSelected(notice)}><Text style={styles.name}>{notice.name}</Text><Text style={styles.body}>{notice.version} / {notice.license}</Text></Pressable>)}
        </>}
      </ScrollView>
    </SafeAreaView>
  </Modal>;
}

function makeStyles(t) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg },
    header: { flexDirection: 'row', alignItems: 'center', padding: space.lg, gap: space.md, borderBottomWidth: hairline, borderColor: t.border, backgroundColor: t.surface },
    title: { flex: 1, ...type.title, color: t.text }, button: { padding: space.md }, link: { ...type.label, color: t.primary },
    content: { padding: space.lg }, body: { ...type.caption, color: t.textMuted },
    row: { paddingVertical: space.lg, borderBottomWidth: hairline, borderColor: t.border, gap: space.xs }, name: { ...type.label, color: t.text },
  });
}
