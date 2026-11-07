import { Easing, interpolate, interpolateColors, random } from 'remotion';
import type { Incident, Level, TimelineEvent } from '../shared/types.ts';
import { IconG } from '../shared/Icon.tsx';
import { ASSET_ICON, PHASE_COLOR, PHASE_ICON } from '../shared/theme.ts';
import { externalFor, layoutNodes, STAGE, type NodePos } from './layout.ts';

const CLEAN = '#38bdf8';
const PWNED = '#ff3b5c';
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

interface Props {
  incident: Incident;
  level: Level;
  /** Event in focus (null on intro/summary). */
  event: TimelineEvent | null;
  /** Frame inside the current scene. */
  f: number;
  /** Absolute frame (for ambient animation). */
  abs: number;
  /** "now" in incident time, for node compromise state. */
  now: number;
  opacity: number;
}

export function NetworkStage({ incident, level, event, f, abs, now, opacity }: Props) {
  const nodes = layoutNodes(incident);
  const N = (id?: string) => (id ? nodes.get(id) : undefined);
  const past = incident.events.filter((e) => e.ts < (event?.ts ?? now) && e !== event);

  // camera: drift toward the focused host
  const focus = N(event?.toHost ?? event?.host);
  const zoom = event ? interpolate(f, [0, 40], [1, 1.05], { ...clamp, easing: Easing.out(Easing.cubic) }) : 1;
  // scale about the stage centre, then pan so the focused node drifts slightly toward the centre
  const panX = focus ? (focus.x - 580) * (zoom - 1) * 0.8 : 0;
  const panY = focus ? (focus.y - 530) * (zoom - 1) * 0.8 : 0;

  // when does the focused node flip to "compromised" during this scene?
  const flipAt = event?.phase === 'lateral-movement' ? 48 : 22;

  const nodeColor = (n: NodePos) => {
    if (n.asset.kind === 'external') return PWNED;
    const c = n.asset.compromisedAt;
    if (c == null) return CLEAN;
    if (event && c === event.ts && (n.asset.id === event.host || n.asset.id === event.toHost)) {
      return interpolateColors(f, [flipAt, flipAt + 12], [CLEAN, PWNED]);
    }
    return c <= (event?.ts ?? now) ? PWNED : CLEAN;
  };

  return (
    <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0, opacity }}>
      <defs>
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="8" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <radialGradient id="nodeFill"><stop offset="0%" stopColor="#0f1a2e" /><stop offset="100%" stopColor="#0a1220" /></radialGradient>
      </defs>
      <g transform={`translate(${-panX} ${-panY}) translate(580 530) scale(${zoom}) translate(-580 -530)`}>
        {/* zones */}
        <rect x={STAGE.left - 90} y={STAGE.top - 130} width={STAGE.boundaryX - STAGE.left + 60} height={STAGE.bottom - STAGE.top + 250} rx={28} fill="rgba(56,189,248,0.035)" stroke="rgba(56,189,248,0.18)" strokeDasharray="4 8" />
        <text x={STAGE.left - 66} y={STAGE.top - 96} fill="rgba(148,197,255,0.6)" fontSize={17} letterSpacing={4} fontWeight={600}>
          {level === 'layman' ? 'INSIDE THE COMPANY' : 'INTERNAL NETWORK'}
        </text>
        <line x1={STAGE.boundaryX + 20} x2={STAGE.boundaryX + 20} y1={STAGE.top - 130} y2={STAGE.bottom + 120} stroke="rgba(255,59,92,0.35)" strokeDasharray="10 10" strokeWidth={2} />
        <text x={STAGE.boundaryX + 40} y={STAGE.top - 96} fill="rgba(255,120,140,0.7)" fontSize={17} letterSpacing={4} fontWeight={600}>INTERNET</text>

        {/* history: past lateral moves + C2 channels */}
        {past.map((e) => {
          if (e.phase === 'lateral-movement') {
            const a = N(e.fromHost), b = N(e.toHost);
            return a && b ? <path key={e.id} d={curve(a, b)} stroke={PWNED} strokeOpacity={0.4} strokeWidth={3} fill="none" /> : null;
          }
          if (e.phase === 'command-and-control') {
            const a = N(e.host), b = N(externalFor(e, incident));
            return a && b ? <path key={e.id} d={curve(a, b, 0.12)} stroke={PHASE_COLOR['command-and-control']} strokeOpacity={0.28} strokeWidth={2} strokeDasharray="6 10" strokeDashoffset={-abs * 1.2} fill="none" /> : null;
          }
          return null;
        })}

        {event && <Effect e={event} incident={incident} nodes={nodes} f={f} />}

        {/* nodes */}
        {[...nodes.values()].map((n) => {
          const color = nodeColor(n);
          const isFocus = event && (n.asset.id === event.host || n.asset.id === event.toHost || n.asset.id === event.fromHost);
          const appear = interpolate(abs, [0, 18], [0, 1], clamp);
          const pulse = color === PWNED ? 0.5 + 0.5 * Math.sin(abs / 7 + n.x) : 0;
          const r = 54;
          const persisted = incident.events.some((e) => e.phase === 'persistence' && e.host === n.asset.id && e.ts <= (event?.ts ?? now) && !(event && e === event && f < 30));
          return (
            <g key={n.asset.id} opacity={appear} transform={`translate(${n.x} ${n.y})`}>
              {color === PWNED && <circle r={r + 14 + pulse * 10} fill="none" stroke={PWNED} strokeOpacity={0.18 + pulse * 0.2} strokeWidth={2} />}
              {isFocus && <circle r={r + 26} fill="none" stroke="#fff" strokeOpacity={0.5} strokeWidth={2} strokeDasharray="6 12" transform={`rotate(${abs * 1.5})`} />}
              <circle r={r} fill="url(#nodeFill)" stroke={color} strokeWidth={3.5} filter="url(#glow)" />
              <IconG name={ASSET_ICON[n.asset.kind]} x={0} y={0} size={46} color={color} stroke={1.8} />
              {persisted && (
                <g transform="translate(40 -40)">
                  <circle r={20} fill="#1c1030" stroke={PHASE_COLOR.persistence} strokeWidth={2.5} />
                  <IconG name="lock" x={0} y={0} size={20} color={PHASE_COLOR.persistence} />
                </g>
              )}
              <text y={r + 38} textAnchor="middle" fill="#e2e8f0" fontSize={level === 'layman' ? 24 : 22} fontWeight={650}>
                {level === 'layman' ? n.asset.friendly.split(' (')[0] : n.asset.id}
              </text>
              {level !== 'layman' ? (
                <text y={r + 64} textAnchor="middle" fill="#7f8ea3" fontSize={17}>
                  {n.asset.kind === 'external' ? n.asset.friendly.match(/\((.+)\)/)?.[1] ?? 'attacker infrastructure' : n.asset.friendly}{n.asset.kind !== 'external' && n.asset.ip && n.asset.ip !== n.asset.id ? ` · ${n.asset.ip}` : ''}
                </text>
              ) : n.asset.friendly.includes(' (') ? (
                <text y={r + 64} textAnchor="middle" fill="#7f8ea3" fontSize={17}>{n.asset.friendly.match(/\((.+)\)/)?.[1]}</text>
              ) : null}
            </g>
          );
        })}
      </g>
    </svg>
  );
}

