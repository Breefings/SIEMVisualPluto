import { useEffect, useMemo, useState } from 'react';

/** Halftone dot color (charcoal #50514F). */
const DOT = '#50514F';
/** Distance between dot centres, px. */
const GAP = 13;
/** Portion of the viewport height the pattern climbs. */
const REACH = 1 / 3;

/**
 * Fixed page-background halftone: dense, merging charcoal dots along the bottom edge that shrink to
 * fine specks by the first third of the screen. Staggered (hex) grid; dot size follows an eased ramp
 * with a gentle low-frequency wobble so the edge of the gradient isn't a ruler-straight line.
 */
export function Halftone() {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    let raf = 0;
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setSize({ w: window.innerWidth, h: window.innerHeight }));
    };
    addEventListener('resize', on);
    return () => { removeEventListener('resize', on); cancelAnimationFrame(raf); };
  }, []);

  const height = Math.round(size.h * REACH);
  const path = useMemo(() => {
    const rowH = GAP * 0.866; // hex row spacing
    const rows = Math.ceil(height / rowH) + 1;
    const cols = Math.ceil(size.w / GAP) + 2;
    const maxR = GAP * 0.62; // > GAP/2 so the bottom rows merge into a near-solid band
    let d = '';
    for (let j = 0; j < rows; j++) {
      const y = height - j * rowH;
      const off = j % 2 ? GAP / 2 : 0;
      for (let i = -1; i < cols; i++) {
        const x = i * GAP + off;
        // 0 at the bottom edge -> 1 at the top of the band, nudged by a slow wave across the width
        const wave = 0.06 * Math.sin(x / 210) + 0.04 * Math.sin(x / 77 + 1.3);
        const t = Math.min(1, Math.max(0, (height - y) / height + wave));
        const r = maxR * Math.pow(1 - t, 1.9);
        if (r < 0.35) continue;
        // circle as a path: two arcs (one <path> keeps the DOM tiny)
        d += `M${(x - r).toFixed(1)} ${y.toFixed(1)}a${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(2 * r).toFixed(2)} 0a${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(-2 * r).toFixed(2)} 0`;
      }
    }
    return d;
  }, [size.w, height]);

  return (
    <svg className="halftone" width={size.w} height={height} viewBox={`0 0 ${size.w} ${height}`} aria-hidden>
      <path d={path} fill={DOT} />
    </svg>
  );
}
