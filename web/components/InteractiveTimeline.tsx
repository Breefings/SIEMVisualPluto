import { useEffect, useMemo, useRef, useState } from 'react';
import { Easing } from 'remotion';
import type { CaseSummary, Level, TimelineEvent } from '../../shared/types.ts';
import { Icon } from '../../shared/Icon.tsx';
import { LEVEL_ACCENT } from '../../shared/theme.ts';
import { Backdrop, buildWorld, EventCard, FLY, FONT, Hud, smooth, TimelineAxis, type Cam, type World } from '../../video/stage.tsx';
import { FPS } from '../../video/timing.ts';

interface Props {
  c: CaseSummary;
  level: Level;
  events: TimelineEvent[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  onWindow: (w: [number, number]) => void;
}

/** A camera move in progress: from -> to, starting at `at` (frames), optionally zooming out mid-flight. */
interface Flight { from: Cam; to: Cam; at: number; dur: number; dip: number }

const restFor = (w: World, k: number | null): Cam =>
  k == null || k < 0 ? { cx: w.mid, cy: 0, s: w.overview, oy: 40 } : { cx: w.xs[k], cy: (k % 2 === 0 ? -1 : 1) * w.camY, s: 1, oy: 0 };

function camAt(fl: Flight, frame: number): Cam {
  const t = Math.min(1, Math.max(0, (frame - fl.at) / fl.dur));
  const e = Easing.inOut(Easing.cubic)(t);
  const { from, to } = fl;
  const s = Math.exp(Math.log(from.s) + (Math.log(to.s) - Math.log(from.s)) * e) * (1 - fl.dip * Math.sin(Math.PI * e));
  return { cx: from.cx + (to.cx - from.cx) * e, cy: from.cy + (to.cy - from.cy) * e, oy: from.oy + (to.oy - from.oy) * e, s };
}

/**
 * The same animated timeline as the video, but driven by the viewer: click a checkpoint (or a card) and the
 * camera flies there; scroll to zoom, drag to pan, arrow keys step through the story.
 */
export function InteractiveTimeline({ c, level, events, selected, onSelect, onWindow }: Props) {
  const inc = c.incident!;
  const w = useMemo(() => buildWorld(inc, events, level), [inc, events, level]);
  const selK = events.findIndex((e) => e.id === selected);

  // animation clock in "video frames" (30/s), driven by requestAnimationFrame
  const [frame, setFrame] = useState(0);
  const frameRef = useRef(0);
  useEffect(() => {
    const t0 = performance.now();
    let raf = 0;
    const tick = () => {
      frameRef.current = ((performance.now() - t0) / 1000) * FPS;
      setFrame(frameRef.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // camera: fly to the selected event (or the overview) whenever the selection changes
  const [flight, setFlight] = useState<Flight>(() => { const r = restFor(w, null); return { from: { ...r, s: r.s * 1.5 }, to: r, at: 0, dur: 50, dip: 0 }; });
  const [appearAt, setAppearAt] = useState<Map<string, number>>(new Map());
  const prevK = useRef<number | null>(null);
  const prevPlay = useRef({ x: w.xStart, ts: inc.startTs });
  useEffect(() => {
    const now = frameRef.current;
    const k = selK >= 0 ? selK : null;
    setFlight((fl) => {
      const from = camAt(fl, now);
      const to = restFor(w, k);
      const hop = k != null && prevK.current != null && from.s > 0.6;
      return { from, to, at: now, dur: FLY + 6, dip: hop ? 0.42 : 0 };
    });
    // the newly selected card replays its entrance once the camera is nearly there
    if (k != null) setAppearAt((m) => new Map(m).set(events[k].id, now + Math.round((FLY + 6) * 0.6)));
    prevK.current = k;
  }, [selK, w]); // eslint-disable-line react-hooks/exhaustive-deps

  const cam = camAt(flight, frame);
  const proj = (x: number, y: number) => ({ X: (x - cam.cx) * cam.s + 960, Y: (y - cam.cy) * cam.s + 540 + cam.oy });
  const moving = frame < flight.at + flight.dur;

  // the clock + progress bar travel with the camera
  const fromK = prevPlay.current;
  const fe = Easing.inOut(Easing.cubic)(Math.min(1, Math.max(0, (frame - flight.at) / flight.dur)));
  const target = selK >= 0 ? { x: w.xs[selK], ts: events[selK].ts } : { x: w.xEnd, ts: inc.endTs };
  const playX = fromK.x + (target.x - fromK.x) * fe;
  const now = fromK.ts + (target.ts - fromK.ts) * fe;
  useEffect(() => { if (!moving) prevPlay.current = target; });

  // report the visible time window (for the raw-log panel) once the camera settles
  const settled = !moving;
  useEffect(() => {
    if (!settled) return;
    const half = 960 / cam.s;
    onWindow([w.tsOfX(cam.cx - half), w.tsOfX(cam.cx + half)]);
  }, [settled, flight]); // eslint-disable-line react-hooks/exhaustive-deps

  // scale the 1920x1080 stage to the container
  const box = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  const [full, setFull] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    // fit the width, but never taller than what's left of the window (or the whole screen in fullscreen)
    const fit = () => {
      const fs = document.fullscreenElement === card.current;
      setFull(fs);
      const availH = fs ? window.innerHeight : Math.max(320, window.innerHeight - el.getBoundingClientRect().top - 24);
      setScale(Math.min(el.clientWidth / 1920, availH / 1080));
    };
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    addEventListener('resize', fit);
    document.addEventListener('fullscreenchange', fit);
    return () => { ro.disconnect(); removeEventListener('resize', fit); document.removeEventListener('fullscreenchange', fit); };
  }, []);
  const toggleFull = () => { (document.fullscreenElement ? document.exitFullscreen() : card.current?.requestFullscreen())?.catch(() => {}); };

  // free camera: wheel zooms around the cursor, drag pans
  const drag = useRef<{ x: number; y: number; cam: Cam; moved: boolean } | null>(null);
  const setCam = (to: Cam) => setFlight({ from: to, to, at: frameRef.current, dur: 1, dip: 0 });
  const local = (ev: { clientX: number; clientY: number }) => {
    const r = box.current!.getBoundingClientRect();
    return { x: (ev.clientX - r.left - (r.width - 1920 * scale) / 2) / scale, y: (ev.clientY - r.top) / scale };
  };
  const flightRef = useRef(flight);
  flightRef.current = flight;
  const live = useRef({ local, w });
  live.current = { local, w };
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const { local, w } = live.current;
      const cur = camAt(flightRef.current, frameRef.current);
      const p = local(ev);
      const s = Math.min(1.6, Math.max(w.overview, cur.s * Math.exp(-ev.deltaY * 0.0015)));
      // keep the world point under the cursor fixed
      const wx = (p.x - 960) / cur.s + cur.cx, wy = (p.y - 540 - cur.oy) / cur.s + cur.cy;
      setCam({ cx: wx - (p.x - 960) / s, cy: wy - (p.y - 540 - cur.oy) / s, s, oy: cur.oy });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  /** Animated zoom about the middle of the screen; zooming far enough out lands on the whole timeline. */
  const flyTo = (to: Cam) => setFlight((fl) => ({ from: camAt(fl, frameRef.current), to, at: frameRef.current, dur: 26, dip: 0 }));
  const overview = () => {
    if (selK >= 0) onSelect(null); // the selection effect flies out
    else setFlight((fl) => ({ from: camAt(fl, frameRef.current), to: restFor(w, null), at: frameRef.current, dur: FLY, dip: 0 }));
  };
  const zoom = (factor: number) => {
    const cur = camAt(flightRef.current, frameRef.current);
    const s = Math.min(1.6, cur.s * factor);
    if (s <= w.overview * 1.15) return overview();
    // drift back toward the line as we pull out, so the timeline stays centred
    const cy = Math.max(-w.camY, Math.min(w.camY, (cur.cy / cur.s) * Math.min(1, s)));
    flyTo({ ...cur, s, cy });
  };

  // keyboard: - / + zoom, 0 whole timeline, f fullscreen (arrows are handled by the page)
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if ((ev.target as HTMLElement)?.tagName === 'INPUT') return;
      if (ev.key === '-' || ev.key === '_') zoom(1 / 1.8);
      else if (ev.key === '=' || ev.key === '+') zoom(1.8);
      else if (ev.key === '0') overview();
      else if (ev.key === 'f' || ev.key === 'F') toggleFull();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });

  const pick = (k: number) => {
    if (drag.current?.moved) return;
    onSelect(events[k].id);
  };
  const step = (d: number) => {
    if (!events.length) return;
    const k = selK < 0 ? (d > 0 ? 0 : events.length - 1) : Math.min(events.length - 1, Math.max(0, selK + d));
    onSelect(events[k].id);
  };

  const cardFade = smooth(cam.s, 0.36, 0.5);
  const sel = selK >= 0 ? events[selK] : null;

  return (
    <div className={`stage-card${full ? ' full' : ''}`} ref={card}>
      <div
        ref={box}
        className="stage"
        style={{ height: 1080 * scale }}
        onPointerDown={(ev) => { drag.current = { ...local(ev), cam, moved: false }; }}
        onPointerMove={(ev) => {
          const d = drag.current;
          if (!d || !(ev.buttons & 1)) return;
          const p = local(ev);
          if (!d.moved && Math.hypot(p.x - d.x, p.y - d.y) < 6) return;
          d.moved = true;
          setCam({ ...d.cam, cx: d.cam.cx - (p.x - d.x) / d.cam.s, cy: d.cam.cy - (p.y - d.y) / d.cam.s });
        }}
        onPointerUp={() => setTimeout(() => (drag.current = null), 0)}
      >
        <div style={{ position: 'absolute', left: '50%', marginLeft: -960 * scale, top: 0, width: 1920, height: 1080, transform: `scale(${scale})`, transformOrigin: '0 0', overflow: 'hidden', background: '#040812', maskImage: 'linear-gradient(90deg, transparent, #000 5%, #000 95%, transparent)', fontFamily: FONT, color: '#e2e8f0' }}>
          <Backdrop cam={cam} frame={frame} accent={LEVEL_ACCENT[level]} now={now} show={!!sel} />
          <div style={{ position: 'absolute', left: 0, top: 0, transformOrigin: '0 0', transform: `translate(960px, ${540 + cam.oy}px) scale(${cam.s}) translate(${-cam.cx}px, ${-cam.cy}px)`, opacity: cardFade, pointerEvents: cardFade > 0.5 ? 'auto' : 'none' }}>
            {events.map((e, k) => (
              <EventCard
                key={e.id} e={e} heading={e.narratives[level].title} k={k} x={w.xs[k]}
                cf={frame - (appearAt.get(e.id) ?? -1000)} active={k === selK} level={level} incident={inc}
                onClick={() => pick(k)}
              />
            ))}
          </div>
          <TimelineAxis
            w={w} cam={cam} proj={proj} incident={inc} level={level} frame={frame}
            curK={selK >= 0 ? selK : events.length} revealed={events.length - 1}
            playX={playX} introLine={frame} appearAt={appearAt} onSelect={pick}
          />
          <Hud incident={inc} level={level} frame={frame} now={now} events={events} curK={selK >= 0 ? selK : events.length} kind="event" brand={false} />
          {sel && cardFade > 0.02 && (
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: 54, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
              <div key={sel.id} className="stage-sub" style={{ fontSize: level === 'layman' ? 30 : 26, maxWidth: 1240, opacity: cardFade }}>{gist(sel.narratives[level].text)}</div>
            </div>
          )}
        </div>

        <div className="stage-ctrl" onPointerDown={(ev) => ev.stopPropagation()}>
          <button className="icon-btn" title="Previous event (←)" onClick={() => step(-1)} disabled={selK === 0}><Icon name="chevron-left" size={18} /></button>
          <button className="icon-btn" title="Next event (→)" onClick={() => step(1)} disabled={selK === events.length - 1}><Icon name="chevron-right" size={18} /></button>
          <span className="ctrl-sep" />
          <button className="icon-btn" title="Zoom out (−)" onClick={() => zoom(1 / 1.8)} disabled={cam.s <= w.overview * 1.01}><Icon name="zoom-out" size={17} /></button>
          <button className="icon-btn" title="Zoom in (+)" onClick={() => zoom(1.8)} disabled={cam.s >= 1.59}><Icon name="zoom-in" size={17} /></button>
          <button className="icon-btn" title="Whole timeline (0)" onClick={overview} disabled={selK < 0 && !moving && Math.abs(cam.s - w.overview) < 0.01}><Icon name="fit" size={17} /></button>
          <span className="ctrl-sep" />
          <button className="icon-btn" title={full ? 'Exit fullscreen (F)' : 'Fullscreen (F)'} onClick={toggleFull}><Icon name={full ? 'minimize' : 'maximize'} size={16} /></button>
        </div>
      </div>
    </div>
  );
}

/** First sentence or two (the full text lives in the detail panel below the timeline). */
function gist(text: string) {
  const parts = text.split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/);
  let out = '';
  for (const p of parts) {
    if (out && out.length + p.length > 200) break;
    out = out ? `${out} ${p}` : p;
  }
  return out.length > 240 ? out.slice(0, 236).replace(/\s+\S*$/, '') + '…' : out;
}
