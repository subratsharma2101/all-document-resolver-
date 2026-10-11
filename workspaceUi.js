import { useEffect, useRef } from 'react';
import { Animated, Easing, Image, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path, Circle, Rect } from 'react-native-svg';
import { Image as FileImage } from 'expo-image';
import { FILE_ICON } from './icons';
import { formatSize } from './fileUtils.cjs';
import { hairline, pressedOpacity, radius, rippleFor, space, type, useTheme } from './theme';

const paths = {
  home: 'M3.2 10.2 12 3.4l8.8 6.8V20a1.2 1.2 0 0 1-1.2 1.2h-4.8v-6.6H9.2v6.6H4.4A1.2 1.2 0 0 1 3.2 20z',
  folder: 'M3.4 7.4V5.2a1.2 1.2 0 0 1 1.2-1.2h4.6l2 3h8.2a1.2 1.2 0 0 1 1.2 1.2v10.6a1.2 1.2 0 0 1-1.2 1.2H4.6a1.2 1.2 0 0 1-1.2-1.2z',
  scan: 'M8.4 3.4H4.6a1.2 1.2 0 0 0-1.2 1.2v3.8m12-5h3.8a1.2 1.2 0 0 1 1.2 1.2v3.8M3.4 15.6v3.8a1.2 1.2 0 0 0 1.2 1.2h3.8m12-5v3.8a1.2 1.2 0 0 1-1.2 1.2h-3.8M7.4 8.4h9.2M7.4 12h9.2M7.4 15.6h5.6',
  arrow: 'M4.6 12h14.8m-5-5 5 5-5 5',
  back: 'M19.4 12H4.6m5-5-5 5 5 5',
  plus: 'M12 4.8v14.4M4.8 12h14.4',
  search: 'M15.8 15.8 20.6 20.6',
  close: 'M6.4 6.4 17.6 17.6M17.6 6.4 6.4 17.6',
  check: 'M5.4 12.4 9.6 16.6 18.6 7.4',
  download: 'M12 3.4v11.8m-4.6-4.6L12 15.2l4.6-4.6M4.4 16.4v3a1.2 1.2 0 0 0 1.2 1.2h12.8a1.2 1.2 0 0 0 1.2-1.2v-3',
  bookmark: 'M6.6 3.4h10.8v17.2L12 17.2l-5.4 3.4z',
  star: 'M12 3.4l2.7 5.5 6 .9-4.3 4.2 1 6-5.4-2.9-5.4 2.9 1-6L3.3 9.8l6-.9z',
  shield: 'M12 3.4l7.6 2.8v5.6c0 3.8-3.8 6.7-7.6 8.6-3.8-1.9-7.6-4.8-7.6-8.6V6.2zM8.6 12l2.8 2.8 4.4-5.2',
  sort: 'M5 6.2h14M5 12h9.6M5 17.8h5.6',
  share: 'M12 15.6V3.6m-3.8 3.8L12 3.6l3.8 3.8M5 11.2v9.2h14v-9.2',
};

export function AppIcon({ name, size = 21, color, filled = false }) {
  const { theme: t } = useTheme();
  const stroke = color || t.textMuted;
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
    {paths[name] && <Path d={paths[name]} fill={filled ? stroke : 'none'} />}
    {name === 'search' && <Circle cx={10.6} cy={10.6} r={6.4} />}
    {name === 'more' && [6, 12, 18].map(cx => <Circle key={cx} cx={cx} cy={12} r={1.1} fill={stroke} stroke="none" />)}
    {name === 'tools' && [[3.6, 3.6], [13.8, 3.6], [3.6, 13.8], [13.8, 13.8]].map(([x, y]) => <Rect key={`${x}-${y}`} x={x} y={y} width={6.6} height={6.6} rx={2} />)}
  </Svg>;
}

export function BrandMark({ size = 36 }) {
  return <Image accessibilityLabel="File Viewer logo" source={require('./branding/fileviewer-icon.png')}
    style={{ width: size, height: size, borderRadius: radius.md }} resizeMode="cover" />;
}

export function ActionButton({ label, icon, onPress, disabled, quiet = false, style }) {
  const { theme: t } = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress}
    android_ripple={disabled ? undefined : rippleFor(quiet ? t.ripple : t.primaryText + '33')}
    style={({ pressed }) => [{ minHeight: 48, paddingHorizontal: space.lg, paddingVertical: space.md, borderRadius: radius.md, overflow: 'hidden',
      flexDirection: 'row', gap: space.sm, alignItems: 'center', justifyContent: 'center',
      backgroundColor: quiet ? 'transparent' : t.primary, borderWidth: quiet ? hairline : 0, borderColor: t.border,
      opacity: pressedOpacity(pressed, disabled) }, style]}>
    {icon && <AppIcon name={icon} size={18} color={quiet ? t.primary : t.primaryText} />}
    <Text style={{ ...type.label, color: quiet ? t.primary : t.primaryText, flexShrink: 1 }}>{label}</Text>
  </Pressable>;
}

