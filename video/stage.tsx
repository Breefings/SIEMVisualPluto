// The animated timeline "stage" shared by the narrated video and the interactive timeline:
// one horizontal line of events in a 1920x1080 world, a camera that flies between them, cards and axis.
// Visual language: monochrome charcoal + off-white, a single red accent for compromise, time rulers.
import type { ReactNode } from 'react';
import { AbsoluteFill, Easing, interpolate, spring } from 'remotion';
import type { Incident, Level, Scene, TimelineEvent } from '../shared/types.ts';
import { PHASES } from '../shared/types.ts';
import { Icon, IconG } from '../shared/Icon.tsx';
import { fmtClock, fmtDate, FONT_MONO, FONT_SANS, INK, PHASE_COLOR, PHASE_ICON, SEV_COLOR } from '../shared/theme.ts';
import { FPS } from './timing.ts';
import { Vignette } from './Vignette.tsx';

export const FONT = FONT_SANS;
export const MONO = FONT_MONO;
export const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
export const smooth = (v: number, a: number, b: number) => interpolate(v, [a, b], [0, 1], { ...clamp, easing: Easing.inOut(Easing.quad) });
/** Wide-tracked uppercase label style used across the stage. */
export const LABEL = { fontFamily: FONT_SANS, textTransform: 'uppercase' as const, letterSpacing: '0.24em', fontWeight: 500 };

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
const GRAIN = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.07'/%3E%3C/svg%3E\")";

/** A strip of ruler ticks that slides with the camera (parallax), the stage's "time" texture. */
function Ruler({ y, offset, flip, opacity }: { y: number; offset: number; flip?: boolean; opacity: number }) {
  const minor = 16, every = 10;
  const o = ((offset % (minor * every)) + minor * every) % (minor * every);
  const n = Math.ceil(1920 / minor) + every * 2;
  const d = flip ? -1 : 1;
  return (
    <g opacity={opacity}>
      {Array.from({ length: n }, (_, i) => {
        const x = i * minor - o;
        const major = i % every === 0;
        return <line key={i} x1={x} x2={x} y1={y} y2={y + d * (major ? 14 : 6)} stroke={major ? INK.faint : INK.line2} strokeWidth={1} />;
      })}
    </g>
  );
}