function curve(a: { x: number; y: number }, b: { x: number; y: number }, bend = 0.2) {
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const dx = b.x - a.x, dy = b.y - a.y;
  return `M${a.x} ${a.y} Q${mx - dy * bend} ${my + dx * bend} ${b.x} ${b.y}`;
}
function onCurve(a: { x: number; y: number }, b: { x: number; y: number }, t: number, bend = 0.2) {
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const dx = b.x - a.x, dy = b.y - a.y;
  const qx = mx - dy * bend, qy = my + dx * bend;
  const u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * qx + t * t * b.x, y: u * u * a.y + 2 * u * t * qy + t * t * b.y };
}

/** Phase-specific motion graphics for the event in focus. */
function Effect({ e, incident, nodes, f }: { e: TimelineEvent; incident: Incident; nodes: Map<string, NodePos>; f: number }) {
  const color = PHASE_COLOR[e.phase];
  const host = nodes.get(e.toHost ?? e.host ?? '');
  const ext = nodes.get(externalFor(e, incident) ?? '');

  switch (e.phase) {
    case 'lateral-movement': {
      const a = nodes.get(e.fromHost ?? ''), b = nodes.get(e.toHost ?? '');
      if (!a || !b) return null;
      const draw = interpolate(f, [6, 46], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
      const len = Math.hypot(b.x - a.x, b.y - a.y) * 1.2;
      const p = onCurve(a, b, draw);
      const ring = interpolate(f, [46, 80], [0, 1], clamp);
      return (
        <g>
          <path d={curve(a, b)} stroke={color} strokeWidth={6} fill="none" strokeDasharray={len} strokeDashoffset={len * (1 - draw)} filter="url(#glow)" strokeLinecap="round" />
          {draw < 1 && (
            <g transform={`translate(${p.x} ${p.y})`}>
              <circle r={22} fill={color} opacity={0.25} />
              <circle r={14} fill="#0b1220" stroke={color} strokeWidth={3} />
              <g transform="translate(0 0)"><IconG name="key" x={0} y={0} size={16} color={color} /></g>
            </g>
          )}
          {ring > 0 && ring < 1 && <circle cx={b.x} cy={b.y} r={60 + ring * 140} fill="none" stroke={color} strokeWidth={4} opacity={1 - ring} />}
        </g>
      );
    }
    case 'command-and-control': {
      if (!host || !ext) return null;
      const show = interpolate(f, [0, 20], [0, 1], clamp);
      const pulses = [0, 1, 2, 3].map((i) => ((f + i * 22) % 88) / 88);
      return (
        <g opacity={show}>
          <path d={curve(host, ext, 0.12)} stroke={color} strokeWidth={3} strokeDasharray="8 10" strokeDashoffset={-f * 2} fill="none" />
          {pulses.map((t, i) => {
            const p = onCurve(i % 2 ? ext : host, i % 2 ? host : ext, t, i % 2 ? -0.12 : 0.12);
            return <circle key={i} cx={p.x} cy={p.y} r={9} fill={color} filter="url(#glow)" opacity={Math.sin(t * Math.PI)} />;
          })}
        </g>
      );
    }
    case 'exfiltration': {
      if (!host || !ext) return null;
      const items = Array.from({ length: 14 }, (_, i) => i);
      return (
        <g>
          <path d={curve(host, ext, 0.1)} stroke={color} strokeOpacity={0.5} strokeWidth={10} fill="none" />
          {items.map((i) => {
            const t = ((f - i * 6) % 70) / 70;
            if (f - i * 6 < 0) return null;
            const p = onCurve(host, ext, t, 0.1 + (random(i) - 0.5) * 0.12);
            return (
              <g key={i} transform={`translate(${p.x} ${p.y}) rotate(${random(i + 9) * 30 - 15})`} opacity={Math.sin(t * Math.PI)}>
                <rect x={-12} y={-15} width={24} height={30} rx={3} fill="#1f1308" stroke={color} strokeWidth={2} />
                <path d="M-6 -6h12M-6 0h12M-6 6h8" stroke={color} strokeWidth={1.6} />
              </g>
            );
          })}
        </g>
      );
    }
    case 'initial-access': {
      if (!host) return null;
      const from = ext ?? { x: STAGE.extX, y: 120 };
      const t = interpolate(f, [4, 40], [0, 1], { ...clamp, easing: Easing.inOut(Easing.quad) });
      const p = onCurve(from, host, t, -0.25);
      const hit = interpolate(f, [40, 70], [0, 1], clamp);
      return (
        <g>
          <path d={curve(from, host, -0.25)} stroke={color} strokeOpacity={0.35} strokeWidth={2} strokeDasharray="4 8" fill="none" />
          {t < 1 ? (
            <g transform={`translate(${p.x} ${p.y}) rotate(${(1 - t) * -20})`}>
              <rect x={-30} y={-21} width={60} height={42} rx={6} fill="#1d1606" stroke={color} strokeWidth={3} filter="url(#glow)" />
              <path d="M-30 -18 L0 4 L30 -18" stroke={color} strokeWidth={3} fill="none" />
            </g>
          ) : (
            <circle cx={host.x} cy={host.y} r={60 + hit * 110} fill="none" stroke={color} strokeWidth={4} opacity={1 - hit} />
          )}
        </g>
      );
    }
    case 'execution':
    case 'impact': {
      if (!host) return null;
      const pop = interpolate(f, [10, 26], [0, 1], { ...clamp, easing: Easing.out(Easing.back(2.2)) });
      const waves = [0, 1, 2].map((i) => ((f + i * 20) % 60) / 60);
      return (
        <g>
          {waves.map((w, i) => <circle key={i} cx={host.x} cy={host.y} r={60 + w * 120} fill="none" stroke={color} strokeWidth={3} opacity={(1 - w) * 0.7} />)}
          <g transform={`translate(${host.x - 44} ${host.y - 48}) scale(${pop})`}>
            <circle r={26} fill="#2a0b0e" stroke={color} strokeWidth={3} filter="url(#glow)" />
            <IconG name={PHASE_ICON[e.phase]} x={0} y={0} size={28} color={color} />
          </g>
        </g>
      );
    }
    case 'persistence':
    case 'privilege-escalation':
    case 'credential-access':
    case 'collection': {
      if (!host) return null;
      const pop = interpolate(f, [8, 30], [0, 1], { ...clamp, easing: Easing.out(Easing.back(1.8)) });
      const rise = e.phase === 'credential-access' ? interpolate(f, [30, 90], [0, -60], clamp) : 0;
      return (
        <g>
          <circle cx={host.x} cy={host.y} r={64 + pop * 30} fill={color} opacity={0.08 * pop} />
          <g transform={`translate(${host.x} ${host.y - 112 + rise}) scale(${pop})`}>
            <rect x={-96} y={-30} width={192} height={60} rx={30} fill="#0b1220" stroke={color} strokeWidth={3} filter="url(#glow)" />
            <IconG name={PHASE_ICON[e.phase]} x={-62} y={0} size={28} color={color} />
            <text x={-38} y={8} fill={color} fontSize={20} fontWeight={800} textAnchor="start" letterSpacing={1}>
              {e.phase === 'persistence' ? 'BACKDOOR' : e.phase === 'credential-access' ? 'CREDS' : e.phase === 'collection' ? 'STAGED' : 'ROOT'}
            </text>
          </g>
        </g>
      );
    }
    case 'discovery':
    case 'recon': {
      if (!host) return null;
      const sweep = (f * 4) % 360;
      return (
        <g>
          {[0, 1, 2].map((i) => {
            const w = ((f + i * 25) % 75) / 75;
            return <circle key={i} cx={host.x} cy={host.y} r={60 + w * 360} fill="none" stroke={color} strokeWidth={2} opacity={(1 - w) * 0.6} />;
          })}
          <path d={`M${host.x} ${host.y} L${host.x + 330 * Math.cos((sweep * Math.PI) / 180)} ${host.y + 330 * Math.sin((sweep * Math.PI) / 180)}`} stroke={color} strokeWidth={3} opacity={0.6} />
        </g>
      );
    }
    case 'defense-evasion': {
      if (!host) return null;
      const s = interpolate(f, [10, 22], [2.2, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
      const o = interpolate(f, [10, 16], [0, 1], clamp);
      return (
        <g transform={`translate(${host.x} ${host.y - 10}) rotate(-12) scale(${s})`} opacity={o}>
          <rect x={-120} y={-30} width={240} height={60} rx={6} fill="rgba(15,23,42,0.85)" stroke={color} strokeWidth={4} />
          <text y={11} textAnchor="middle" fill={color} fontSize={28} fontWeight={900} letterSpacing={3}>LOGS WIPED</text>
        </g>
      );
    }
    default:
      return null;
  }
}