export function IconButton({ name, label, onPress, disabled, selected = false }) {
  const { theme: t } = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled, selected }} disabled={disabled} onPress={onPress}
    android_ripple={disabled ? undefined : { color: t.ripple, borderless: true, radius: 24 }}
    style={({ pressed }) => ({ width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center',
      backgroundColor: selected ? t.onPrimarySurface : 'transparent', opacity: pressedOpacity(pressed, disabled) })}>
    <AppIcon name={name} color={selected ? t.primary : t.textMuted} filled={selected && ['star', 'bookmark'].includes(name)} size={20} />
  </Pressable>;
}

export function FileTile({ item, onOpen, onMore, disabled, selected, onSelect }) {
  const { theme: t } = useTheme();
  const Icon = FILE_ICON[item.kind] || FILE_ICON.text;
  const color = t.accents[item.kind] || t.primary;
  const kindLabel = item.kind === 'pdf' ? 'PDF' : item.kind === 'image' ? 'Image' : 'Text';
  return <View style={{ flexDirection: 'row', alignItems: 'center', borderBottomWidth: hairline, borderColor: t.border, gap: space.sm }}>
    {onSelect && <IconButton name={selected ? 'check' : 'plus'} label={`${selected ? 'Deselect' : 'Select'} ${item.name}`} selected={selected} disabled={disabled} onPress={onSelect} />}
    <Pressable accessibilityRole="button" accessibilityLabel={`Open ${item.name}`} disabled={disabled} onPress={onOpen}
      android_ripple={disabled ? undefined : rippleFor(t.ripple)}
      style={({ pressed }) => ({ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 68,
        paddingVertical: space.md, opacity: pressedOpacity(pressed, disabled) })}>
      <View style={{ width: 44, height: 44, borderRadius: radius.sm, backgroundColor: t.surfaceAlt, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        {item.kind === 'image'
          ? <FileImage source={{ uri: item.uri }} contentFit="cover" style={{ width: 44, height: 44 }} recyclingKey={item.uri} allowDownscaling />
          : <Icon color={color} size={22} />}
      </View>
      <View style={{ flex: 1, gap: space.xs }}>
        <Text style={{ ...type.label, color: t.text }} numberOfLines={1}>{item.name}</Text>
        <Text style={{ ...type.caption, color: t.textMuted, fontVariant: ['tabular-nums'] }} numberOfLines={1}>
          {kindLabel} · {formatSize(item.size)}{item.pageCount ? ` · Page ${item.page || 1} of ${item.pageCount}` : ''}
        </Text>
      </View>
      {item.favorite && <AppIcon name="star" size={14} color={t.primary} filled />}
    </Pressable>
    {onMore && <IconButton name="more" label={`Actions for ${item.name}`} disabled={disabled} onPress={onMore} />}
  </View>;
}

// A calm pulse communicates "loading" without a spinner jumping into the layout,
// and keeps the list height stable while real rows arrive.
export function Skeleton({ width = '100%', height = 14, round = false, style }) {
  const { theme: t } = useTheme();
  const pulse = useRef(new Animated.Value(0.45)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 650, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0.45, duration: 650, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return <Animated.View accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    style={[{ width, height, borderRadius: round ? height / 2 : radius.sm, backgroundColor: t.skeleton, opacity: pulse }, style]} />;
}

export function FileListSkeleton({ rows = 4 }) {
  const { theme: t } = useTheme();
  return <View accessibilityLabel="Loading files" style={{ paddingHorizontal: space.md }}>
    {Array.from({ length: rows }, (_, index) => <View key={index}
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 68, paddingVertical: space.md,
        borderBottomWidth: index === rows - 1 ? 0 : hairline, borderColor: t.border }}>
      <Skeleton width={44} height={44} />
      <View style={{ flex: 1, gap: space.sm }}>
        <Skeleton width={`${62 + (index % 3) * 10}%`} height={13} round />
        <Skeleton width="38%" height={11} round />
      </View>
    </View>)}
  </View>;
}

// One banner shape for progress, success and failure, so feedback never looks improvised.
export function Banner({ tone = 'info', icon, message, children, onDismiss, busy }) {
  const { theme: t } = useTheme();
  const slide = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(slide, { toValue: 1, duration: 180, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [slide]);
  const palette = {
    info: { bg: t.surface, border: t.border, text: t.text, icon: t.textMuted },
    success: { bg: t.surface, border: t.border, text: t.text, icon: t.success },
    danger: { bg: t.dangerBg, border: t.dangerBg, text: t.danger, icon: t.danger },
  }[tone];
  return <Animated.View accessibilityRole={tone === 'danger' ? 'alert' : undefined}
    style={{ marginHorizontal: space.lg, marginBottom: space.sm, paddingHorizontal: space.md, paddingVertical: space.sm,
      borderRadius: radius.md, borderWidth: hairline, backgroundColor: palette.bg, borderColor: palette.border, gap: space.xs,
      opacity: slide, transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [-6, 0] }) }] }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
      {busy ? <Skeleton width={16} height={16} round /> : icon ? <AppIcon name={icon} color={palette.icon} size={17} /> : null}
      <Text accessibilityLiveRegion="polite" style={{ flex: 1, ...type.caption, color: palette.text }}>{message}</Text>
      {onDismiss && <IconButton name="close" label="Dismiss message" onPress={onDismiss} />}
    </View>
    {children}
  </Animated.View>;
}

