import { AbsoluteFill, Easing, Html5Audio, interpolate, Sequence, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Incident, Level, Scene, TimelineEvent } from '../shared/types.ts';
import { Icon } from '../shared/Icon.tsx';
import { fmtDate, LEVEL_ACCENT, SEV_COLOR } from '../shared/theme.ts';
import { Backdrop, buildWorld, clamp, EventCard, FLY, FONT, Hud, MONO, smooth, TimelineAxis, type Cam, type World } from './stage.tsx';
import { FPS, LEAD_IN, timeline, type VideoProps } from './timing.ts';

type Tl = ReturnType<typeof timeline>;

/** Where the camera rests during scene i, `lf` frames in. */
function restingCam(i: number, lf: number, tl: Tl, w: World): Cam {
  const { scene, dur } = tl[i];
  if (scene.kind === 'intro') return { cx: w.mid, cy: 0, s: w.overview * interpolate(lf, [0, dur], [1.5, 1], { ...clamp, easing: Easing.out(Easing.quad) }), oy: 150 };
  if (scene.kind === 'event') {
    const k = w.events.findIndex((e) => e.id === scene.eventId);
    const q = interpolate(lf, [FLY, dur], [0, 1], clamp);
    const side = k % 2 === 0 ? -1 : 1;
    // slow push-in while the narration plays, so the frame never sits still
    return { cx: (w.xs[k] ?? 0) + 40 * q, cy: side * w.camY, s: 1 + 0.07 * q, oy: 0 };
  }
  if (scene.kind === 'summary') return { cx: w.mid, cy: 0, s: w.overview * interpolate(lf, [0, dur], [1, 1.06], clamp), oy: 170 };
  return { cx: w.mid, cy: 0, s: w.overview * 0.92, oy: 280 };
}

function cameraAt(frame: number, i: number, tl: Tl, w: World): Cam {
  const lf = frame - tl[i].from;
  const to = restingCam(i, lf, tl, w);
  if (i === 0) return to;
  const T = Math.min(FLY + 8, Math.round(tl[i].dur * 0.45));
  if (lf >= T) return to;
  const prev = tl[i - 1];
  const from = restingCam(i - 1, prev.dur, tl, w);
  const e = Easing.inOut(Easing.cubic)(lf / T);
  const hop = prev.scene.kind === 'event' && tl[i].scene.kind === 'event';
  const dip = hop ? 0.42 : 0; // zoom out mid-flight, then back in on the next event
  const s = Math.exp(Math.log(from.s) + (Math.log(to.s) - Math.log(from.s)) * e) * (1 - dip * Math.sin(Math.PI * e));
  return { cx: from.cx + (to.cx - from.cx) * e, cy: from.cy + (to.cy - from.cy) * e, oy: from.oy + (to.oy - from.oy) * e, s };
}

