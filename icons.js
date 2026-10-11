import Svg, { Path, Rect, Circle, Line, Polyline } from 'react-native-svg';

// Lightweight SVG icons so the app needs no icon font/asset and works fully offline.
// Every icon takes a color and size and draws on a 24x24 grid with one stroke weight,
// so file icons sit calmly next to the interface icons in workspaceUi.
const STROKE = 1.6;

export function PdfIcon({ color = '#b25741', size = 24 }) {
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round">
    <Path d="M6 2.8h7.5L18 7.3V20a1.4 1.4 0 0 1-1.4 1.4H6A1.4 1.4 0 0 1 4.6 20V4.2A1.4 1.4 0 0 1 6 2.8z" />
    <Path d="M13.4 2.8v4.6H18" />
    <Path d="M8 17v-4.4h1.2a1.1 1.1 0 0 1 0 2.2H8" strokeWidth={1.3} />
    <Path d="M12.6 12.6V17h.8a1.5 1.5 0 0 0 1.5-1.5v-1.4a1.5 1.5 0 0 0-1.5-1.5z" strokeWidth={1.3} />
  </Svg>;
}

export function ImageIcon({ color = '#1f7a64', size = 24 }) {
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round">
    <Rect x={3.2} y={4.4} width={17.6} height={15.2} rx={2.6} />
    <Circle cx={8.6} cy={9.4} r={1.5} />
    <Path d="M4.2 17.4l4.3-4.2a1.5 1.5 0 0 1 2.1 0l3.3 3.2M13.3 14.6l1.6-1.5a1.5 1.5 0 0 1 2.1 0l2.8 2.7" />
  </Svg>;
}

export function TextIcon({ color = '#4a67a6', size = 24 }) {
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round">
    <Path d="M6 2.8h7.5L18 7.3V20a1.4 1.4 0 0 1-1.4 1.4H6A1.4 1.4 0 0 1 4.6 20V4.2A1.4 1.4 0 0 1 6 2.8z" />
    <Path d="M13.4 2.8v4.6H18" />
    <Line x1={8} y1={12.4} x2={14.6} y2={12.4} strokeWidth={1.3} />
    <Line x1={8} y1={15.4} x2={14.6} y2={15.4} strokeWidth={1.3} />
    <Line x1={8} y1={18.4} x2={11.6} y2={18.4} strokeWidth={1.3} />
  </Svg>;
}

export function SunIcon({ color = '#16211f', size = 20 }) {
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={STROKE} strokeLinecap="round">
    <Circle cx={12} cy={12} r={4.2} />
    <Path d="M12 2.4v2.2M12 19.4v2.2M5 5l1.5 1.5M17.5 17.5 19 19M2.4 12h2.2M19.4 12h2.2M5 19l1.5-1.5M17.5 6.5 19 5" />
  </Svg>;
}

export function MoonIcon({ color = '#edf1f0', size = 20 }) {
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={STROKE} strokeLinejoin="round">
    <Path d="M20.6 13.2A8.6 8.6 0 1 1 11.2 3.4a6.9 6.9 0 0 0 9.4 9.8z" />
  </Svg>;
}

export function ChevronRight({ color = '#8a9592', size = 18 }) {
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Polyline points="9.5 6.5 15 12 9.5 17.5" stroke={color} strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>;
}

export const FILE_ICON = { pdf: PdfIcon, image: ImageIcon, text: TextIcon };