// One overflow menu shape for every screen: the title bar stays a back button, a name
// and a single "more" control, so the document itself gets the whole screen.
export function MenuSheet({ visible, title, detail, items = [], onClose }) {
  const { theme: t } = useTheme();
  const usable = items.filter(Boolean);
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
    <View style={{ flex: 1, backgroundColor: t.scrim, justifyContent: 'flex-end' }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close menu" onPress={onClose} style={{ flex: 1 }} />
      <SafeAreaView edges={['bottom']} style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: '82%' }}>
        <View style={{ alignItems: 'center', paddingTop: space.sm }}>
          <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: t.border }} />
        </View>
        {!!title && <View style={{ paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm, gap: 2 }}>
          <Text accessibilityRole="header" style={{ ...type.label, color: t.text }} numberOfLines={1}>{title}</Text>
          {!!detail && <Text style={{ ...type.caption, color: t.textMuted }} numberOfLines={1}>{detail}</Text>}
        </View>}
        <ScrollView contentContainerStyle={{ paddingBottom: space.sm }}>
          {usable.map((item, index) => <Pressable key={item.key} accessibilityRole="button" accessibilityLabel={item.label}
            accessibilityState={{ disabled: !!item.disabled, selected: !!item.selected }} disabled={item.disabled} onPress={item.onPress}
            android_ripple={item.disabled ? undefined : rippleFor(t.ripple)}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56,
              paddingHorizontal: space.lg, paddingVertical: space.md, opacity: pressedOpacity(pressed, item.disabled),
              borderTopWidth: index && item.separated ? hairline : 0, borderColor: t.border })}>
            <AppIcon name={item.icon || 'arrow'} size={20} filled={item.filled}
              color={item.destructive ? t.danger : item.selected ? t.primary : t.textMuted} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ ...type.label, color: item.destructive ? t.danger : t.text }}>{item.label}</Text>
              {!!item.detail && <Text style={{ ...type.caption, color: t.textMuted }}>{item.detail}</Text>}
            </View>
            {item.selected && <AppIcon name="check" size={18} color={t.primary} />}
          </Pressable>)}
          {!usable.length && <Text style={{ ...type.caption, color: t.textMuted, padding: space.lg }}>No actions are available for this file right now.</Text>}
        </ScrollView>
      </SafeAreaView>
    </View>
  </Modal>;
}

export function EmptyState({ title, detail, icon = 'folder', action, onAction }) {
  const { theme: t } = useTheme();
  return <View style={{ alignItems: 'center', paddingHorizontal: space.xl, paddingVertical: space.xxl, gap: space.md }}>
    <View style={{ width: 56, height: 56, alignItems: 'center', justifyContent: 'center', borderRadius: radius.lg, backgroundColor: t.surfaceAlt }}>
      <AppIcon name={icon} size={24} color={t.textMuted} />
    </View>
    <Text style={{ ...type.heading, color: t.text, textAlign: 'center' }}>{title}</Text>
    <Text style={{ ...type.caption, color: t.textMuted, textAlign: 'center', maxWidth: 280 }}>{detail}</Text>
    {action && <ActionButton label={action} onPress={onAction} quiet style={{ marginTop: space.xs }} />}
  </View>;
}
