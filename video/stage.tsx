// The animated timeline "stage" shared by the narrated video and the interactive timeline:
// one horizontal line of events in a 1920x1080 world, a camera that flies between them, cards and axis.
import type { ReactNode } from 'react';
import { AbsoluteFill, Easing, interpolate, random, spring } from 'remotion';
import type { Incident, Level, Scene, TimelineEvent } from '../shared/types.ts';
import { PHASES } from '../shared/types.ts';
import { Icon, IconG } from '../shared/Icon.tsx';
import { fmtClock, fmtDate, LEVEL_ACCENT, PHASE_COLOR, PHASE_ICON, SEV_COLOR } from '../shared/theme.ts';
import { FPS } from './timing.ts';
import { Vignette } from './Vignette.tsx';

export const FONT = '"Inter", "Segoe UI", system-ui, -apple-system, sans-serif';
export const MONO = '"JetBrains Mono", "Cascadia Code", Consolas, "SF Mono", monospace';
export const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
export const smooth = (v: number, a: number, b: number) => interpolate(v, [a, b], [0, 1], { ...clamp, easing: Easing.inOut(Easing.quad) });

// World layout: events sit on one horizontal line (y = 0), evenly spaced; cards alternate above / below it.
export const SPACING = 1180;
export const CARD_W = 880;
export const STEM = 70;
/** Frames the camera spends flying between two events. */
export const FLY = 40;

export type Cam = { cx: number; cy: number; s: number; oy: number };

export interface World {
  events: TimelineEvent[];
  xs: number[];
  xStart: number;
  xEnd: number;
  mid: number;
  overview: number;
  camY: number;
  /** Incident time -> world x (piecewise linear between events). */
  xOfTs: (ts: number) => number;
  /** World x -> incident time (inverse of xOfTs). */
  tsOfX: (x: number) => number;
}

export function buildWorld(inc: Incident, events: TimelineEvent[], level: Level): World {
  const xs = events.map((_, i) => i * SPACING);
  const last = xs[xs.length - 1] ?? 0;
  const xStart = -560, xEnd = last + 560;
  const anchors: [number, number][] = [];
  const push = (ts: number, x: number) => { if (!anchors.length || ts > anchors[anchors.length - 1][0]) anchors.push([ts, x]); };
  if (events.length && inc.startTs < events[0].ts) push(inc.startTs, xStart);
  events.forEach((e, i) => push(e.ts, xs[i]));
  if (events.length && inc.endTs > events[events.length - 1].ts) push(inc.endTs, xEnd);
  const xOfTs = (ts: number) => {
    if (anchors.length < 2) return anchors[0]?.[1] ?? 0;
    for (let i = 1; i < anchors.length; i++) {
      const [t0, x0] = anchors[i - 1], [t1, x1] = anchors[i];
      if (ts <= t1) return x0 + ((ts - t0) / (t1 - t0)) * (x1 - x0);
    }
    return anchors[anchors.length - 1][1];
  };
  const tsOfX = (x: number) => {
    if (anchors.length < 2) return anchors[0]?.[0] ?? inc.startTs;
    if (x <= anchors[0][1]) return anchors[0][0];
    for (let i = 1; i < anchors.length; i++) {
      const [t0, x0] = anchors[i - 1], [t1, x1] = anchors[i];
      if (x <= x1) return t0 + ((x - x0) / (x1 - x0)) * (t1 - t0);
    }
    return anchors[anchors.length - 1][0];
  };
  return {
    events, xs, xStart, xEnd, xOfTs, tsOfX,
    mid: (xStart + xEnd) / 2,
    overview: Math.min(0.55, 1720 / (xEnd - xStart)),
    camY: level === 'senior' ? 255 : 225,
  };
}

