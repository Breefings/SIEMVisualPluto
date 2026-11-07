import { Easing, interpolate, random } from 'remotion';
import type { Incident, Level, TimelineEvent } from '../shared/types.ts';
import { IconG } from '../shared/Icon.tsx';
import { ASSET_ICON, PHASE_COLOR, PHASE_ICON } from '../shared/theme.ts';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const W = 320, H = 220;
const CLEAN = '#38bdf8';
const PWNED = '#ff3b5c';

/** Small looping illustration of what the attacker did, drawn inside an event card. `f` = frames since the card appeared. */
export function Vignette({ e, f, incident, level }: { e: TimelineEvent; f: number; incident: Incident; level: Level }) {
  const c = PHASE_COLOR[e.phase];
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ overflow: 'visible', display: 'block' }}>
      <defs>
        <filter id={`vg-${e.id}`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="5" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <Scene e={e} f={f} c={c} glow={`url(#vg-${e.id})`} incident={incident} level={level} />
    </svg>
  );
}

function Scene({ e, f, c, glow, incident, level }: { e: TimelineEvent; f: number; c: string; glow: string; incident: Incident; level: Level }) {
  const name = (id?: string) => {
    if (!id) return '';
    const a = incident.assets.find((x) => x.id === id);
    const s = level === 'layman' && a ? a.friendly.split(' (')[0] : id;
    return s.length > 18 ? s.slice(0, 17) + '…' : s;
  };
  const kindOf = (id?: string) => incident.assets.find((x) => x.id === id)?.kind ?? 'workstation';

  switch (e.phase) {
    case 'initial-access': {
      const fly = interpolate(f, [0, 26], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
      const x = interpolate(fly, [0, 1], [380, 160]);
      const y = interpolate(fly, [0, 1], [-60, 120]);
      const rot = interpolate(fly, [0, 1], [-35, 0]);
      const flap = interpolate(f, [28, 38], [1, -1], clamp);
      const doc = interpolate(f, [36, 54], [0, 1], { ...clamp, easing: Easing.out(Easing.back(1.6)) });
      return (
        <g>
          {[0, 1, 2].map((i) => {
            const w = ((f - 50 + i * 18) % 54) / 54;
            return f > 50 ? <circle key={i} cx={160} cy={120} r={50 + w * 90} fill="none" stroke={c} strokeWidth={2} opacity={(1 - w) * 0.6} /> : null;
          })}
          <g transform={`translate(${x} ${y}) rotate(${rot})`}>
            {/* once open, the flap sits behind the letter */}
            {flap < 0 && (
              <g transform={`translate(0 -40) scale(1 ${flap})`}>
                <path d="M-62 0 L0 46 L62 0" fill="#2a2008" stroke={c} strokeWidth={4} strokeLinejoin="round" />
              </g>
            )}
            <g transform={`translate(0 ${-doc * 62})`} opacity={doc}>
              <rect x={-34} y={-44} width={68} height={84} rx={6} fill="#f8fafc" />
              <circle cx={0} cy={-6} r={16} fill={PWNED} />
              <path d="M0 -15v10M0 2v.5" stroke="#fff" strokeWidth={4} strokeLinecap="round" />
              <path d="M-22 22h44M-22 30h30" stroke="#94a3b8" strokeWidth={3} />
            </g>
            <rect x={-62} y={-40} width={124} height={84} rx={8} fill="#1d1606" stroke={c} strokeWidth={4} filter={glow} />
            {flap >= 0 && (
              <g transform={`translate(0 -40) scale(1 ${flap})`}>
                <path d="M-62 0 L0 46 L62 0" fill="#2a2008" stroke={c} strokeWidth={4} strokeLinejoin="round" />
              </g>
            )}
          </g>
        </g>
      );
    }
    case 'execution':
    case 'impact': {
      const shake = f > 26 && f < 44 ? Math.sin(f * 2.3) * 4 : 0;
      const lines = [150, 210, 120, 180, 90];
      const chars = Math.max(0, f - 6) * 14;
      let used = 0;
      const pop = interpolate(f, [30, 44], [0, 1], { ...clamp, easing: Easing.out(Easing.back(2.4)) });
      return (
        <g transform={`translate(${shake} 0)`}>
          <rect x={20} y={22} width={260} height={170} rx={12} fill="#030712" stroke={c} strokeWidth={3} filter={glow} />
          <rect x={20} y={22} width={260} height={28} rx={12} fill={`${c}33`} />
          {[0, 1, 2].map((i) => <circle key={i} cx={40 + i * 16} cy={36} r={5} fill={['#ef4444', '#fbbf24', '#4ade80'][i]} />)}
          {lines.map((w, i) => {
            const show = Math.max(0, Math.min(w, chars - used));
            used += w;
            return <rect key={i} x={40} y={66 + i * 24} width={show} height={10} rx={5} fill={i === 3 ? c : '#4ade80'} opacity={0.85} />;
          })}
          <g transform={`translate(272 182) scale(${pop}) rotate(${f * 4})`}>
            <circle r={36} fill="#2a0b0e" stroke={c} strokeWidth={4} filter={glow} />
            <IconG name={PHASE_ICON[e.phase]} x={0} y={0} size={38} color={c} stroke={2.2} />
          </g>
        </g>
      );
    }
    case 'command-and-control': {
      const a = { x: 64, y: 160 }, b = { x: 256, y: 64 };
      const show = interpolate(f, [0, 16], [0, 1], clamp);
      const pulses = [0, 1, 2, 3].map((i) => ((f + i * 18) % 72) / 72);
      return (
        <g opacity={show}>
          <path d={curve(a, b, 0.25)} stroke={c} strokeWidth={3} strokeDasharray="8 10" strokeDashoffset={-f * 2} fill="none" />
          {pulses.map((t, i) => {
            const p = i % 2 ? onCurve(b, a, t, -0.25) : onCurve(a, b, t, 0.25);
            return <circle key={i} cx={p.x} cy={p.y} r={8} fill={c} filter={glow} opacity={Math.sin(t * Math.PI)} />;
          })}
          <HostNode x={a.x} y={a.y} icon={ASSET_ICON[kindOf(e.host)]} color={PWNED} glow={glow} label={name(e.host)} />
          <HostNode x={b.x} y={b.y} icon="skull" color={c} glow={glow} label={level === 'layman' ? 'Attacker' : 'C2'} pulse={f} />
        </g>
      );
    }
    case 'discovery':
    case 'recon': {
      const cx = 160, cy = 110;
      const sweep = (f * 5) % 360;
      const blips = Array.from({ length: 6 }, (_, i) => ({ a: random(`a${i}${e.id}`) * 360, r: 30 + random(`r${i}${e.id}`) * 62 }));
      return (
        <g>
          {[34, 66, 98].map((r) => <circle key={r} cx={cx} cy={cy} r={r} fill="none" stroke={c} strokeOpacity={0.3} strokeWidth={2} />)}
          <path d={`M${cx - 98} ${cy}h196M${cx} ${cy - 98}v196`} stroke={c} strokeOpacity={0.18} />
          {Array.from({ length: 14 }, (_, i) => {
            const ang = ((sweep - i * 3) * Math.PI) / 180;
            return <line key={i} x1={cx} y1={cy} x2={cx + 98 * Math.cos(ang)} y2={cy + 98 * Math.sin(ang)} stroke={c} strokeWidth={3} opacity={(1 - i / 14) * 0.7} />;
          })}
          {blips.map((bl, i) => {
            const since = (((sweep - bl.a) % 360) + 360) % 360;
            const seen = f * 5 > bl.a;
            const glowAmt = seen ? Math.max(0.25, 1 - since / 300) : 0;
            const ang = (bl.a * Math.PI) / 180;
            return <circle key={i} cx={cx + bl.r * Math.cos(ang)} cy={cy + bl.r * Math.sin(ang)} r={6} fill={c} opacity={glowAmt} filter={glow} />;
          })}
          <circle cx={cx} cy={cy} r={8} fill={c} />
        </g>
      );
    }
    case 'credential-access': {
      const dots = Math.min(8, Math.floor(Math.max(0, f - 6) / 4));
      const keyT = interpolate(f, [40, 70], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
      return (
        <g>
          <rect x={40} y={130} width={240} height={52} rx={12} fill="#0b1220" stroke={c} strokeWidth={3} />
          {Array.from({ length: 8 }, (_, i) => <circle key={i} cx={70 + i * 26} cy={156} r={8} fill={i < dots ? c : '#1e293b'} />)}
          <g transform={`translate(${160 + keyT * 90} ${92 - keyT * 50}) rotate(${keyT * 30}) scale(${0.6 + Math.min(1, f / 30) * 0.6})`} filter={glow}>
            <IconG name="key" x={0} y={0} size={64} color={c} stroke={2.4} />
          </g>
          {keyT > 0 && [0, 1, 2, 3].map((i) => {
            const a = (i / 4) * Math.PI * 2 + f / 10;
            return <circle key={i} cx={250 + Math.cos(a) * 30 * keyT} cy={42 + Math.sin(a) * 30 * keyT} r={3} fill="#fff" opacity={1 - keyT * 0.6} />;
          })}
        </g>
      );
    }
    case 'privilege-escalation': {
      // a dot hops up a staircase, one step every 10 frames
      const t = interpolate(f, [6, 36], [0, 3], clamp);
      const s = Math.floor(t), frac = t - s;
      const px = 70 + t * 60;
      const py = 142 - s * 40 - frac * 40 - Math.sin(frac * Math.PI) * 24;
      const crown = interpolate(f, [40, 54], [0, 1], { ...clamp, easing: Easing.out(Easing.back(2)) });
      return (
        <g>
          {[0, 1, 2, 3].map((i) => <rect key={i} x={40 + i * 60} y={196 - (i + 1) * 40} width={60} height={(i + 1) * 40} fill={`${c}${i <= Math.round(t) ? '44' : '18'}`} stroke={c} strokeOpacity={0.6} strokeWidth={2} />)}
          <circle cx={px} cy={py} r={14} fill={c} filter={glow} />
          <g transform={`translate(250 -12) scale(${crown})`}><IconG name="crown" x={0} y={0} size={48} color="#fde047" stroke={2.4} /></g>
        </g>
      );
    }
    case 'lateral-movement': {
      const a = { x: 62, y: 120 }, b = { x: 258, y: 120 };
      const draw = interpolate(f, [8, 40], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
      const p = onCurve(a, b, draw, -0.35);
      const len = 260;
      const flip = interpolate(f, [40, 50], [0, 1], clamp);
      const ring = interpolate(f, [40, 66], [0, 1], clamp);
      return (
        <g>
          <path d={curve(a, b, -0.35)} stroke={c} strokeWidth={5} fill="none" strokeDasharray={len} strokeDashoffset={len * (1 - draw)} strokeLinecap="round" filter={glow} />
          {ring > 0 && ring < 1 && <circle cx={b.x} cy={b.y} r={40 + ring * 70} fill="none" stroke={c} strokeWidth={3} opacity={1 - ring} />}
          <HostNode x={a.x} y={a.y} icon={ASSET_ICON[kindOf(e.fromHost)]} color={PWNED} glow={glow} label={name(e.fromHost)} />
          <HostNode x={b.x} y={b.y} icon={ASSET_ICON[kindOf(e.toHost)]} color={flip >= 0.5 ? PWNED : CLEAN} glow={glow} label={name(e.toHost)} />
          {draw > 0 && draw < 1 && (
            <g transform={`translate(${p.x} ${p.y})`}>
              <circle r={18} fill="#0b1220" stroke={c} strokeWidth={3} />
              <IconG name="key" x={0} y={0} size={18} color={c} />
            </g>
          )}
        </g>
      );
    }
    case 'persistence': {
      const drop = interpolate(f, [14, 26], [-34, 0], { ...clamp, easing: Easing.out(Easing.bounce) });
      const click = interpolate(f, [26, 50], [0, 1], clamp);
      const appear = interpolate(f, [0, 12], [0, 1], { ...clamp, easing: Easing.out(Easing.back(2)) });
      return (
        <g transform={`translate(160 120) scale(${appear})`}>
          {click > 0 && click < 1 && <circle r={60 + click * 80} fill="none" stroke={c} strokeWidth={3} opacity={1 - click} />}
          <path d={`M-34 ${-10 + drop} v-26 a34 34 0 0 1 68 0 v26`} fill="none" stroke={c} strokeWidth={12} strokeLinecap="round" />
          <rect x={-58} y={-12} width={116} height={92} rx={14} fill="#1c1030" stroke={c} strokeWidth={5} filter={glow} />
          <circle cx={0} cy={26} r={10} fill={c} />
          <rect x={-4} y={30} width={8} height={22} rx={3} fill={c} />
        </g>
      );
    }
    case 'collection': {
      const lid = f > 46 ? Math.abs(Math.sin((f - 46) / 3)) * Math.max(0, 1 - (f - 46) / 20) * 14 : 0;
      return (
        <g>
          {Array.from({ length: 6 }, (_, i) => {
            const t = interpolate(f, [4 + i * 6, 22 + i * 6], [0, 1], { ...clamp, easing: Easing.in(Easing.quad) });
            const sx = 30 + random(`cx${i}`) * 260, sy = 10 + random(`cy${i}`) * 50;
            const x = interpolate(t, [0, 1], [sx, 160]), y = interpolate(t, [0, 1], [sy, 150]);
            return t < 1 ? (
              <g key={i} transform={`translate(${x} ${y}) rotate(${(1 - t) * (random(`cr${i}`) * 60 - 30)}) scale(${1 - t * 0.4})`}>
                <rect x={-14} y={-18} width={28} height={36} rx={4} fill="#06201d" stroke={c} strokeWidth={2.5} />
                <path d="M-7 -6h14M-7 1h14M-7 8h9" stroke={c} strokeWidth={2} />
              </g>
            ) : null;
          })}
          <rect x={100} y={150} width={120} height={60} rx={8} fill="#06201d" stroke={c} strokeWidth={4} filter={glow} />
          <rect x={94} y={136 - lid} width={132} height={18} rx={5} fill="#0b2e2a" stroke={c} strokeWidth={4} />
          <path d="M148 178h24" stroke={c} strokeWidth={4} strokeLinecap="round" />
        </g>
      );
    }
    case 'exfiltration': {
      const a = { x: 60, y: 160 }, b = { x: 262, y: 70 };
      const m = /([\d.]+)\s*(GB|MB|KB|TB)/i.exec(`${e.label} ${e.narratives.senior.text}`);
      const total = m ? parseFloat(m[1]) : 0;
      const prog = interpolate(f, [6, 90], [0, 1], clamp);
      return (
        <g>
          <path d={curve(a, b, 0.2)} stroke={c} strokeOpacity={0.35} strokeWidth={12} fill="none" strokeLinecap="round" />
          {Array.from({ length: 10 }, (_, i) => {
            const t = ((f - i * 7) % 56) / 56;
            if (f - i * 7 < 0) return null;
            const p = onCurve(a, b, t, 0.2 + (random(i) - 0.5) * 0.15);
            return (
              <g key={i} transform={`translate(${p.x} ${p.y}) rotate(${random(i + 9) * 30 - 15})`} opacity={Math.sin(t * Math.PI)}>
                <rect x={-10} y={-13} width={20} height={26} rx={3} fill="#1f1308" stroke={c} strokeWidth={2} />
              </g>
            );
          })}
          <HostNode x={a.x} y={a.y} icon={ASSET_ICON[kindOf(e.host)]} color={PWNED} glow={glow} label={name(e.host)} />
          <HostNode x={b.x} y={b.y} icon="cloud" color={c} glow={glow} label="" />
          {total > 0 && (
            <text x={262} y={140} textAnchor="middle" fill={c} fontSize={24} fontWeight={850} fontFamily="Consolas, monospace">
              {(total * prog).toFixed(total >= 10 ? 0 : 1)} {m![2].toUpperCase()}
            </text>
          )}
        </g>
      );
    }
    case 'defense-evasion': {
      const rows = 6;
      const ex = interpolate(f, [10, 70], [-40, 340 * rows], clamp);
      return (
        <g>
          <rect x={20} y={14} width={280} height={192} rx={12} fill="#030712" stroke="#334155" strokeWidth={2} />
          {Array.from({ length: rows }, (_, i) => {
            const local = ex - i * 340;
            const w = 60 + random(`dw${i}`) * 170;
            const cut = Math.max(0, Math.min(w, local - 40));
            return (
              <g key={i}>
                <rect x={40 + cut} y={34 + i * 28} width={Math.max(0, w - cut)} height={10} rx={5} fill="#64748b" />
                {local > -40 && local < 300 && <g transform={`translate(${40 + Math.min(local, w + 20)} ${36 + i * 28}) rotate(-20)`}><IconG name="eraser" x={0} y={-6} size={36} color={c} stroke={2.4} /></g>}
              </g>
            );
          })}
        </g>
      );
    }
    default:
      return null;
  }
}

function HostNode({ x, y, icon, color, glow, label, pulse }: { x: number; y: number; icon: Parameters<typeof IconG>[0]['name']; color: string; glow: string; label: string; pulse?: number }) {
  const r = 34 + (pulse != null ? Math.sin(pulse / 5) * 2 : 0);
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r={r} fill="#0a1220" stroke={color} strokeWidth={3.5} filter={glow} />
      <IconG name={icon} x={0} y={0} size={32} color={color} stroke={2} />
      {label && <text y={r + 24} textAnchor="middle" fill="#cbd5e1" fontSize={16} fontWeight={650}>{label}</text>}
    </g>
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
