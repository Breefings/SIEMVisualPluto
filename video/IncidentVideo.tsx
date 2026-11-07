import type { ReactNode } from 'react';
import { AbsoluteFill, Easing, Html5Audio, interpolate, Sequence, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Incident, Level, Scene, TimelineEvent } from '../shared/types.ts';
import { LEVELS, PHASES } from '../shared/types.ts';
import { Icon } from '../shared/Icon.tsx';
import { fmtClock, fmtDate, LEVEL_ACCENT, PHASE_COLOR, PHASE_ICON, SEV_COLOR } from '../shared/theme.ts';
import { NetworkStage } from './NetworkStage.tsx';
import { FPS, LEAD_IN, timeline, type VideoProps } from './timing.ts';

const FONT = '"Inter", "Segoe UI", system-ui, -apple-system, sans-serif';
const MONO = '"JetBrains Mono", "Cascadia Code", Consolas, "SF Mono", monospace';
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

export function IncidentVideo(props: VideoProps) {
  const { incident, level, scenes, audioBase } = props;
  const frame = useCurrentFrame();
  const tl = timeline(scenes);
  const cur = tl.find((t) => frame >= t.from && frame < t.from + t.dur) ?? tl[tl.length - 1];
  const evById = new Map(incident.events.map((e) => [e.id, e]));
  const event = cur?.scene.eventId ? evById.get(cur.scene.eventId) ?? null : null;
  const f = frame - (cur?.from ?? 0);
  const storyEvents = scenes.map((s) => (s.eventId ? evById.get(s.eventId) : undefined)).filter(Boolean) as TimelineEvent[];

  const kind = cur?.scene.kind ?? 'intro';
  const stageOpacity = kind === 'event' ? interpolate(f, [0, 10], [0.85, 1], clamp) : kind === 'intro' ? interpolate(f, [0, cur.dur], [0.06, 0.18], clamp) : 0.07;
  const now = kind === 'intro' ? incident.startTs - 1 : kind === 'event' && event ? event.ts : incident.endTs;

  return (
    <AbsoluteFill style={{ background: '#050a14', fontFamily: FONT, color: '#e2e8f0', overflow: 'hidden' }}>
      <Backdrop frame={frame} accent={LEVEL_ACCENT[level]} />
      <NetworkStage incident={incident} level={level} event={event} f={f} abs={frame} now={now} opacity={stageOpacity} />
      <TopBar incident={incident} level={level} frame={frame} />

      {tl.map(({ scene, from, dur }, i) => (
        <Sequence key={scene.id} from={from} durationInFrames={dur} layout="none">
          {scene.kind === 'intro' && <IntroScene incident={incident} level={level} scene={scene} dur={dur} />}
          {scene.kind === 'event' && scene.eventId && evById.get(scene.eventId) && (
            <EventCard e={evById.get(scene.eventId)!} scene={scene} level={level} dur={dur} step={storyEvents.indexOf(evById.get(scene.eventId)!) + 1} total={storyEvents.length}
              prevTs={i > 1 && tl[i - 1].scene.eventId ? evById.get(tl[i - 1].scene.eventId!)?.ts ?? incident.startTs : incident.startTs} evidence={props.evidence?.[scene.eventId]} />
          )}
          {scene.kind === 'summary' && <SummaryScene incident={incident} level={level} scene={scene} events={storyEvents} dur={dur} />}
          {scene.kind === 'actions' && <ActionsScene level={level} scene={scene} dur={dur} />}
          {scene.audio && (
            <Sequence from={Math.round(LEAD_IN * FPS)} layout="none">
              <Html5Audio src={audioBase + scene.audio} />
            </Sequence>
          )}
        </Sequence>
      ))}

      {kind === 'event' && <TimelineBar incident={incident} events={storyEvents} current={event} f={f} />}
    </AbsoluteFill>
  );
}