// ---------------------------------------------------------------------------
/** Parallax star field + grid + giant faint clock, all drifting with the camera for depth. */
export function Backdrop({ cam, frame, accent, now, show }: { cam: Cam; frame: number; accent: string; now: number; show: boolean }) {
  const layers = [0.06, 0.14, 0.28];
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ background: `radial-gradient(1400px 800px at 30% 20%, ${accent}12, transparent 60%), radial-gradient(1000px 700px at 85% 90%, #ff3b5c10, transparent 60%)` }} />
      <AbsoluteFill
        style={{
          backgroundImage: 'linear-gradient(rgba(148,163,184,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.05) 1px, transparent 1px)',
          backgroundSize: `${80 * Math.pow(cam.s, 0.35)}px ${80 * Math.pow(cam.s, 0.35)}px`,
          backgroundPosition: `${-cam.cx * cam.s * 0.35}px ${-cam.cy * cam.s * 0.35}px`,
          maskImage: 'radial-gradient(ellipse at center, black 30%, transparent 80%)',
        }}
      />
      <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0 }}>
        {layers.map((depth, li) =>
          Array.from({ length: 40 }, (_, i) => {
            const W = 2400, H = 1300;
            const x = ((((random(`sx${li}-${i}`) * W - cam.cx * cam.s * depth) % W) + W) % W) - 240;
            const y = ((((random(`sy${li}-${i}`) * H - cam.cy * cam.s * depth) % H) + H) % H) - 110;
            const tw = 0.4 + 0.6 * Math.abs(Math.sin(frame / 25 + i));
            return <circle key={`${li}-${i}`} cx={x} cy={y} r={0.8 + li * 0.7} fill="#cbd5e1" opacity={(0.12 + li * 0.12) * tw} />;
          }),
        )}
      </svg>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 360, textAlign: 'center', fontFamily: MONO, fontWeight: 800, fontSize: 380, letterSpacing: -20, color: '#fff', opacity: show ? 0.035 : 0, transform: `translateX(${-cam.cx * cam.s * 0.08 % 400}px)`, whiteSpace: 'nowrap' }}>
        {fmtClock(now)}
      </div>
    </AbsoluteFill>
  );
}

