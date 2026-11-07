import type { CSSProperties } from 'react';
import { ICON_PATHS, type IconName } from './theme.ts';

export function Icon({ name, size = 18, color = 'currentColor', stroke = 2, style }: { name: IconName; size?: number; color?: string; stroke?: number; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" style={style} aria-hidden>
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

/** Same icon, as an SVG <g> for embedding inside another SVG at (x,y). */
export function IconG({ name, x, y, size, color, stroke = 2 }: { name: IconName; x: number; y: number; size: number; color: string; stroke?: number }) {
  const s = size / 24;
  return (
    <g transform={`translate(${x - size / 2} ${y - size / 2}) scale(${s})`} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      <path d={ICON_PATHS[name]} />
    </g>
  );
}
