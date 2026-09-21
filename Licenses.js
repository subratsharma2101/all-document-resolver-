import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import notices from './assets/third-party-notices.json';
import { useTheme } from './theme';

export default function Licenses({ visible, onClose }) {
  const { theme } = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [selected, setSelected] = useState(null);
  return <Modal visible={visible} animationType="slide" onRequestClose={() => selected ? setSelected(null) : onClose()}>
    <SafeAreaView style={styles.root}>
      <View style={styles.header}><Text style={styles.title}>{selected ? selected.name : 'Open-source libraries'}</Text><Pressable accessibilityRole="button" onPress={() => selected ? setSelected(null) : onClose()} style={styles.button}><Text style={styles.link}>{selected ? 'Back' : 'Close'}</Text></Pressable></View>
      <ScrollView contentContainerStyle={styles.content}>
        {selected ? <Text selectable style={styles.body}>{selected.text}</Text> : <>
          <Text style={styles.body}>Built with free libraries. No paid PDF SDK is used. These notices cover the direct app dependencies and PDF engine helpers; native dependencies retain their own notices.</Text>
          {notices.map(notice => <Pressable accessibilityRole="button" key={notice.name} style={styles.row} onPress={() => setSelected(notice)}><Text style={styles.name}>{notice.name}</Text><Text style={styles.body}>{notice.version} / {notice.license}</Text></Pressable>)}
        </>}
      </ScrollView>
    </SafeAreaView>
  </Modal>;
}

function makeStyles(t) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg },
    header: { flexDirection: 'row', alignItems: 'center', padding: 18, gap: 12, borderBottomWidth: 1, borderColor: t.border, backgroundColor: t.surface },
    title: { flex: 1, color: t.text, fontSize: 20, fontWeight: '700' }, button: { padding: 14 }, link: { color: t.primary, fontWeight: '600' },
    content: { padding: 22 }, body: { color: t.textMuted, fontSize: 13, lineHeight: 21 },
    row: { paddingVertical: 16, borderBottomWidth: 1, borderColor: t.border, gap: 5 }, name: { color: t.text, fontSize: 16, fontWeight: '600' },
  });
}