/** Charcoal backdrop: soft spotlight, film grain, parallax time rulers, giant faint clock. */
export function Backdrop({ cam, frame, now, show }: { cam: Cam; frame: number; accent?: string; now: number; show: boolean }) {
  const drift = cam.cx * cam.s;
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ background: `radial-gradient(1300px 900px at ${48 + Math.sin(frame / 240) * 3}% 38%, #2b2c31 0%, #1b1c20 48%, #121316 100%)` }} />
      <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0 }}>
        <Ruler y={0} offset={drift * 0.5} opacity={0.55} />
        <Ruler y={1080} offset={drift * 0.5} flip opacity={0.55} />
      </svg>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 330, textAlign: 'center', fontFamily: FONT_SANS, fontWeight: 300, fontSize: 400, letterSpacing: 10, color: INK.white, opacity: show ? 0.03 : 0, transform: `translateX(${(-drift * 0.08) % 400}px)`, whiteSpace: 'nowrap' }}>
        {fmtClock(now)}
      </div>
      <AbsoluteFill style={{ backgroundImage: GRAIN, opacity: 0.9 }} />
      <AbsoluteFill style={{ background: 'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.45) 100%)' }} />
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
  const r = interpolate(cam.s, [0.12, 1], [11, 26], clamp);
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
  // fine ruler ticks between the labelled ones
  const minor: number[] = [];
  for (let i = 0; i + 1 < ticks.length; i++) {
    const gap = ticks[i + 1].X - ticks[i].X;
    const n = gap > 120 ? 5 : gap > 50 ? 2 : 0;
    for (let j = 1; j < n; j++) minor.push(ticks[i].X + (gap * j) / n);
  }
  let lastLabel = -1e9;

  return (
    <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}>
      {/* the line itself + progress fill */}
      <line x1={a.X} x2={lineEnd} y1={a.Y} y2={a.Y} stroke={INK.line2} strokeWidth={2} />
      {play.X > a.X && <line x1={a.X} x2={Math.min(play.X, lineEnd)} y1={a.Y} y2={a.Y} stroke={INK.text} strokeWidth={2} />}

      {minor.map((x, i) => x <= lineEnd && <line key={`m${i}`} x1={x} x2={x} y1={a.Y} y2={a.Y + 7} stroke={INK.line2} strokeWidth={1} />)}
      {ticks.map((t, i) => {
        const showLabel = t.X - lastLabel > 120;
        if (showLabel) lastLabel = t.X;
        return (
          <g key={i}>
            <line x1={t.X} x2={t.X} y1={a.Y} y2={a.Y + 16} stroke={INK.faint} strokeWidth={1.5} />
            {showLabel && <text x={t.X} y={a.Y + (zoomedIn > 0.5 ? 42 : 36)} textAnchor="middle" fill={INK.dim} fontSize={zoomedIn > 0.5 ? 17 : 14} fontFamily={MONO} letterSpacing={1} opacity={0.6 + 0.4 * zoomedIn}>{t.label}</text>}
          </g>
        );
      })}

      {/* "+2 H 15 MIN" between consecutive events, when there's room */}
      {w.events.slice(1).map((e, i) => {
        const p0 = proj(w.xs[i], 0), p1 = proj(w.xs[i + 1], 0);
        const gap = e.ts - w.events[i].ts;
        const room = p1.X - p0.X;
        if (gap <= 0 || room < 300 || p1.X < 0 || p0.X > 1920 || (p0.X + p1.X) / 2 > lineEnd) return null;
        const mx = (p0.X + p1.X) / 2;
        const label = `+${fmtGap(gap)}`.toUpperCase();
        return (
          <g key={e.id} opacity={smooth(room, 300, 420)}>
            <text x={mx} y={a.Y - 18} textAnchor="middle" fill={INK.dim} fontSize={16} fontFamily={FONT} letterSpacing={4} fontWeight={500}>{label}</text>
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
        return <line key={e.id} x1={p0.X} x2={p1.X} y1={p0.Y} y2={p1.Y} stroke={k === curK ? PHASE_COLOR[e.phase] : INK.line2} strokeWidth={1.5 * Math.max(0.6, cam.s)} opacity={zoomedIn} />;
      })}

      {/* event markers */}
      {w.events.map((e, k) => {
        const p = proj(w.xs[k], 0);
        if (p.X < -120 || p.X > 2040 || p.X > lineEnd + 4) return null;
        const pop = introLine < 999 ? spring({ frame: introLine - 30 - k * Math.min(7, 50 / Math.max(1, w.events.length)), fps: FPS, config: { damping: 14, stiffness: 160 } }) : 1;
        const past = k < curK, active = k === curK;
        const color = PHASE_COLOR[e.phase];
        const arrive = active ? frame - (appearAt.get(e.id) ?? 0) : -1;
        const rr = r * (active ? 1.2 : 1) * pop;
        const lit = past || active || curK >= w.events.length;
        const side = k % 2 === 0 ? -1 : 1;
        return (
          <g key={e.id} transform={`translate(${p.X} ${p.Y})`} style={onSelect ? { cursor: 'pointer', pointerEvents: 'all' } : undefined} onClick={onSelect ? () => onSelect(k) : undefined}>
            {onSelect && <circle r={rr + 16} fill="transparent" />}
            {arrive >= 0 && arrive < 36 && <circle r={rr + arrive * 4} fill="none" stroke={color} strokeWidth={1.5} opacity={(1 - arrive / 36) * 0.8} />}
            {active && <circle r={rr + 9} fill="none" stroke={color} strokeOpacity={0.5} strokeWidth={1} strokeDasharray="2 5" transform={`rotate(${frame * 1.2})`} />}
            <circle r={rr} fill={active ? color : INK.bg} stroke={lit ? color : INK.line2} strokeWidth={active ? 2 : 1.5} />
            <g transform={`scale(${pop})`}><IconG name={PHASE_ICON[e.phase]} x={0} y={0} size={r * 0.95} color={active ? INK.bg : lit ? color : INK.faint} stroke={1.8} /></g>
            {overviewLabels > 0.02 && (
              <g opacity={overviewLabels * Math.min(1, pop)} transform={`translate(0 ${side * (rr + 22)})`}>
                <text y={side < 0 ? -22 : 14} textAnchor="middle" fill={lit ? color : INK.dim} fontSize={15} fontFamily={MONO} letterSpacing={1}>{fmtClock(e.ts)}</text>
                <text y={side < 0 ? 0 : 36} textAnchor="middle" fill={lit ? INK.text : INK.dim} fontSize={14} fontFamily={FONT} letterSpacing={3} fontWeight={500}>{shortLabel(e, level).toUpperCase()}</text>
              </g>
            )}
          </g>
        );
      })}

      {/* playhead: a hairline that drops through the axis */}
      {curK >= 0 && curK < w.events.length && (
        <g transform={`translate(${play.X} ${play.Y})`} opacity={zoomedIn}>
          <line x1={0} x2={0} y1={-46} y2={22} stroke={INK.white} strokeWidth={1} />
          <circle cx={0} cy={-46} r={3} fill={INK.white} />
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
  const enter = spring({ frame: cf, fps, config: { damping: 18, stiffness: 110 } });
  const color = PHASE_COLOR[e.phase];
  const hot = color === INK.red;
  const phase = PHASES.find((p) => p.id === e.phase)!;
  const words = heading.split(' ');
  const timeIn = spring({ frame: cf - 4, fps, config: { damping: 20 } });
  const rule = interpolate(cf, [6, 30], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  return (
    <div
      onClick={onClick}
      style={{
        position: 'absolute', left: x - CARD_W / 2, width: CARD_W, cursor: onClick && !active ? 'pointer' : undefined,
        ...(side < 0 ? { bottom: STEM } : { top: STEM }),
        transformOrigin: side < 0 ? '50% 100%' : '50% 0%',
        transform: `translateY(${(1 - enter) * side * -30}px) scale(${0.8 + 0.2 * enter})`,
        opacity: enter * (active ? 1 : 0.35),
      }}
    >
      <div style={{ position: 'relative', borderRadius: 4, padding: '34px 40px 32px', background: 'linear-gradient(180deg, #27282d, #1f2024)', border: `1px solid ${active ? INK.line2 : INK.line}`, boxShadow: '0 40px 90px rgba(0,0,0,0.55), 0 4px 14px rgba(0,0,0,0.3)', display: 'flex', flexDirection: 'column', gap: 18 }}>
        {/* top hairline in the event's color, drawn like a time ruler being filled */}
        <div style={{ position: 'absolute', left: 0, top: -1, height: 2, width: `${rule * 100}%`, background: hot ? INK.red : INK.text, opacity: active ? 1 : 0.5 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ ...LABEL, display: 'inline-flex', alignItems: 'center', gap: 10, padding: '7px 14px', border: `1px solid ${hot ? INK.red : INK.line2}`, borderRadius: 2, color: hot ? INK.red : INK.muted, fontSize: 15 }}>
            <Icon name={PHASE_ICON[e.phase]} size={18} color={hot ? INK.red : INK.muted} /> {level === 'layman' ? phase.plain : phase.label}
          </span>
          {level !== 'layman' && <span style={{ ...LABEL, marginLeft: 'auto', color: SEV_COLOR[e.severity], fontSize: 14 }}>{e.severity}</span>}
        </div>
        <div style={{ display: 'flex', gap: 30, alignItems: 'center' }}>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontFamily: FONT, fontSize: 78, fontWeight: 300, letterSpacing: 2, lineHeight: 1, color: INK.white, opacity: timeIn, transform: `translateX(${(1 - timeIn) * -24}px)` }}>
              {fmtClock(e.ts)}
            </div>
            <div style={{ fontSize: level === 'layman' ? 34 : 30, fontWeight: 600, lineHeight: 1.18, letterSpacing: '0.06em', textTransform: 'uppercase', color: INK.text }}>
              {words.map((wd, i) => {
                const s = spring({ frame: cf - 8 - i * 2, fps, config: { damping: 16, stiffness: 140 } });
                return <span key={i} style={{ display: 'inline-block', marginRight: 14, opacity: s, transform: `translateY(${(1 - s) * 18}px)` }}>{wd}</span>;
              })}
            </div>
            {level !== 'layman' && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {e.technique && <Chip mono>{e.technique.id} · {e.technique.name}</Chip>}
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

function Chip({ children, mono }: { children: ReactNode; mono?: boolean }) {
  return (
    <span style={{ padding: '6px 12px', borderRadius: 2, border: `1px solid ${INK.line2}`, color: INK.muted, fontSize: 16, fontFamily: mono ? MONO : FONT, fontWeight: 400, letterSpacing: mono ? 0 : 1, maxWidth: 480, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
      {children}
    </span>
  );
}

function Terminal({ lines, f }: { lines: string[]; f: number }) {
  const chars = Math.max(0, (f - 20) * 10);
  let used = 0;
  return (
    <div style={{ borderTop: `1px solid ${INK.line}`, paddingTop: 16, fontFamily: MONO, fontSize: 15, color: INK.muted, lineHeight: 1.6, overflow: 'hidden' }}>
      {lines.slice(0, 3).map((l, i) => {
        const show = Math.max(0, Math.min(l.length, chars - used));
        used += l.length;
        return <div key={i} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}><span style={{ color: INK.faint }}>{String(i + 1).padStart(2, '0')}  </span>{l.slice(0, Math.min(show, 140))}</div>;
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
/** Stacked "SE / EN" lettermark, in the spirit of a minimal portfolio logo. */
export function Lettermark({ size = 22 }: { size?: number }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', width: size * 2.1, lineHeight: 0.95, fontFamily: FONT, fontWeight: 700, fontSize: size, letterSpacing: size * 0.08, color: INK.white, textAlign: 'center' }}>
      <span>S</span><span>I</span><span>E</span><span>M</span>
    </div>
  );
}

export function Hud({ incident, level, frame, now, events, curK, kind, brand = true }: { incident: Incident; level: Level; frame: number; now: number; events: TimelineEvent[]; curK: number; kind: Scene['kind']; brand?: boolean }) {
  const o = interpolate(frame, [0, 20], [0, 1], clamp);
  const n = events.length;
  const stepLabel = curK >= 0 && curK < n ? `${String(curK + 1).padStart(2, '0')} / ${String(n).padStart(2, '0')}` : '';
  return (
    <>
      {brand && (
        <div style={{ position: 'absolute', left: 64, top: 52, display: 'flex', alignItems: 'center', gap: 26, opacity: o }}>
          <Lettermark />
          <span style={{ ...LABEL, fontSize: 14, color: INK.dim }}>{level === 'layman' ? 'Plain English' : level === 'analyst' ? 'SOC Briefing' : 'IR Technical'}</span>
        </div>
      )}
      <div style={{ position: 'absolute', right: 64, top: 46, textAlign: 'right', opacity: o * (kind === 'actions' ? 0 : 1) }}>
        <div style={{ ...LABEL, fontSize: 14, color: INK.dim }}>{fmtDate(now)} · UTC</div>
        <div style={{ fontFamily: MONO, fontSize: 44, fontWeight: 400, letterSpacing: 1, color: INK.white, marginTop: 6 }}>{fmtClock(now)}</div>
        <div style={{ display: 'flex', gap: 5, justifyContent: 'flex-end', marginTop: 12 }}>
          {events.map((e, k) => (
            <span key={e.id} style={{ width: k === curK ? 22 : 8, height: 2, background: k <= curK ? (PHASE_COLOR[e.phase] === INK.red ? INK.red : INK.text) : INK.line2 }} />
          ))}
        </div>
      </div>
      {/* vertical step marker in the empty left margin (like a "scroll" indicator) */}
      {stepLabel && kind === 'event' && (
        <div style={{ position: 'absolute', left: 72, top: 400, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, opacity: o }}>
          <span style={{ ...LABEL, fontSize: 13, color: INK.dim, writingMode: 'vertical-rl', letterSpacing: '0.35em' }}>{stepLabel}</span>
          <span style={{ width: 1, height: 70, background: INK.faint }} />
        </div>
      )}
    </>
  );
}
