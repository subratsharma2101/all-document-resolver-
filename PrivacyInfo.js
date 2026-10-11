import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, hairline, space, type } from './theme';

const sections = [
  ['Local processing', 'File viewing, image conversion and PDF editing run on your device. There is no app account, ad SDK or app analytics integration.'],
  ['My Files and exports', 'Opening a file creates a working copy and keeps a private copy in My Files, up to 100 files or 200 MB. Recent files, starred items, PDF reading positions and bookmarks are stored on this device. Remove a recent app copy using its actions menu. On Android, Save uses the phone folder you choose once. Change it from My Files or Tools. Cancelled phone saves can be retried. Uninstalling removes app-private files, but not copies saved to your chosen folder. Device backup is disabled for the Android app.'],
  ['Automatic drafts', 'Text edits and applied PDF/image changes are saved in a separate private draft after a short pause, up to 200 MB in total. Wait for Draft saved before closing. Continue from Home or reopen the original and choose Resume edits. Saving a copy or discarding a draft removes that recovery snapshot. Uninstalling removes drafts. A sudden shutdown before a draft finishes can still lose the latest change.'],
  ['Sharing and cloud folders', 'Files leave the app when you choose a share destination or save into a provider such as a cloud drive. That app or provider controls the copy and its own data practices. Deleting an app export does not delete external copies.'],
  ['Scanner and text recognition', 'Text recognition processes images and PDF pages on your device. Hindi and English recognition models are included in the updated Android app. The camera scanner uses Google Play services and may download components on first use. ML Kit sends performance and usage metrics to Google and may contact Google for updates; document content and recognition results are processed locally. Details: https://developers.google.com/ml-kit/terms'],
  ['Limits and interruption', 'Large images are processed with bounded working dimensions. Text recognition supports up to 20 selected pages per batch; PDF image conversion supports 30. These tools render pages with a maximum edge of 2400 pixels. Password-protected and certain special PDFs cannot be edited. Save important copies to your phone as well as keeping drafts.'],
];

export default function PrivacyInfo({ visible, onClose }) {
  const { theme: t } = useTheme();
  return <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={{ padding: space.lg, flexDirection: 'row', alignItems: 'center', gap: space.md, borderBottomWidth: hairline, borderColor: t.border, backgroundColor: t.surface }}>
        <Text accessibilityRole="header" style={{ flex: 1, ...type.title, color: t.text }}>Privacy and storage</Text>
        <Pressable accessibilityRole="button" onPress={onClose} style={{ padding: space.md }}><Text style={{ ...type.label, color: t.primary }}>Close</Text></Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.xl }}>
        {sections.map(([title, body]) => <View key={title} style={{ gap: space.sm }}><Text style={{ ...type.heading, color: t.text }}>{title}</Text><Text selectable style={{ ...type.caption, color: t.textMuted }}>{body}</Text></View>)}
      </ScrollView>
    </SafeAreaView>
  </Modal>;
}