// ---------------------------------------------------------------------------
export function TimelineAxis({ w, cam, proj, incident, level, frame, curK, playX, introLine, appearAt, revealed = curK, onSelect }: {
  w: World; cam: Cam; proj: (x: number, y: number) => { X: number; Y: number }; incident: Incident; level: Level; frame: number; curK: number; playX: number; introLine: number; appearAt: Map<string, number>;
  /** Highest event index whose card (and stem) is on screen; defaults to curK. */
  revealed?: number;
  /** Makes markers clickable (interactive timeline). */
  onSelect?: (k: number) => void;
}) {
  const a = proj(w.xStart, 0), b = proj(w.xEnd, 0);
  const reveal = interpolate(introLine, [4, 46], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const lineEnd = a.X + (b.X - a.X) * reveal;
  const play = proj(playX, 0);
  const r = interpolate(cam.s, [0.12, 1], [12, 30], clamp);
  const overviewLabels = 1 - smooth(cam.s, 0.22, 0.34);
  const zoomedIn = smooth(cam.s, 0.35, 0.7);

  // time ticks: pick a step that keeps them readable, cull labels that would collide
  const span = incident.endTs - incident.startTs;
  const steps = [60e3, 5 * 60e3, 15 * 60e3, 30 * 60e3, 3600e3, 2 * 3600e3, 6 * 3600e3, 12 * 3600e3, 86400e3, 7 * 86400e3];
  const step = steps.find((s) => span / s <= 48) ?? 30 * 86400e3;
  const ticks: { X: number; label: string }[] = [];
  for (let t = Math.ceil(incident.startTs / step) * step; t <= incident.endTs; t += step) {
    const p = proj(w.xOfTs(t), 0);
    if (p.X > -60 && p.X < 1980 && p.X <= lineEnd && (!ticks.length || p.X - ticks[ticks.length - 1].X >= 14)) ticks.push({ X: p.X, label: step >= 86400e3 ? fmtDate(t) : fmtClock(t) });
  }
  let lastLabel = -1e9;

  return (
    <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}>
      <defs>
        <linearGradient id="prog" x1="0" x2="1"><stop offset="0" stopColor="#38bdf8" /><stop offset="1" stopColor="#ff3b5c" /></linearGradient>
        <filter id="aglow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      </defs>
      {/* the line itself + progress fill */}
      <line x1={a.X} x2={lineEnd} y1={a.Y} y2={a.Y} stroke="#1e293b" strokeWidth={8} strokeLinecap="round" />
      {play.X > a.X && <line x1={a.X} x2={Math.min(play.X, lineEnd)} y1={a.Y} y2={a.Y} stroke="url(#prog)" strokeWidth={8} strokeLinecap="round" filter="url(#aglow)" />}

      {ticks.map((t, i) => {
        const showLabel = t.X - lastLabel > 120;
        if (showLabel) lastLabel = t.X;
        return (
          <g key={i}>
            <line x1={t.X} x2={t.X} y1={a.Y - 9} y2={a.Y + 9} stroke="#475569" strokeWidth={2} />
            {showLabel && <text x={t.X} y={a.Y + (zoomedIn > 0.5 ? 36 : 30)} textAnchor="middle" fill="#64748b" fontSize={zoomedIn > 0.5 ? 18 : 14} fontFamily={MONO} opacity={0.55 + 0.45 * zoomedIn}>{t.label}</text>}
          </g>
        );
      })}

      {/* "+2 h 15 min" pills between consecutive events, when there's room */}
      {w.events.slice(1).map((e, i) => {
        const p0 = proj(w.xs[i], 0), p1 = proj(w.xs[i + 1], 0);
        const gap = e.ts - w.events[i].ts;
        const room = p1.X - p0.X;
        if (gap <= 0 || room < 300 || p1.X < 0 || p0.X > 1920 || (p0.X + p1.X) / 2 > lineEnd) return null;
        const mx = (p0.X + p1.X) / 2;
        const label = `+${fmtGap(gap)}`;
        return (
          <g key={e.id} opacity={smooth(room, 300, 420)}>
            <rect x={mx - 12 - label.length * 6.2} y={a.Y - 44} width={24 + label.length * 12.4} height={30} rx={15} fill="#0b1220" stroke="#334155" />
            <text x={mx} y={a.Y - 23} textAnchor="middle" fill="#94a3b8" fontSize={18} fontFamily={MONO}>{label}</text>
          </g>
        );
      })}

      {/* stems from the line up/down to each visible card */}
      {w.events.map((e, k) => {
        if (k > revealed) return null;
        const cf = frame - (appearAt.get(e.id) ?? 0);
        if (cf < -10) return null;
        const side = k % 2 === 0 ? -1 : 1;
        const g = interpolate(cf, [-10, 4], [0, 1], clamp);
        const p0 = proj(w.xs[k], 0), p1 = proj(w.xs[k], side * STEM * g);
        return <line key={e.id} x1={p0.X} x2={p1.X} y1={p0.Y} y2={p1.Y} stroke={PHASE_COLOR[e.phase]} strokeWidth={3 * Math.max(0.5, cam.s)} opacity={zoomedIn * (k === curK ? 1 : 0.5)} />;
      })}

      {/* event markers */}
      {w.events.map((e, k) => {
        const p = proj(w.xs[k], 0);
        if (p.X < -120 || p.X > 2040 || p.X > lineEnd + 4) return null;
        const pop = introLine < 999 ? spring({ frame: introLine - 30 - k * Math.min(7, 50 / Math.max(1, w.events.length)), fps: FPS, config: { damping: 11, stiffness: 160 } }) : 1;
        const past = k < curK, active = k === curK;
        const color = PHASE_COLOR[e.phase];
        const arrive = active ? frame - (appearAt.get(e.id) ?? 0) : -1;
        const pulse = active ? 0.5 + 0.5 * Math.sin(frame / 6) : 0;
        const rr = r * (active ? 1.25 : 1) * pop;
        const lit = past || active || curK >= w.events.length;
        const side = k % 2 === 0 ? -1 : 1;
        return (
          <g key={e.id} transform={`translate(${p.X} ${p.Y})`} style={onSelect ? { cursor: "pointer", pointerEvents: "all" } : undefined} onClick={onSelect ? () => onSelect(k) : undefined}>
            {onSelect && <circle r={rr + 16} fill="transparent" />}
            {arrive >= 0 && arrive < 30 && <circle r={rr + arrive * 5} fill="none" stroke={color} strokeWidth={4} opacity={1 - arrive / 30} />}
            {active && <circle r={rr + 10 + pulse * 8} fill="none" stroke={color} strokeOpacity={0.35 + pulse * 0.3} strokeWidth={3} />}
            <circle r={rr} fill={lit ? '#0b1220' : '#0a0f1a'} stroke={lit ? color : '#334155'} strokeWidth={active ? 5 : 3.5} filter={lit ? 'url(#aglow)' : undefined} />
            <g transform={`scale(${pop})`}><IconG name={PHASE_ICON[e.phase]} x={0} y={0} size={r * 1.05} color={lit ? color : '#475569'} stroke={2.2} /></g>
            {overviewLabels > 0.02 && (
              <g opacity={overviewLabels * Math.min(1, pop)} transform={`translate(0 ${side * (rr + 22)})`}>
                <text y={side < 0 ? -22 : 14} textAnchor="middle" fill={lit ? color : '#94a3b8'} fontSize={16} fontFamily={MONO} fontWeight={700}>{fmtClock(e.ts)}</text>
                <text y={side < 0 ? 0 : 36} textAnchor="middle" fill={lit ? '#e2e8f0' : '#94a3b8'} fontSize={17} fontWeight={600}>{shortLabel(e, level)}</text>
              </g>
            )}
          </g>
        );
      })}

      {/* playhead */}
      {curK >= 0 && curK < w.events.length && (
        <g transform={`translate(${play.X} ${play.Y})`} opacity={zoomedIn}>
          <path d="M-10 -52 L10 -52 L0 -38 Z" fill="#fff" />
        </g>
      )}
    </svg>
  );
}