// ---------------------------------------------------------------------------
function Backdrop({ frame, accent }: { frame: number; accent: string }) {
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ background: `radial-gradient(1200px 700px at 20% 15%, ${accent}14, transparent 60%), radial-gradient(900px 600px at 90% 90%, #ff3b5c12, transparent 60%)` }} />
      <AbsoluteFill
        style={{
          backgroundImage: 'linear-gradient(rgba(148,163,184,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.06) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          backgroundPosition: `${-frame * 0.4}px ${-frame * 0.25}px`,
          maskImage: 'radial-gradient(ellipse at center, black 40%, transparent 85%)',
        }}
      />
    </AbsoluteFill>
  );
}

function TopBar({ incident, level, frame }: { incident: Incident; level: Level; frame: number }) {
  const o = interpolate(frame, [0, 15], [0, 1], clamp);
  const L = LEVELS.find((l) => l.id === level)!;
  return (
    <div style={{ position: 'absolute', left: 60, right: 60, top: 40, height: 64, display: 'flex', alignItems: 'center', gap: 18, opacity: o }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 40, height: 40, borderRadius: 12, background: 'linear-gradient(135deg,#38bdf8,#a855f7)', display: 'grid', placeItems: 'center' }}>
          <Icon name="layers" size={22} color="#fff" />
        </div>
        <span style={{ fontWeight: 800, fontSize: 24, letterSpacing: 1 }}>Seen<span style={{ color: '#7dd3fc' }}>Visualizer</span></span>
      </div>
      <div style={{ width: 1, height: 30, background: '#334155', margin: '0 8px' }} />
      <span style={{ fontSize: 21, color: '#94a3b8', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{incident.title}</span>
      <span style={{ padding: '8px 16px', borderRadius: 999, border: `2px solid ${LEVEL_ACCENT[level]}`, color: LEVEL_ACCENT[level], fontWeight: 700, fontSize: 18, letterSpacing: 1 }}>
        {L.label.toUpperCase()} VIEW
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
function IntroScene({ incident, level, scene, dur }: { incident: Incident; level: Level; scene: Scene; dur: number }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const out = interpolate(f, [dur - 10, dur], [1, 0], clamp);
  const words = scene.heading.split(' ');
  const sev = SEV_COLOR[incident.severity];
  return (
    <AbsoluteFill style={{ justifyContent: 'center', padding: '0 160px', opacity: out }}>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 34, opacity: interpolate(f, [0, 12], [0, 1], clamp) }}>
        <span style={{ fontFamily: MONO, color: LEVEL_ACCENT[level], fontSize: 24, letterSpacing: 6 }}>INCIDENT REPORT · {fmtDate(incident.startTs).toUpperCase()}</span>
        <span style={{ padding: '6px 16px', borderRadius: 8, background: sev, color: '#0b0f17', fontWeight: 900, fontSize: 20, letterSpacing: 2, boxShadow: `0 0 ${20 + 14 * Math.sin(f / 5)}px ${sev}` }}>
          {incident.severity.toUpperCase()}
        </span>
      </div>
      <div style={{ fontSize: level === 'layman' ? 92 : 78, fontWeight: 850, lineHeight: 1.05, letterSpacing: -1.5, maxWidth: 1500 }}>
        {words.map((w, i) => {
          const s = spring({ frame: f - 6 - i * 3, fps, config: { damping: 14, stiffness: 120 } });
          return (
            <span key={i} style={{ display: 'inline-block', marginRight: 22, transform: `translateY(${(1 - s) * 50}px)`, opacity: s }}>{w}</span>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 22, marginTop: 56, flexWrap: 'wrap' }}>
        {(scene.bullets ?? []).map((b, i) => {
          const s = spring({ frame: f - 30 - i * 8, fps, config: { damping: 16 } });
          return (
            <div key={i} style={{ padding: '18px 26px', borderRadius: 16, background: 'rgba(15,23,42,0.75)', border: '1px solid #1e293b', fontSize: 28, fontWeight: 600, opacity: s, transform: `scale(${0.85 + s * 0.15})` }}>
              {b}
            </div>
          );
        })}
      </div>
      <div style={{ position: 'absolute', bottom: 70, left: 160, right: 160 }}>
        <Captions text={scene.narration} durationSec={scene.durationSec} size={level === 'layman' ? 30 : 26} />
      </div>
    </AbsoluteFill>
  );
}

// ---------------------------------------------------------------------------
function EventCard({ e, scene, level, dur, step, total, prevTs, evidence }: { e: TimelineEvent; scene: Scene; level: Level; dur: number; step: number; total: number; prevTs: number; evidence?: string[] }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame: f, fps, config: { damping: 18, stiffness: 110 } });
  const out = interpolate(f, [dur - 8, dur], [1, 0], clamp);
  const color = PHASE_COLOR[e.phase];
  const phase = PHASES.find((p) => p.id === e.phase)!;
  // clock "fast-forwards" from previous event time
  const clockTs = interpolate(f, [0, 22], [prevTs, e.ts], { ...clamp, easing: Easing.out(Easing.cubic) });
  const titleSize = level === 'layman' ? 50 : 44;
  return (
    <div style={{ position: 'absolute', left: 1150, top: 140, width: 710, bottom: 140, opacity: out * enter, transform: `translateX(${(1 - enter) * 80}px)`, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <span style={{ fontFamily: MONO, color: '#64748b', fontSize: 20, letterSpacing: 3 }}>STEP {step}/{total}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, padding: '8px 16px', borderRadius: 999, background: `${color}22`, border: `2px solid ${color}`, color, fontWeight: 750, fontSize: 20 }}>
          <Icon name={PHASE_ICON[e.phase]} size={20} color={color} /> {level === 'layman' ? phase.plain : phase.label}
        </span>
        {level !== 'layman' && (
          <span style={{ marginLeft: 'auto', color: SEV_COLOR[e.severity], fontWeight: 800, fontSize: 18, letterSpacing: 2 }}>{e.severity.toUpperCase()}</span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
        <span style={{ fontFamily: MONO, fontSize: 84, fontWeight: 700, letterSpacing: -2, color: '#fff', textShadow: `0 0 30px ${color}66` }}>{fmtClock(clockTs)}</span>
        <span style={{ color: '#64748b', fontSize: 22 }}>{level === 'layman' ? fmtDate(e.ts) : 'UTC'}</span>
      </div>
      <div style={{ fontSize: titleSize, fontWeight: 800, lineHeight: 1.08, letterSpacing: -0.5 }}>{scene.heading}</div>
      {level !== 'layman' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {e.technique && <Chip color={color} mono>{e.technique.id} · {e.technique.name}</Chip>}
          {e.fromHost ? <Chip>{e.fromHost} → {e.toHost}</Chip> : e.host && <Chip>{e.host}</Chip>}
          {e.user && <Chip>{e.user}</Chip>}
          {level === 'senior' && <Chip>conf {Math.round(e.confidence * 100)}%</Chip>}
        </div>
      )}
      <Captions text={scene.narration} durationSec={scene.durationSec} size={level === 'layman' ? 31 : level === 'analyst' ? 27 : scene.narration.length > 330 ? 21 : 23} grow />
      {level === 'senior' && (evidence?.length || e.iocs?.length) ? <Terminal lines={evidence?.length ? evidence : (e.iocs ?? []).map((i) => `IOC  ${i}`)} f={f} /> : null}
    </div>
  );
}

function Chip({ children, color = '#94a3b8', mono }: { children: ReactNode; color?: string; mono?: boolean }) {
  return (
    <span style={{ padding: '7px 14px', borderRadius: 10, background: 'rgba(15,23,42,0.85)', border: `1px solid ${color}55`, color, fontSize: 18, fontFamily: mono ? MONO : FONT, fontWeight: 600, maxWidth: 680, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
      {children}
    </span>
  );
}

/** Karaoke captions: words light up in step with the narration. */
function Captions({ text, durationSec, size, grow }: { text: string; durationSec?: number; size: number; grow?: boolean }) {
  const f = useCurrentFrame();
  const words = text.split(/\s+/);
  const total = words.reduce((a, w) => a + w.length + 1, 0);
  const secs = durationSec && durationSec > 0.5 ? durationSec : words.length / 2.6;
  const p = interpolate(f, [LEAD_IN * FPS, (LEAD_IN + secs) * FPS], [0, 1], clamp);
  let acc = 0;
  return (
    <div style={{ fontSize: size, lineHeight: 1.42, fontWeight: 500, ...(grow ? { flex: '1 1 auto', minHeight: 0, overflow: 'hidden' } : {}) }}>
      {words.map((w, i) => {
        acc += w.length + 1;
        const spoken = acc / total <= p + 0.015;
        return <span key={i} style={{ color: spoken ? '#f1f5f9' : '#475569', transition: 'none' }}>{w} </span>;
      })}
    </div>
  );
}

function Terminal({ lines, f }: { lines: string[]; f: number }) {
  const chars = Math.max(0, (f - 30) * 9);
  let used = 0;
  return (
    <div style={{ flex: '0 0 auto', borderRadius: 14, background: '#020617', border: '1px solid #1e3a2a', padding: '12px 18px', fontFamily: MONO, fontSize: 15, color: '#86efac', lineHeight: 1.5, overflow: 'hidden', height: 128 }}>
      <div style={{ color: '#4b5563', marginBottom: 6, fontSize: 13, letterSpacing: 2 }}>EVIDENCE</div>
      {lines.slice(0, 3).map((l, i) => {
        const show = Math.max(0, Math.min(l.length, chars - used));
        used += l.length;
        return <div key={i} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{'> '}{l.slice(0, Math.min(show, 150))}</div>;
      })}
    </div>
  );
}

function TimelineBar({ incident, events, current, f }: { incident: Incident; events: TimelineEvent[]; current: TimelineEvent | null; f: number }) {
  const x0 = 120, x1 = 1800, y = 990;
  const span = Math.max(1, incident.endTs - incident.startTs);
  const X = (ts: number) => x0 + ((ts - incident.startTs) / span) * (x1 - x0);
  const cx = current ? interpolate(f, [0, 22], [X(events[Math.max(0, events.indexOf(current) - 1)]?.ts ?? incident.startTs), X(current.ts)], { ...clamp, easing: Easing.out(Easing.cubic) }) : x0;
  return (
    <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      <line x1={x0} x2={x1} y1={y} y2={y} stroke="#1e293b" strokeWidth={6} strokeLinecap="round" />
      <line x1={x0} x2={cx} y1={y} y2={y} stroke="url(#tlg)" strokeWidth={6} strokeLinecap="round" />
      <defs>
        <linearGradient id="tlg" x1="0" x2="1"><stop offset="0" stopColor="#38bdf8" /><stop offset="1" stopColor="#ff3b5c" /></linearGradient>
      </defs>
      {events.map((e) => (
        <circle key={e.id} cx={X(e.ts)} cy={y} r={e === current ? 11 : 7} fill={X(e.ts) <= cx + 1 ? PHASE_COLOR[e.phase] : '#334155'} stroke="#050a14" strokeWidth={3} />
      ))}
      <text x={x0} y={y + 40} fill="#64748b" fontSize={18} fontFamily={MONO}>{fmtClock(incident.startTs)}</text>
      <text x={x1} y={y + 40} fill="#64748b" fontSize={18} fontFamily={MONO} textAnchor="end">{fmtClock(incident.endTs)}</text>
      <g transform={`translate(${cx} ${y - 30})`}>
        <path d="M-8 -6 L8 -6 L0 6 Z" fill="#fff" />
      </g>
    </svg>
  );
}

// ---------------------------------------------------------------------------
function SummaryScene({ incident, level, scene, events, dur }: { incident: Incident; level: Level; scene: Scene; events: TimelineEvent[]; dur: number }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const out = interpolate(f, [dur - 10, dur], [1, 0], clamp);
  const hours = (incident.endTs - incident.startTs) / 3600000;
  const hosts = incident.assets.filter((a) => a.compromisedAt != null).length;
  const exfil = incident.events.find((e) => e.phase === 'exfiltration');
  const stats = [
    { label: level === 'layman' ? 'from start to finish' : 'dwell time', value: hours >= 1 ? `${hours.toFixed(1)}h` : `${Math.round(hours * 60)}m`, color: '#7dd3fc' },
    { label: level === 'layman' ? 'computers affected' : 'hosts compromised', value: String(hosts), color: '#ff3b5c' },
    { label: level === 'layman' ? 'attack steps' : 'malicious events', value: String(incident.events.length), color: '#c084fc' },
    exfil ? { label: level === 'layman' ? 'data stolen' : 'exfiltrated', value: exfil.label.split(' ').slice(0, 2).join(' '), color: '#ff8a4c' } : { label: 'severity', value: incident.severity, color: SEV_COLOR[incident.severity] },
  ];
  return (
    <AbsoluteFill style={{ padding: '150px 120px 80px', opacity: out }}>
      <div style={{ fontSize: 64, fontWeight: 850, marginBottom: 44 }}>{scene.heading}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 26 }}>
        {stats.map((s, i) => {
          const k = spring({ frame: f - 8 - i * 6, fps, config: { damping: 15 } });
          return (
            <div key={i} style={{ borderRadius: 22, padding: '28px 30px', background: 'rgba(15,23,42,0.8)', border: `1px solid ${s.color}44`, transform: `translateY(${(1 - k) * 40}px)`, opacity: k }}>
              <div style={{ fontSize: 76, fontWeight: 850, color: s.color, fontFamily: MONO, letterSpacing: -2 }}>{s.value}</div>
              <div style={{ fontSize: 24, color: '#94a3b8', marginTop: 6 }}>{s.label}</div>
            </div>
          );
        })}
      </div>
      <div style={{ position: 'relative', marginTop: 70, height: 150 }}>
        <div style={{ position: 'absolute', left: 0, right: 0, top: 30, height: 4, background: '#1e293b', borderRadius: 2 }} />
        {events.map((e, i) => {
          const k = spring({ frame: f - 30 - i * 4, fps, config: { damping: 14 } });
          const x = events.length === 1 ? 50 : (i / (events.length - 1)) * 100;
          return (
            <div key={e.id} style={{ position: 'absolute', left: `${x}%`, top: 0, transform: `translateX(-50%) scale(${k})`, display: 'flex', flexDirection: 'column', alignItems: 'center', width: 160 }}>
              <div style={{ width: 64, height: 64, borderRadius: 32, background: '#0b1220', border: `3px solid ${PHASE_COLOR[e.phase]}`, display: 'grid', placeItems: 'center' }}>
                <Icon name={PHASE_ICON[e.phase]} size={30} color={PHASE_COLOR[e.phase]} />
              </div>
              <div style={{ fontFamily: MONO, fontSize: 17, color: '#94a3b8', marginTop: 10 }}>{fmtClock(e.ts)}</div>
              <div style={{ fontSize: 16, color: '#cbd5e1', textAlign: 'center', marginTop: 4, lineHeight: 1.2 }}>{level === 'layman' ? PHASES.find((p) => p.id === e.phase)?.plain : e.label}</div>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 'auto' }}>
        <Captions text={scene.narration} durationSec={scene.durationSec} size={level === 'layman' ? 30 : 26} />
      </div>
    </AbsoluteFill>
  );
}

function ActionsScene({ level, scene, dur }: { level: Level; scene: Scene; dur: number }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const out = interpolate(f, [dur - 12, dur], [1, 0], clamp);
  const items = (scene.bullets ?? []).slice(0, 7);
  const per = Math.max(12, Math.floor((dur - 40) / Math.max(1, items.length)));
  return (
    <AbsoluteFill style={{ padding: '150px 140px 80px', opacity: out }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginBottom: 40 }}>
        <Icon name="shield" size={56} color={LEVEL_ACCENT[level]} />
        <div style={{ fontSize: 62, fontWeight: 850 }}>{scene.heading}</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {items.map((b, i) => {
          const k = spring({ frame: f - 10 - i * 8, fps, config: { damping: 16 } });
          const done = f > 20 + i * per;
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 22, opacity: k, transform: `translateX(${(1 - k) * -60}px)`, fontSize: level === 'senior' ? 25 : 30, lineHeight: 1.3 }}>
              <div style={{ flex: '0 0 auto', width: 46, height: 46, borderRadius: 12, border: `3px solid ${done ? '#4ade80' : '#334155'}`, background: done ? '#4ade8022' : 'transparent', display: 'grid', placeItems: 'center' }}>
                {done && <Icon name="check" size={28} color="#4ade80" stroke={3} />}
              </div>
              <span style={{ color: done ? '#f1f5f9' : '#94a3b8' }}>{b}</span>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}
