import { useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { MAX_SIGNATURE_POINTS, MAX_SIGNATURE_STROKES } from './pdfOperations.cjs';
import { useTheme } from './theme';

export default function SignaturePad({ value, onChange, disabled = false }) {
  const { theme } = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [draft, setDraft] = useState([]);
  const [limited, setLimited] = useState(false);
  const props = useRef({ value, onChange, disabled });
  props.current = { value, onChange, disabled };
  const bounds = useRef({ width: 1, height: 1 });
  const stroke = useRef([]);
  const remaining = useRef(0);

  function addPoint(event) {
    if (stroke.current.length >= remaining.current) { setLimited(true); return; }
    const { locationX, locationY } = event.nativeEvent;
    const point = { x: Math.max(0, Math.min(1, locationX / bounds.current.width)), y: Math.max(0, Math.min(1, locationY / bounds.current.height)) };
    const last = stroke.current[stroke.current.length - 1];
    if (last && Math.abs(last.x - point.x) + Math.abs(last.y - point.y) < 0.004) return;
    stroke.current.push(point);
    setDraft(stroke.current.slice());
  }

  function finish() {
    if (stroke.current.length) props.current.onChange([...props.current.value, stroke.current.slice()]);
    stroke.current = [];
    setDraft([]);
  }

  const responder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => !props.current.disabled,
    onMoveShouldSetPanResponder: () => !props.current.disabled,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: event => {
      stroke.current = [];
      remaining.current = props.current.value.length >= MAX_SIGNATURE_STROKES ? 0 : MAX_SIGNATURE_POINTS - props.current.value.reduce((count, line) => count + line.length, 0);
      addPoint(event);
    },
    onPanResponderMove: addPoint,
    onPanResponderRelease: finish,
    onPanResponderTerminate: finish,
  })).current;

  return <View style={styles.root}>
    <Text style={styles.label}>Draw with your finger</Text>
    <View accessibilityLabel="Handwritten signature drawing area" style={[styles.pad, disabled && styles.disabled]}
      onLayout={event => { bounds.current = event.nativeEvent.layout; }} {...responder.panHandlers}>
      <Svg pointerEvents="none" width="100%" height="100%" viewBox="0 0 1000 400" preserveAspectRatio="none">
        {[...value, ...(draft.length ? [draft] : [])].map((line, index) => <Path key={index}
          d={line.map((point, i) => `${i ? 'L' : 'M'} ${point.x * 1000} ${point.y * 400}`).join(' ') + (line.length === 1 ? ' l 0.1 0.1' : '')}
          fill="none" stroke="#122449" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />)}
      </Svg>
      {/* The pad keeps a fixed light canvas with dark ink so signatures render identically in both themes and in the exported PDF. */}
    </View>
    <View style={styles.footer}>
      <Text style={styles.hint}>{limited ? 'Drawing limit reached. Clear to draw again.' : 'Handwriting only, not a cryptographic digital signature.'}</Text>
      <Pressable accessibilityRole="button" disabled={disabled} onPress={() => { onChange([]); setDraft([]); stroke.current = []; setLimited(false); }} style={styles.clear}>
        <Text style={styles.clearText}>Clear</Text>
      </Pressable>
    </View>
  </View>;
}

function makeStyles(t) {
  return StyleSheet.create({
    root: { gap: 8 }, label: { color: t.text, fontSize: 13, fontWeight: '600' },
    pad: { width: '100%', aspectRatio: 2.5, maxHeight: 180, backgroundColor: '#f6f7fa', borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: t.border },
    footer: { flexDirection: 'row', alignItems: 'center', gap: 12 }, hint: { flex: 1, color: t.textMuted, fontSize: 12, lineHeight: 17 },
    clear: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 16, borderRadius: 10, backgroundColor: t.surfaceAlt },
    clearText: { color: t.text, fontWeight: '600' }, disabled: { opacity: 0.5 },
  });
}