function shortLabel(e: TimelineEvent, level: Level) {
  const s = level === 'layman' ? PHASES.find((p) => p.id === e.phase)!.plain : e.label;
  return s.length > 20 ? s.slice(0, 19) + '…' : s;
}

function fmtGap(ms: number) {
  const m = Math.round(ms / 60000);
  if (m < 1) return `${Math.max(1, Math.round(ms / 1000))} s`;
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  if (h < 48) return r ? `${h} h ${r} min` : `${h} h`;
  return `${Math.round(h / 24)} days`;
}

// ---------------------------------------------------------------------------
export function EventCard({ e, heading, k, x, cf, active, level, incident, evidence, onClick }: {
  e: TimelineEvent; heading: string; k: number; x: number; cf: number; active: boolean; level: Level; incident: Incident; evidence?: string[]; onClick?: () => void;
}) {
  const fps = FPS;
  const side = k % 2 === 0 ? -1 : 1;
  const enter = spring({ frame: cf, fps, config: { damping: 15, stiffness: 120 } });
  const color = PHASE_COLOR[e.phase];
  const phase = PHASES.find((p) => p.id === e.phase)!;
  const words = heading.split(' ');
  const timeIn = spring({ frame: cf - 4, fps, config: { damping: 18 } });
  return (
    <div
      onClick={onClick}
      style={{
        position: 'absolute', left: x - CARD_W / 2, width: CARD_W, cursor: onClick && !active ? 'pointer' : undefined,
        ...(side < 0 ? { bottom: STEM } : { top: STEM }),
        transformOrigin: side < 0 ? '50% 100%' : '50% 0%',
        transform: `translateY(${(1 - enter) * side * -40}px) scale(${0.7 + 0.3 * enter})`,
        opacity: enter * (active ? 1 : 0.42),
        filter: active ? undefined : 'saturate(0.5)',
      }}
    >
      <div style={{ borderRadius: 28, padding: '26px 30px', background: 'linear-gradient(160deg, rgba(17,26,46,0.96), rgba(8,13,26,0.96))', border: `2px solid ${color}55`, boxShadow: `0 30px 80px rgba(0,0,0,0.5), 0 0 60px ${color}${active ? '30' : '00'}`, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, padding: '8px 16px', borderRadius: 999, background: `${color}22`, border: `2px solid ${color}`, color, fontWeight: 750, fontSize: 21 }}>
            <Icon name={PHASE_ICON[e.phase]} size={21} color={color} /> {level === 'layman' ? phase.plain : phase.label}
          </span>
          {level !== 'layman' && <span style={{ marginLeft: 'auto', color: SEV_COLOR[e.severity], fontWeight: 800, fontSize: 18, letterSpacing: 2 }}>{e.severity.toUpperCase()}</span>}
        </div>
        <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontFamily: MONO, fontSize: 66, fontWeight: 750, letterSpacing: -2, color: '#fff', textShadow: `0 0 30px ${color}66`, opacity: timeIn, transform: `translateX(${(1 - timeIn) * -30}px)` }}>
              {fmtClock(e.ts)}
            </div>
            <div style={{ fontSize: level === 'layman' ? 40 : 36, fontWeight: 800, lineHeight: 1.12, letterSpacing: -0.5 }}>
              {words.map((wd, i) => {
                const s = spring({ frame: cf - 8 - i * 2, fps, config: { damping: 14, stiffness: 140 } });
                return <span key={i} style={{ display: 'inline-block', marginRight: 11, opacity: s, transform: `translateY(${(1 - s) * 26}px)` }}>{wd}</span>;
              })}
            </div>
            {level !== 'layman' && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {e.technique && <Chip color={color} mono>{e.technique.id} · {e.technique.name}</Chip>}
                {e.fromHost ? <Chip>{e.fromHost} → {e.toHost}</Chip> : e.host && <Chip>{e.host}</Chip>}
                {level === 'senior' && <Chip>conf {Math.round(e.confidence * 100)}%</Chip>}
              </div>
            )}
          </div>
          <div style={{ flex: '0 0 auto' }}>
            <Vignette e={e} f={cf} incident={incident} level={level} />
          </div>
        </div>
        {level === 'senior' && (evidence?.length || e.iocs?.length) ? <Terminal lines={evidence?.length ? evidence : (e.iocs ?? []).map((i) => `IOC  ${i}`)} f={cf} /> : null}
      </div>
    </div>
  );
}