// ---------------------------------------------------------------------------
export function IncidentVideo(props: VideoProps) {
  const { incident, level, scenes, audioBase } = props;
  const frame = useCurrentFrame();
  const tl = timeline(scenes);
  let idx = tl.findIndex((t) => frame >= t.from && frame < t.from + t.dur);
  if (idx < 0) idx = tl.length - 1;
  const cur = tl[idx];
  const lf = frame - cur.from;
  const evById = new Map(incident.events.map((e) => [e.id, e]));
  const events = scenes.map((s) => (s.eventId ? evById.get(s.eventId) : undefined)).filter(Boolean) as TimelineEvent[];
  const w = buildWorld(incident, events, level);
  const cam = cameraAt(frame, idx, tl, w);
  const proj = (x: number, y: number) => ({ X: (x - cam.cx) * cam.s + 960, Y: (y - cam.cy) * cam.s + 540 + cam.oy });

  // story progress: which event we're on, where the playhead is, what time it is
  const kind = cur.scene.kind;
  const curK = kind === 'event' ? events.findIndex((e) => e.id === cur.scene.eventId) : kind === 'intro' ? -1 : events.length;
  const flyT = Math.min(FLY + 8, Math.round(cur.dur * 0.45));
  const fe = Easing.inOut(Easing.cubic)(Math.min(1, lf / flyT));
  let playX = w.xStart, now = incident.startTs;
  if (kind === 'event' && curK >= 0) {
    const px = curK > 0 ? w.xs[curK - 1] : w.xStart;
    const pt = curK > 0 ? events[curK - 1].ts : incident.startTs;
    playX = px + (w.xs[curK] - px) * fe;
    now = pt + (events[curK].ts - pt) * fe;
  } else if (kind !== 'intro') {
    const px = events.length ? w.xs[events.length - 1] : w.xStart;
    playX = px + (w.xEnd - px) * fe;
    now = (events.length ? events[events.length - 1].ts : incident.startTs) + (incident.endTs - (events.length ? events[events.length - 1].ts : incident.startTs)) * fe;
  }
  // when each event's card appeared (frame), for its own animation clock
  const appearAt = new Map<string, number>();
  tl.forEach((t) => {
    if (t.scene.kind === 'event' && t.scene.eventId) appearAt.set(t.scene.eventId, t.from + Math.round(Math.min(FLY + 8, t.dur * 0.45) * 0.6));
  });
  const introLine = tl[0]?.scene.kind === 'intro' && idx === 0 ? lf : 999;

  return (
    <AbsoluteFill style={{ background: '#040812', fontFamily: FONT, color: '#e2e8f0', overflow: 'hidden' }}>
      <Backdrop cam={cam} frame={frame} accent={LEVEL_ACCENT[level]} now={now} show={kind === 'event'} />

      {/* world layer: the event cards, moved by the camera */}
      <div style={{ position: 'absolute', left: 0, top: 0, transformOrigin: '0 0', transform: `translate(${960}px, ${540 + cam.oy}px) scale(${cam.s}) translate(${-cam.cx}px, ${-cam.cy}px)`, opacity: smooth(cam.s, 0.36, 0.5) }}>
        {events.map((e, k) => {
          const visible = k <= curK;
          if (!visible) return null;
                    const cf = frame - (appearAt.get(e.id) ?? 0);
          if (cf < 0) return null;
          return <EventCard key={e.id} e={e} heading={scenes.find((s) => s.eventId === e.id)!.heading} k={k} x={w.xs[k]} cf={cf} active={k === curK} level={level} incident={incident} evidence={props.evidence?.[e.id]} />;
        })}
      </div>

      <TimelineAxis w={w} cam={cam} proj={proj} incident={incident} level={level} frame={frame} curK={curK} playX={playX} introLine={introLine} appearAt={appearAt} />

      <Hud incident={incident} level={level} frame={frame} now={now} events={events} curK={curK} kind={kind} />

      {tl.map(({ scene, from, dur }) => (
        <Sequence key={scene.id} from={from} durationInFrames={dur} layout="none">
          {scene.kind === 'intro' && <IntroOverlay incident={incident} level={level} scene={scene} dur={dur} />}
          {scene.kind === 'summary' && <SummaryOverlay incident={incident} level={level} scene={scene} dur={dur} />}
          {scene.kind === 'actions' && <ActionsOverlay level={level} scene={scene} dur={dur} />}
          <Subtitles text={scene.narration} durationSec={scene.durationSec} dur={dur} size={level === 'layman' ? 36 : 32} />
          {scene.audio && (
            <Sequence from={Math.round(LEAD_IN * FPS)} layout="none">
              <Html5Audio src={audioBase + scene.audio} />
            </Sequence>
          )}
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}

// ---------------------------------------------------------------------------
function IntroOverlay({ incident, level, scene, dur }: { incident: Incident; level: Level; scene: Scene; dur: number }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const out = interpolate(f, [dur - 14, dur], [1, 0], clamp);
  const lift = interpolate(f, [dur - 14, dur], [0, -60], { ...clamp, easing: Easing.in(Easing.cubic) });
  const words = scene.heading.split(' ');
  const sev = SEV_COLOR[incident.severity];
  return (
    <AbsoluteFill style={{ alignItems: 'center', paddingTop: 190, opacity: out, transform: `translateY(${lift}px)` }}>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 26, opacity: interpolate(f, [0, 12], [0, 1], clamp) }}>
        <span style={{ fontFamily: MONO, color: LEVEL_ACCENT[level], fontSize: 22, letterSpacing: 6 }}>{fmtDate(incident.startTs).toUpperCase()}</span>
        <span style={{ padding: '5px 14px', borderRadius: 8, background: sev, color: '#0b0f17', fontWeight: 900, fontSize: 18, letterSpacing: 2, boxShadow: `0 0 ${20 + 14 * Math.sin(f / 5)}px ${sev}` }}>
          {incident.severity.toUpperCase()}
        </span>
      </div>
      <div style={{ fontSize: level === 'layman' ? 80 : 70, fontWeight: 850, lineHeight: 1.06, letterSpacing: -1.5, maxWidth: 1500, textAlign: 'center' }}>
        {words.map((wd, i) => {
          const s = spring({ frame: f - 6 - i * 3, fps, config: { damping: 14, stiffness: 120 } });
          return <span key={i} style={{ display: 'inline-block', margin: '0 11px', transform: `translateY(${(1 - s) * 50}px) scale(${0.9 + 0.1 * s})`, opacity: s }}>{wd}</span>;
        })}
      </div>
    </AbsoluteFill>
  );
}

function SummaryOverlay({ incident, level, scene, dur }: { incident: Incident; level: Level; scene: Scene; dur: number }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const out = interpolate(f, [dur - 10, dur], [1, 0], clamp);
  const hours = (incident.endTs - incident.startTs) / 3600000;
  const hosts = incident.assets.filter((a) => a.compromisedAt != null).length;
  const exfil = incident.events.find((e) => e.phase === 'exfiltration');
  const stats = [
    { icon: 'clock' as const, label: level === 'layman' ? 'start to finish' : 'dwell time', value: hours >= 1 ? `${hours.toFixed(1)}h` : `${Math.round(hours * 60)}m`, color: '#7dd3fc' },
    { icon: 'laptop' as const, label: level === 'layman' ? 'computers hit' : 'hosts compromised', value: String(hosts), color: '#ff3b5c' },
    { icon: 'list' as const, label: level === 'layman' ? 'attack steps' : 'malicious events', value: String(incident.events.length), color: '#c084fc' },
    exfil
      ? { icon: 'upload' as const, label: level === 'layman' ? 'data stolen' : 'exfiltrated', value: exfil.label.match(/[\d.]+\s*(GB|MB|KB|TB)/i)?.[0] ?? 'yes', color: '#ff8a4c' }
      : { icon: 'alert' as const, label: 'severity', value: incident.severity, color: SEV_COLOR[incident.severity] },
  ];
  return (
    <AbsoluteFill style={{ alignItems: 'center', paddingTop: 150, opacity: out }}>
      <div style={{ fontSize: 54, fontWeight: 850, marginBottom: 34, opacity: interpolate(f, [FLY - 10, FLY + 5], [0, 1], clamp) }}>{scene.heading}</div>
      <div style={{ display: 'flex', gap: 24 }}>
        {stats.map((s, i) => {
          const k = spring({ frame: f - FLY - i * 6, fps, config: { damping: 13 } });
          return (
            <div key={i} style={{ width: 300, borderRadius: 22, padding: '22px 26px', background: 'rgba(15,23,42,0.85)', border: `1px solid ${s.color}55`, transform: `translateY(${(1 - k) * 50}px) scale(${0.8 + 0.2 * k})`, opacity: k, display: 'flex', alignItems: 'center', gap: 18 }}>
              <Icon name={s.icon} size={38} color={s.color} />
              <div>
                <div style={{ fontSize: 50, fontWeight: 850, color: s.color, fontFamily: MONO, letterSpacing: -2, lineHeight: 1 }}>{s.value}</div>
                <div style={{ fontSize: 19, color: '#94a3b8', marginTop: 6 }}>{s.label}</div>
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}

function ActionsOverlay({ level, scene, dur }: { level: Level; scene: Scene; dur: number }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const out = interpolate(f, [dur - 12, dur], [1, 0], clamp);
  const items = (scene.bullets ?? []).slice(0, 6);
  const per = Math.max(12, Math.floor((dur - 50) / Math.max(1, items.length)));
  return (
    <AbsoluteFill style={{ padding: '130px 200px 0', opacity: out }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginBottom: 32, opacity: interpolate(f, [10, 24], [0, 1], clamp) }}>
        <Icon name="shield" size={52} color={LEVEL_ACCENT[level]} />
        <div style={{ fontSize: 54, fontWeight: 850 }}>{scene.heading}</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {items.map((b, i) => {
          const k = spring({ frame: f - 16 - i * 7, fps, config: { damping: 16 } });
          const done = f > 30 + i * per;
          const tick = spring({ frame: f - 30 - i * per, fps, config: { damping: 10, stiffness: 200 } });
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 20, opacity: k, transform: `translateX(${(1 - k) * -80}px)`, fontSize: level === 'senior' ? 25 : 29, lineHeight: 1.3 }}>
              <div style={{ flex: '0 0 auto', width: 44, height: 44, borderRadius: 12, border: `3px solid ${done ? '#4ade80' : '#334155'}`, background: done ? '#4ade8022' : 'rgba(15,23,42,0.8)', display: 'grid', placeItems: 'center' }}>
                {done && <span style={{ transform: `scale(${tick})`, display: 'grid' }}><Icon name="check" size={28} color="#4ade80" stroke={3} /></span>}
              </div>
              <span style={{ color: done ? '#f1f5f9' : '#94a3b8' }}>{b}</span>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}

// ---------------------------------------------------------------------------
/** One sentence at a time, words lighting up in step with the voice-over. */
function Subtitles({ text, durationSec, dur, size }: { text: string; durationSec?: number; dur: number; size: number }) {
  const f = useCurrentFrame();
  // split on sentence ends only, not the dots inside IPs, file names or URLs
  // then cap each chunk at ~2 lines, and shorten giant tokens (base64, hashes) so they don't wrap forever
  const sentences = text.split(/(?<=[.!?]["')\]]?)\s+(?=[A-Z0-9"'(])/).flatMap((sen) => {
    const words = sen.trim().split(/\s+/).filter(Boolean).map((wd) => (wd.length > 36 ? wd.slice(0, 32) + '…' : wd));
    const out: string[] = [];
    let line = '';
    for (const wd of words) {
      if (line && line.length + wd.length + 1 > 120) { out.push(line); line = wd; } else line = line ? `${line} ${wd}` : wd;
    }
    if (line) out.push(line);
    return out;
  });
  if (!sentences.length) sentences.push(text);
  const total = sentences.reduce((a, s) => a + s.length, 0) || 1;
  const secs = durationSec && durationSec > 0.5 ? durationSec : text.split(/\s+/).length / 2.6;
  const t0 = LEAD_IN * FPS, t1 = (LEAD_IN + secs) * FPS;
  const p = interpolate(f, [t0, t1], [0, 1], clamp);
  const out = interpolate(f, [dur - 8, dur], [1, 0], clamp);
  let acc = 0, si = sentences.length - 1;
  for (let i = 0; i < sentences.length; i++) {
    if (p * total < acc + sentences[i].length) { si = i; break; }
    acc += sentences[i].length;
  }
  if (f < t0) { acc = 0; si = 0; }
  const s = sentences[si];
  const startF = t0 + (acc / total) * (t1 - t0);
  const inK = interpolate(f, [startF, startF + 8], [0, 1], clamp);
  const local = Math.max(0, Math.min(1, (p * total - acc) / s.length));
  const words = s.split(/\s+/);
  let wacc = 0;
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 54, display: 'flex', justifyContent: 'center', opacity: out * interpolate(f, [t0 - 6, t0 + 4], [0, 1], clamp) }}>
      <div style={{ maxWidth: 1480, padding: '14px 30px', borderRadius: 18, background: 'rgba(4,8,18,0.72)', backdropFilter: 'blur(8px)', fontSize: size, lineHeight: 1.35, fontWeight: 600, textAlign: 'center', opacity: inK, transform: `translateY(${(1 - inK) * 14}px)` }}>
        {words.map((wd, i) => {
          wacc += wd.length + 1;
          const lit = wacc / (s.length + 1) <= local + 0.04;
          return <span key={i} style={{ color: lit ? '#f8fafc' : '#64748b' }}>{wd} </span>;
        })}
      </div>
    </div>
  );
}
