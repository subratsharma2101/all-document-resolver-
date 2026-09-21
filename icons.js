import Svg, { Path, Rect, Circle, Line, Polyline } from 'react-native-svg';

// Lightweight SVG icons so the app needs no icon font/asset and works fully offline.
// Every icon takes a color and size and draws on a 24x24 grid.

export function PdfIcon({ color = '#f4553d', size = 26 }) {
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M6 2h8l4 4v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill={color} opacity={0.16} />
    <Path d="M6 2h8l4 4v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" stroke={color} strokeWidth={1.6} />
    <Path d="M14 2v4h4" stroke={color} strokeWidth={1.6} strokeLinejoin="round" />
    <Path d="M8 14.5h1.2a1.1 1.1 0 0 0 0-2.2H8v4.4M12.4 12.3v4.4h.9a1.6 1.6 0 0 0 1.6-1.6v-1.2a1.6 1.6 0 0 0-1.6-1.6zM17.2 12.3H16v4.4M16 14.5h1.2" stroke={color} strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>;
}

export function ImageIcon({ color = '#2ea36b', size = 26 }) {
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Rect x={3} y={4} width={18} height={16} rx={2.4} fill={color} opacity={0.16} />
    <Rect x={3} y={4} width={18} height={16} rx={2.4} stroke={color} strokeWidth={1.6} />
    <Circle cx={8.5} cy={9} r={1.6} fill={color} />
    <Path d="M4 17l4.5-4.5a1.5 1.5 0 0 1 2 0L15 17M13 15l2-2a1.5 1.5 0 0 1 2 0l3 3" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>;
}

export function TextIcon({ color = '#3f7ef4', size = 26 }) {
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M6 2h8l4 4v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill={color} opacity={0.16} />
    <Path d="M6 2h8l4 4v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" stroke={color} strokeWidth={1.6} />
    <Path d="M14 2v4h4" stroke={color} strokeWidth={1.6} strokeLinejoin="round" />
    <Line x1={8} y1={12} x2={15} y2={12} stroke={color} strokeWidth={1.4} strokeLinecap="round" />
    <Line x1={8} y1={15} x2={15} y2={15} stroke={color} strokeWidth={1.4} strokeLinecap="round" />
    <Line x1={8} y1={18} x2={12} y2={18} stroke={color} strokeWidth={1.4} strokeLinecap="round" />
  </Svg>;
}

export function SunIcon({ color = '#12151c', size = 22 }) {
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Circle cx={12} cy={12} r={4} stroke={color} strokeWidth={1.7} />
    <Path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" stroke={color} strokeWidth={1.7} strokeLinecap="round" />
  </Svg>;
}

export function MoonIcon({ color = '#f4f5f8', size = 22 }) {
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" fill={color} opacity={0.18} stroke={color} strokeWidth={1.7} strokeLinejoin="round" />
  </Svg>;
}

export function ChevronRight({ color = '#8a92a2', size = 22 }) {
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Polyline points="9 6 15 12 9 18" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>;
}

export const FILE_ICON = { pdf: PdfIcon, image: ImageIcon, text: TextIcon };