function Chip({ children, color = '#94a3b8', mono }: { children: ReactNode; color?: string; mono?: boolean }) {
  return (
    <span style={{ padding: '6px 13px', borderRadius: 10, background: 'rgba(15,23,42,0.85)', border: `1px solid ${color}55`, color, fontSize: 17, fontFamily: mono ? MONO : FONT, fontWeight: 600, maxWidth: 480, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
      {children}
    </span>
  );
}

function Terminal({ lines, f }: { lines: string[]; f: number }) {
  const chars = Math.max(0, (f - 20) * 10);
  let used = 0;
  return (
    <div style={{ borderRadius: 14, background: '#020617', border: '1px solid #1e3a2a', padding: '12px 18px', fontFamily: MONO, fontSize: 15, color: '#86efac', lineHeight: 1.55, overflow: 'hidden' }}>
      {lines.slice(0, 3).map((l, i) => {
        const show = Math.max(0, Math.min(l.length, chars - used));
        used += l.length;
        return <div key={i} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{'> '}{l.slice(0, Math.min(show, 140))}</div>;
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
export function Hud({ incident, level, frame, now, events, curK, kind, brand = true }: { incident: Incident; level: Level; frame: number; now: number; events: TimelineEvent[]; curK: number; kind: Scene['kind']; brand?: boolean }) {
  const o = interpolate(frame, [0, 20], [0, 1], clamp);
  return (
    <>
      <div style={{ position: 'absolute', left: 56, top: 42, display: brand ? 'flex' : 'none', alignItems: 'center', gap: 12, opacity: o }}>
        <div style={{ width: 38, height: 38, borderRadius: 11, background: 'linear-gradient(135deg,#38bdf8,#a855f7)', display: 'grid', placeItems: 'center' }}>
          <Icon name="layers" size={21} color="#fff" />
        </div>
        <span style={{ fontWeight: 800, fontSize: 22, letterSpacing: 0.5 }}>Seen<span style={{ color: '#7dd3fc' }}>Visualizer</span></span>
        <span style={{ marginLeft: 8, width: 10, height: 10, borderRadius: 5, background: LEVEL_ACCENT[level], boxShadow: `0 0 12px ${LEVEL_ACCENT[level]}` }} />
      </div>
      <div style={{ position: 'absolute', right: 56, top: 34, textAlign: 'right', opacity: o * (kind === 'actions' ? 0 : 1) }}>
        <div style={{ fontFamily: MONO, fontSize: 18, color: '#64748b', letterSpacing: 3 }}>{fmtDate(now).toUpperCase()}</div>
        <div style={{ fontFamily: MONO, fontSize: 50, fontWeight: 750, letterSpacing: -1, color: '#f1f5f9' }}>{fmtClock(now)}</div>
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 8 }}>
          {events.map((e, k) => (
            <span key={e.id} style={{ width: k === curK ? 26 : 10, height: 10, borderRadius: 5, background: k <= curK ? PHASE_COLOR[e.phase] : '#1e293b' }} />
          ))}
        </div>
      </div>
    </>
  );
}

