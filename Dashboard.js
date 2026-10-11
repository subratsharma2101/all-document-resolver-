import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { hairline, radius, space, type, useTheme } from './theme';
import { FILE_ICON, ChevronRight } from './icons';
import { AppIcon, ActionButton, EmptyState, FileTile } from './workspaceUi';

export default function Dashboard({ recent, drafts = [], onResumeDraft, onDiscardDraft, onOpen, onScan, onConvert, onFiles, disabled }) {
  const { theme: t } = useTheme();
  const s = makeStyles(t);
  return <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
    <View style={s.intro}>
      <Text accessibilityRole="header" style={s.title}>Your files</Text>
      <Text style={s.subtitle}>Read, edit and save on this device.</Text>
    </View>
    <ActionButton label="Open a file" icon="plus" onPress={() => onOpen()} disabled={disabled} />

    {!!drafts.length && <Section title="Unfinished edits">
      {drafts.slice(0, 3).map(item => <View key={item.id}>
        <FileTile item={item} disabled={disabled} onOpen={() => onResumeDraft(item)} />
        <Pressable accessibilityRole="button" accessibilityLabel={`Discard draft ${item.name}`} disabled={disabled}
          onPress={() => onDiscardDraft(item)} style={s.inlineAction}>
          <Text style={s.link}>Discard draft</Text>
        </Pressable>
      </View>)}
    </Section>}

    <View style={s.categories}>
      {[['pdf', 'PDFs'], ['image', 'Images'], ['text', 'Text']].map(([kind, label]) => {
        const Icon = FILE_ICON[kind];
        const count = recent.filter(item => item.kind === kind).length;
        return <Pressable key={kind} accessibilityRole="button" accessibilityLabel={`Browse ${label}`} disabled={disabled}
          onPress={() => onFiles(kind)} style={({ pressed }) => [s.category, pressed && { opacity: 0.65 }]}>
          <Icon color={t.accents[kind]} size={22} />
          <Text style={s.categoryName}>{label}</Text>
          <Text style={s.categoryCount}>{count}</Text>
        </Pressable>;
      })}
    </View>

    <Section title="Create">
      <Row icon="scan" title="Scan document" detail="Paper to JPG or PDF" onPress={onScan} disabled={disabled} />
      <Row kind="pdf" title="Images to PDF" detail="Combine photos into one file" onPress={onConvert} disabled={disabled} last />
    </Section>

    <Section title="Recent" action="View all" onAction={() => onFiles('all')} disabled={disabled}>
      {recent.length
        ? recent.slice(0, 4).map(item => <FileTile key={item.id} item={item} disabled={disabled} onOpen={() => onOpen(null, item)} />)
        : <EmptyState title="Nothing here yet" detail="Open your first document and it will appear in this list." />}
    </Section>

    <View style={s.footer}>
      <AppIcon name="shield" color={t.textFaint} size={15} />
      <Text style={s.footerText}>Your original files stay unchanged.</Text>
    </View>
  </ScrollView>;
}

function Section({ title, action, onAction, disabled, children }) {
  const { theme: t } = useTheme();
  const s = makeStyles(t);
  return <View style={s.section}>
    <View style={s.sectionHead}>
      <Text accessibilityRole="header" style={s.sectionTitle}>{title}</Text>
      {action && <Pressable accessibilityRole="button" accessibilityLabel={action} disabled={disabled} onPress={onAction} style={s.inlineAction}>
        <Text style={s.link}>{action}</Text><ChevronRight color={t.primary} size={15} />
      </Pressable>}
    </View>
    <View style={s.group}>{children}</View>
  </View>;
}

function Row({ kind, icon, title, detail, onPress, disabled, last }) {
  const { theme: t } = useTheme();
  const s = makeStyles(t);
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

function makeStyles(t) {
  return StyleSheet.create({
    content: { padding: space.lg, paddingBottom: space.xxl, gap: space.lg, width: '100%', maxWidth: 760, alignSelf: 'center' },
    intro: { gap: space.xs, paddingTop: space.xs },
    title: { ...type.display, color: t.text },
    subtitle: { ...type.body, color: t.textMuted },
    categories: { flexDirection: 'row', gap: space.sm },
    category: { flex: 1, minWidth: 0, alignItems: 'center', gap: space.sm, paddingVertical: space.lg,
      borderRadius: radius.md, borderWidth: hairline, borderColor: t.border, backgroundColor: t.surface },
    categoryName: { ...type.caption, color: t.text, fontWeight: '600' },
    categoryCount: { ...type.caption, color: t.textFaint },
    section: { gap: space.sm },
    sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
    sectionTitle: { ...type.heading, color: t.text },
    group: { backgroundColor: t.surface, borderRadius: radius.md, borderWidth: hairline, borderColor: t.border, paddingHorizontal: space.md },
    row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 68, paddingVertical: space.md },
    rowDivider: { borderBottomWidth: hairline, borderColor: t.border },
    rowIcon: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: t.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
    rowTitle: { ...type.label, color: t.text },
    rowDetail: { ...type.caption, color: t.textMuted },
    inlineAction: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: space.xs, justifyContent: 'flex-end' },
    link: { ...type.caption, color: t.primary, fontWeight: '600' },
    footer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: space.sm, paddingTop: space.sm },
    footerText: { ...type.caption, color: t.textFaint },
  });
}
