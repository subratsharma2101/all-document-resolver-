import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { FILE_ICON, ChevronRight } from './icons';
import { hairline, radius, space, type, useTheme } from './theme';
import { ActionButton, AppIcon } from './workspaceUi';

export default function ToolsScreen({ onOpen, onScan, onConvert, onOcr, onPdfImages, onFolder, folder, onPrivacy, onLicenses, disabled }) {
  const { theme: t } = useTheme();
  const s = styles(t);
  return <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
    <View style={s.intro}>
      <Text accessibilityRole="header" style={s.title}>Tools</Text>
      <Text style={s.subtitle}>Everything runs on this device.</Text>
    </View>

    <Text style={s.section}>Edit</Text>
    <View style={s.group}>
      <ToolRow kind="pdf" title="PDF workspace" detail="Reorder, merge, annotate and sign" onPress={() => onOpen('pdf')} disabled={disabled} />
      <ToolRow kind="image" title="Image studio" detail="Resize, rotate, compress and convert" onPress={() => onOpen('image')} disabled={disabled} />
      <ToolRow kind="text" title="Text desk" detail="Edit notes and export in a new format" onPress={() => onOpen('text')} disabled={disabled} last />
    </View>

    <Text style={s.section}>Create and convert</Text>
    <View style={s.group}>
      <ToolRow icon="scan" title="Scan document" detail="Turn paper into JPG images or a PDF" onPress={onScan} disabled={disabled} />
      <ToolRow kind="pdf" title="Images to PDF" detail="Combine selected photos into one document" onPress={onConvert} disabled={disabled} />
      <ToolRow icon="scan" title="Scan to text" detail="Recognize Hindi or English in images and PDFs" onPress={onOcr} disabled={disabled} />
      <ToolRow kind="image" title="PDF to images" detail="Save selected pages as JPG or PNG images" onPress={onPdfImages} disabled={disabled} last />
    </View>

    {Platform.OS === 'android' && <>
      <Text style={s.section}>Saving</Text>
      <View style={s.folder}>
        <Text style={s.folderTitle}>{folder ? folder.label : 'No save folder yet'}</Text>
        <Text style={s.subtitle}>{folder ? 'New copies are saved straight to this folder.' : 'Choose a folder once and later saves go there.'}</Text>
        <ActionButton label={folder ? 'Change folder' : 'Choose folder'} icon="folder" onPress={onFolder} disabled={disabled} quiet style={{ alignSelf: 'flex-start' }} />
      </View>
    </>}

    <Text style={s.section}>About</Text>
    <View style={s.group}>
      <ToolRow icon="shield" title="Privacy and storage" detail="Where your files are kept" onPress={onPrivacy} />
      <ToolRow icon="tools" title="Libraries and notices" detail="Open-source licenses" onPress={onLicenses} last />
    </View>

    <Text style={s.footnote}>Works with PDFs, images and UTF-8 text. The Android scanner may download components on first use.</Text>
  </ScrollView>;
}

function ToolRow({ kind, icon, title, detail, onPress, disabled, last }) {
  const { theme: t } = useTheme();
  const s = styles(t);
  const Icon = FILE_ICON[kind];
  const color = t.accents[kind] || t.primary;
  return <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} disabled={disabled}
    style={({ pressed }) => [s.row, !last && s.rowDivider, { opacity: disabled ? 0.45 : pressed ? 0.65 : 1 }]}>
    <View style={s.rowIcon}>{Icon ? <Icon color={color} size={22} /> : <AppIcon name={icon} color={color} size={20} />}</View>
    <View style={{ flex: 1, gap: space.xs }}>
      <Text style={s.rowTitle}>{title}</Text>
      <Text style={s.rowDetail}>{detail}</Text>
    </View>
    <ChevronRight color={t.textFaint} size={16} />
  </Pressable>;
}

function styles(t) {
  return StyleSheet.create({
    content: { padding: space.lg, paddingBottom: space.xxl, width: '100%', maxWidth: 760, alignSelf: 'center' },
    intro: { gap: space.xs, paddingTop: space.xs },
    title: { ...type.display, color: t.text },
    subtitle: { ...type.caption, color: t.textMuted },
    section: { ...type.caption, color: t.textMuted, fontWeight: '600', marginTop: space.xl, marginBottom: space.sm },
    group: { backgroundColor: t.surface, borderWidth: hairline, borderColor: t.border, borderRadius: radius.md, paddingHorizontal: space.md },
    row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 68, paddingVertical: space.md },
    rowDivider: { borderBottomWidth: hairline, borderColor: t.border },
    rowIcon: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: t.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
    rowTitle: { ...type.label, color: t.text },
    rowDetail: { ...type.caption, color: t.textMuted },
    folder: { borderWidth: hairline, borderColor: t.border, backgroundColor: t.surface, borderRadius: radius.md, padding: space.lg, gap: space.sm },
    folderTitle: { ...type.label, color: t.text },
    footnote: { ...type.caption, color: t.textFaint, textAlign: 'center', marginTop: space.xl },
  });
}
