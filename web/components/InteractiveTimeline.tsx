import { scaleUtc, utcFormat } from 'd3';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Asset, CaseSummary, Level, LogRecord, TimelineEvent } from '../../shared/types.ts';
import { Icon, IconG } from '../../shared/Icon.tsx';
import { ASSET_ICON, fmtClockSec, fmtDate, PHASE_COLOR, PHASE_ICON } from '../../shared/theme.ts';
import { api, type Histogram } from '../api.ts';

const LABEL_W = 220;
const AXIS_H = 36;
const DENS_H = 58;
const MINI_H = 44;
const SRC_COLORS = ['#38bdf8', '#a78bfa', '#34d399', '#fbbf24', '#f472b6', '#60a5fa', '#fb923c', '#2dd4bf'];
const MIN_SPAN = 5_000;

interface Props {
  c: CaseSummary;
  level: Level;
  events: TimelineEvent[];
  selected: string | null;
  onSelect: (id: string) => void;
  onWindow: (w: [number, number]) => void;
}

type Domain = [number, number];

export function InteractiveTimeline({ c, level, events, selected, onSelect, onWindow }: Props) {
  const inc = c.incident!;
  const wrap = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(1100);
  const full = useMemo<Domain>(() => {
    const a = Math.min(c.range?.[0] ?? inc.startTs, inc.startTs);
    const b = Math.max(c.range?.[1] ?? inc.endTs, inc.endTs);
    const pad = Math.max(60_000, (b - a) * 0.02);
    return [a - pad, b + pad];
  }, [c.range, inc]);
  const fitIncident = useCallback((): Domain => {
    const pad = Math.max(5 * 60_000, (inc.endTs - inc.startTs) * 0.06);
    return [inc.startTs - pad, inc.endTs + pad];
  }, [inc]);
  const [domain, setDomain] = useState<Domain>(fitIncident);
  const [hist, setHist] = useState<Histogram | null>(null);
  const [mini, setMini] = useState<Histogram | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number; e?: TimelineEvent; r?: LogRecord } | null>(null);
  const [evidence, setEvidence] = useState<Map<number, LogRecord>>(new Map());
  const anim = useRef<number>(0);

  // ---- sizing --------------------------------------------------------------
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(600, e.contentRect.width)));
    if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  // ---- lanes -----------------------------------------------------------------
  const lanes = useMemo(() => {
    const used = new Set(events.flatMap((e) => [e.host, e.fromHost, e.toHost]).filter(Boolean) as string[]);
    const assets: Asset[] = inc.assets.filter((a) => used.has(a.id) || a.compromisedAt != null);
    const order = (a: Asset) => (a.kind === 'external' ? 2 : a.compromisedAt != null ? 0 : 1);
    assets.sort((a, b) => order(a) - order(b) || (a.compromisedAt ?? 0) - (b.compromisedAt ?? 0) || a.id.localeCompare(b.id));
    const list: (Asset | { id: '_other'; friendly: string; kind: 'server' })[] = [...assets];
    if (events.some((e) => !e.host)) list.push({ id: '_other', friendly: 'Other / network-wide', kind: 'server' });
    return list;
  }, [inc, events]);
  const laneH = level === 'layman' ? 78 : 66;
  const laneY = (id?: string) => {
    const i = lanes.findIndex((l) => l.id === (id ?? '_other'));
    return AXIS_H + DENS_H + 10 + (i < 0 ? lanes.length - 1 : i) * laneH + laneH / 2;
  };
  const height = AXIS_H + DENS_H + 10 + lanes.length * laneH + 12;

  const x = useMemo(() => scaleUtc().domain(domain).range([LABEL_W, width - 20]), [domain, width]);
  const span = domain[1] - domain[0];

  // ---- data fetching ---------------------------------------------------------
  useEffect(() => {
    const t = setTimeout(() => {
      api.histogram(c.id, domain[0], domain[1], Math.floor((width - LABEL_W) / 5)).then(setHist).catch(() => {});
      onWindow(domain);
    }, 120);
    return () => clearTimeout(t);
  }, [c.id, domain, width, onWindow]);
  useEffect(() => {
    api.histogram(c.id, full[0], full[1], 300).then(setMini).catch(() => {});
    const ids = [...new Set(inc.events.flatMap((e) => e.evidence))];
    if (ids.length) api.records(c.id, { ids, limit: 2000 }).then((r) => setEvidence(new Map(r.records.map((x) => [x.id, x])))).catch(() => {});
  }, [c.id, full, inc]);

  // ---- zoom / pan --------------------------------------------------------------
  const clampDomain = useCallback(
    ([a, b]: Domain): Domain => {
      let s = Math.max(MIN_SPAN, Math.min(b - a, (full[1] - full[0]) * 1.5));
      const mid = (a + b) / 2;
      let lo = mid - s / 2;
      const slack = s * 0.4;
      lo = Math.max(full[0] - slack, Math.min(lo, full[1] + slack - s));
      return [lo, lo + s];
    },
    [full],
  );
  const animateTo = useCallback(
    (target: Domain, ms = 450) => {
      cancelAnimationFrame(anim.current);
      const t = clampDomain(target);
      const start = performance.now();
      const from = domain;
      const ls0 = Math.log(from[1] - from[0]), ls1 = Math.log(t[1] - t[0]);
      const m0 = (from[0] + from[1]) / 2, m1 = (t[0] + t[1]) / 2;
      const step = (now: number) => {
        const k = Math.min(1, (now - start) / ms);
        const e = 1 - Math.pow(1 - k, 3);
        const s = Math.exp(ls0 + (ls1 - ls0) * e);
        const m = m0 + (m1 - m0) * e;
        setDomain([m - s / 2, m + s / 2]);
        if (k < 1) anim.current = requestAnimationFrame(step);
      };
      anim.current = requestAnimationFrame(step);
    },
    [domain, clampDomain],
  );
  const zoomAt = useCallback((factor: number, px?: number) => {
    setDomain((d) => {
      const sc = scaleUtc().domain(d).range([LABEL_W, width - 20]);
      const pivot = px != null ? +sc.invert(px) : (d[0] + d[1]) / 2;
      return clampDomain([pivot - (pivot - d[0]) * factor, pivot + (d[1] - pivot) * factor]);
    });
  }, [width, clampDomain]);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      cancelAnimationFrame(anim.current);
      const rect = el.getBoundingClientRect();
      const px = ev.clientX - rect.left;
      if (Math.abs(ev.deltaX) > Math.abs(ev.deltaY) || ev.shiftKey) {
        const d = ev.shiftKey ? ev.deltaY : ev.deltaX;
        setDomain((dm) => { const s = dm[1] - dm[0]; const dt = (d / (width - LABEL_W)) * s; return clampDomain([dm[0] + dt, dm[1] + dt]); });
      } else zoomAt(Math.exp(ev.deltaY * 0.0016), px);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [width, zoomAt, clampDomain]);

  const drag = useRef<{ x0: number; d0: Domain; moved: boolean } | null>(null);
  const onPointerDown = (ev: React.PointerEvent) => {
    if ((ev.target as Element).closest('[data-ev]')) return;
    cancelAnimationFrame(anim.current);
    drag.current = { x0: ev.clientX, d0: domain, moved: false };
    (ev.currentTarget as Element).setPointerCapture(ev.pointerId);
  };
  const onPointerMove = (ev: React.PointerEvent) => {
    const rect = svgRef.current!.getBoundingClientRect();
    if (drag.current) {
      const dx = ev.clientX - drag.current.x0;
      if (Math.abs(dx) > 2) drag.current.moved = true;
      const s = drag.current.d0[1] - drag.current.d0[0];
      const dt = (-dx / (width - LABEL_W - 20)) * s;
      setDomain(clampDomain([drag.current.d0[0] + dt, drag.current.d0[1] + dt]));
      setHover(null);
    } else if (!(ev.target as Element).closest('[data-ev],[data-rec]')) {
      setHover({ x: ev.clientX - rect.left, y: ev.clientY - rect.top });
    }
  };
  const onPointerUp = () => (drag.current = null);

  // keep the selected event in view
  useEffect(() => {
    const e = inc.events.find((x) => x.id === selected);
    if (!e) return;
    const lo = domain[0] + span * 0.02, hi = domain[1] - span * 0.02;
    if (e.ts < lo || e.ts > hi) animateTo([e.ts - span / 2, e.ts + span / 2]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const focusEvent = (e: TimelineEvent, win: number) => {
    onSelect(e.id);
    animateTo([e.ts - win / 2, e.ts + win / 2]);
  };

  // ---- render helpers ----------------------------------------------------------
  const fmt = span < 3 * 60_000 ? utcFormat('%H:%M:%S') : span < 3 * 86_400_000 ? utcFormat('%H:%M') : utcFormat('%b %d %H:%M');
  const ticks = x.ticks(Math.max(4, Math.floor((width - LABEL_W) / 120)));
  const selEv = inc.events.find((e) => e.id === selected);
  const evColor = (e: TimelineEvent) => PHASE_COLOR[e.phase];
  const label = (e: TimelineEvent) => (level === 'layman' ? e.narratives.layman.title : level === 'analyst' ? `${e.label}` : `${e.technique?.id ?? ''} ${e.label}`.trim());

  // per-lane label culling
  const shownLabels = useMemo(() => {
    const s = new Set<string>();
    const byLane = new Map<string, TimelineEvent[]>();
    for (const e of events) {
      const lane = e.toHost ?? e.host ?? '_other';
      (byLane.get(lane) ?? byLane.set(lane, []).get(lane)!).push(e);
    }
    for (const list of byLane.values()) {
      const xs = list.map((e) => ({ e, px: x(e.ts) })).filter((o) => o.px >= LABEL_W - 4 && o.px <= width).sort((a, b) => a.px - b.px);
      xs.forEach((o, i) => {
        const next = xs[i + 1]?.px ?? width + 400;
        const need = label(o.e).length * 6.6 + 34;
        if (next - o.px > need && o.px + need < width + 60) s.add(o.e.id);
      });
    }
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, x, width, level]);

  // density bars
  const densBars = useMemo(() => {
    if (!hist) return null;
    const n = hist.buckets.length;
    const totals = hist.buckets.map((b) => b.reduce((a, v) => a + v, 0));
    const max = Math.max(1, ...totals);
    const bw = (x(hist.to) - x(hist.from)) / n;
    const top = AXIS_H + 4;
    return hist.buckets.map((b, i) => {
      let y = top + DENS_H - 6;
      const bx = x(hist.from) + i * bw;
      return (
        <g key={i}>
          {b.map((v, si) => {
            if (!v) return null;
            const h = (Math.sqrt(v) / Math.sqrt(max)) * (DENS_H - 10) * (v / Math.max(1, totals[i]));
            y -= h;
            return <rect key={si} x={bx} y={y} width={Math.max(1, bw - 1)} height={h} fill={SRC_COLORS[si % SRC_COLORS.length]} opacity={0.55} />;
          })}
          {hist.flags[i] > 0 && <rect x={bx} y={top} width={Math.max(2, bw - 1)} height={4} fill="#ff3b5c" />}
        </g>
      );
    });
  }, [hist, x]);

  const evidenceTicks = level !== 'layman' && span < 6 * 3600_000 ? (
    <g>
      {events.flatMap((e) =>
        e.evidence.map((id) => {
          const r = evidence.get(id);
          if (!r || r.ts < domain[0] || r.ts > domain[1]) return null;
          const lane = laneY(e.phase === 'lateral-movement' ? e.toHost : e.host);
          return (
            <line key={`${e.id}-${id}`} data-rec x1={x(r.ts)} x2={x(r.ts)} y1={lane + 18} y2={lane + 28} stroke={evColor(e)} strokeWidth={span < 20 * 60_000 ? 3 : 1.5} opacity={0.85}
              onPointerEnter={(ev) => { const rect = svgRef.current!.getBoundingClientRect(); setHover({ x: ev.clientX - rect.left, y: ev.clientY - rect.top, r }); }}
              onPointerLeave={() => setHover(null)} style={{ cursor: 'help' }} />
          );
        }),
      )}
    </g>
  ) : null;

  const presets: [string, () => void][] = [
    ['Attack window', () => animateTo(fitIncident())],
    ['All logs', () => animateTo(full)],
    ['1 hour', () => animateTo([((selEv?.ts ?? (domain[0] + domain[1]) / 2)) - 1800_000, (selEv?.ts ?? (domain[0] + domain[1]) / 2) + 1800_000])],
    ['10 min', () => animateTo([((selEv?.ts ?? (domain[0] + domain[1]) / 2)) - 300_000, (selEv?.ts ?? (domain[0] + domain[1]) / 2) + 300_000])],
  ];

  return (
    <div className="itl card" ref={wrap}>
      <div className="itl-toolbar">
        <div className="row gap">
          <button className="icon-btn" title="Zoom in" onClick={() => zoomAt(0.6)}><Icon name="zoom-in" size={16} /></button>
          <button className="icon-btn" title="Zoom out" onClick={() => zoomAt(1.6)}><Icon name="zoom-out" size={16} /></button>
          <button className="icon-btn" title="Fit attack" onClick={() => animateTo(fitIncident())}><Icon name="maximize" size={16} /></button>
          <div className="seg sm">{presets.map(([l, f]) => <button key={l} onClick={f}>{l}</button>)}</div>
        </div>
        <div className="itl-window">
          <Icon name="clock" size={14} /> {fmtDate(domain[0])} · {fmtClockSec(domain[0])} → {fmtClockSec(domain[1])} UTC
          <span className="muted"> ({humanSpan(span)})</span>
        </div>
        <div className="muted small hint">Scroll to zoom · drag to pan · click an event</div>
      </div>

      <svg ref={svgRef} width={width} height={height} className="itl-svg" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={() => setHover(null)}
        onDoubleClick={(ev) => { const r = svgRef.current!.getBoundingClientRect(); zoomAt(0.5, ev.clientX - r.left); }}>
        <defs>
          <clipPath id="plot"><rect x={LABEL_W} y={0} width={width - LABEL_W} height={height} /></clipPath>
          <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#ff3b6b" /></marker>
          <filter id="g2"><feGaussianBlur stdDeviation="3" /></filter>
        </defs>

        {/* lanes */}
        {lanes.map((l, i) => {
          const y = AXIS_H + DENS_H + 10 + i * laneH;
          const a = l as Asset;
          return (
            <g key={l.id}>
              <rect x={0} y={y} width={width} height={laneH} fill={i % 2 ? 'rgba(148,163,184,0.025)' : 'transparent'} />
              {a.compromisedAt != null && (
                <g clipPath="url(#plot)">
                  <rect x={x(a.compromisedAt)} y={y + 3} width={Math.max(0, width - x(a.compromisedAt))} height={laneH - 6} fill="rgba(255,59,92,0.07)" />
                  <line x1={x(a.compromisedAt)} x2={x(a.compromisedAt)} y1={y + 3} y2={y + laneH - 3} stroke="rgba(255,59,92,0.5)" strokeDasharray="3 3" />
                </g>
              )}
              <line x1={0} x2={width} y1={y + laneH / 2} y2={y + laneH / 2} stroke="#1e293b" strokeDasharray="2 6" />
              <g transform={`translate(14 ${y + laneH / 2})`}>
                <rect x={0} y={-17} width={34} height={34} rx={9} fill="#0b1324" stroke={a.compromisedAt != null || a.kind === 'external' ? '#ff3b5c' : '#334155'} />
                <IconG name={l.id === '_other' ? 'globe' : ASSET_ICON[a.kind]} x={17} y={0} size={18} color={a.compromisedAt != null || a.kind === 'external' ? '#ff6b81' : '#94a3b8'} />
                <text x={46} y={level === 'layman' ? -2 : -4} fill="#e2e8f0" fontSize={13.5} fontWeight={600}>{trunc(level === 'layman' ? a.friendly : l.id, 20)}</text>
                <text x={46} y={13} fill={a.compromisedAt != null ? '#ff8095' : '#64748b'} fontSize={11.5}>
                  {a.compromisedAt != null ? `compromised ${fmtClockSec(a.compromisedAt).replace(/:\d\d /, ' ')}` : a.kind === 'external' ? (level === 'layman' ? 'on the internet' : 'external / attacker') : level === 'layman' ? 'not affected' : trunc(a.friendly, 22)}
                </text>
              </g>
            </g>
          );
        })}
        <line x1={LABEL_W - 6} x2={LABEL_W - 6} y1={AXIS_H} y2={height} stroke="#1e293b" />

        {/* axis */}
        <g>
          {ticks.map((t) => (
            <g key={+t}>
              <line x1={x(t)} x2={x(t)} y1={AXIS_H - 6} y2={height} stroke="rgba(148,163,184,0.08)" />
              <text x={x(t)} y={AXIS_H - 12} fill="#94a3b8" fontSize={11.5} textAnchor="middle" fontFamily="JetBrains Mono, monospace">{fmt(t)}</text>
            </g>
          ))}
          <text x={14} y={AXIS_H - 12} fill="#64748b" fontSize={11} fontWeight={600} letterSpacing={1}>{fmtDate(domain[0]).toUpperCase()} · UTC</text>
          <text x={14} y={AXIS_H + 26} fill="#64748b" fontSize={11} letterSpacing={1}>LOG VOLUME</text>
          <text x={14} y={AXIS_H + 42} fill="#475569" fontSize={10.5}>{hist ? `${hist.buckets.reduce((a, b) => a + b.reduce((x, y) => x + y, 0), 0).toLocaleString()} lines in view` : ''}</text>
        </g>
        <g clipPath="url(#plot)">{densBars}</g>

        {/* events */}
        <g clipPath="url(#plot)">
          {selEv && <line x1={x(selEv.ts)} x2={x(selEv.ts)} y1={AXIS_H} y2={height} stroke="#fff" strokeOpacity={0.35} strokeWidth={1.5} />}
          {evidenceTicks}
          {events.map((e) => {
            const col = evColor(e);
            const y = laneY(e.phase === 'lateral-movement' ? e.toHost : e.host);
            const px = x(e.ts);
            const r = e.key ? 14 : 10.5;
            const on = e.id === selected;
            return (
              <g key={e.id}>
                {e.endTs && e.endTs > e.ts && (
                  <rect x={px} y={y - 3} width={Math.max(2, x(e.endTs) - px)} height={6} rx={3} fill={col} opacity={0.4} />
                )}
                {e.phase === 'lateral-movement' && e.fromHost && (
                  <path d={`M${px - 26} ${laneY(e.fromHost)} C ${px - 4} ${laneY(e.fromHost)}, ${px - 22} ${y}, ${px - r - 3} ${y}`} stroke="#ff3b6b" strokeWidth={2.5} fill="none" markerEnd="url(#arrow)" opacity={0.95} />
                )}
                <g data-ev transform={`translate(${px} ${y})`} style={{ cursor: 'pointer' }}
                  onClick={() => onSelect(e.id)}
                  onDoubleClick={(ev) => { ev.stopPropagation(); focusEvent(e, Math.min(span, 30 * 60_000)); }}
                  onPointerEnter={(ev) => { const rect = svgRef.current!.getBoundingClientRect(); setHover({ x: ev.clientX - rect.left, y: ev.clientY - rect.top, e }); }}
                  onPointerLeave={() => setHover(null)}>
                  {on && <circle r={r + 8} fill={col} opacity={0.25} filter="url(#g2)" />}
                  {on && <circle r={r + 5} fill="none" stroke="#fff" strokeWidth={2} />}
                  <circle r={r} fill="#0b1324" stroke={col} strokeWidth={e.key ? 2.6 : 2} />
                  <IconG name={PHASE_ICON[e.phase]} x={0} y={0} size={e.key ? 15 : 12} color={col} />
                  {shownLabels.has(e.id) && (
                    <text x={r + 8} y={4} fill={on ? '#fff' : '#cbd5e1'} fontSize={12.5} fontWeight={on ? 700 : 500} style={{ pointerEvents: 'none' }}>{label(e)}</text>
                  )}
                </g>
              </g>
            );
          })}
          {hover && !hover.e && !hover.r && hover.x > LABEL_W && (
            <g pointerEvents="none">
              <line x1={hover.x} x2={hover.x} y1={AXIS_H} y2={height} stroke="#7dd3fc" strokeOpacity={0.4} />
              <rect x={hover.x - 44} y={AXIS_H - 2} width={88} height={18} rx={4} fill="#0ea5e9" />
              <text x={hover.x} y={AXIS_H + 11} textAnchor="middle" fill="#04111f" fontSize={11} fontWeight={700} fontFamily="JetBrains Mono, monospace">{utcFormat(span < 3600_000 ? '%H:%M:%S' : '%H:%M')(x.invert(hover.x))}</text>
            </g>
          )}
        </g>
      </svg>

      {hover?.e && (
        <div className="tip" style={{ left: Math.min(hover.x + 16, width - 340), top: hover.y + 66 }}>
          <div className="tip-time" style={{ color: evColor(hover.e) }}>{fmtClockSec(hover.e.ts)}{hover.e.technique && level !== 'layman' ? ` · ${hover.e.technique.id}` : ''}</div>
          <b>{hover.e.narratives[level].title}</b>
          <div className="muted small">{trunc(hover.e.narratives[level].text, 180)}</div>
        </div>
      )}
      {hover?.r && (
        <div className="tip mono" style={{ left: Math.min(hover.x + 16, width - 520), top: hover.y + 66, maxWidth: 500 }}>
          <div className="tip-time">{fmtClockSec(hover.r.ts)} · {hover.r.source}</div>
          {trunc(hover.r.raw, 400)}
        </div>
      )}

      <Minimap full={full} domain={domain} width={width} hist={mini} events={events} onMove={(d) => setDomain(clampDomain(d))} />
    </div>
  );
}

function Minimap({ full, domain, width, hist, events, onMove }: { full: Domain; domain: Domain; width: number; hist: Histogram | null; events: TimelineEvent[]; onMove: (d: Domain) => void }) {
  const x = scaleUtc().domain(full).range([LABEL_W, width - 20]);
  const ref = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x0: number; d0: Domain } | null>(null);
  const max = hist ? Math.max(1, ...hist.buckets.map((b) => b.reduce((a, v) => a + v, 0))) : 1;
  const bx0 = Math.max(LABEL_W, x(domain[0])), bx1 = Math.min(width - 20, x(domain[1]));
  const toTs = (px: number) => +x.invert(px);
  return (
    <svg ref={ref} width={width} height={MINI_H + 8} className="minimap"
      onPointerDown={(ev) => {
        const r = ref.current!.getBoundingClientRect();
        const px = ev.clientX - r.left;
        const s = domain[1] - domain[0];
        if (px < bx0 || px > bx1) onMove([toTs(px) - s / 2, toTs(px) + s / 2]);
        drag.current = { x0: ev.clientX, d0: px < bx0 || px > bx1 ? [toTs(px) - s / 2, toTs(px) + s / 2] : domain };
        (ev.currentTarget as Element).setPointerCapture(ev.pointerId);
      }}
      onPointerMove={(ev) => {
        if (!drag.current) return;
        const dt = toTs(ev.clientX) - toTs(drag.current.x0);
        onMove([drag.current.d0[0] + dt, drag.current.d0[1] + dt]);
      }}
      onPointerUp={() => (drag.current = null)}>
      <text x={14} y={20} fill="#64748b" fontSize={11} letterSpacing={1}>OVERVIEW</text>
      <text x={14} y={35} fill="#475569" fontSize={10.5}>drag to navigate</text>
      <rect x={LABEL_W} y={4} width={width - LABEL_W - 20} height={MINI_H} rx={6} fill="#0a1222" stroke="#1e293b" />
      {hist?.buckets.map((b, i) => {
        const t = b.reduce((a, v) => a + v, 0);
        const w = (x(hist.to) - x(hist.from)) / hist.buckets.length;
        const h = (Math.sqrt(t) / Math.sqrt(max)) * (MINI_H - 8);
        return <rect key={i} x={x(hist.from) + i * w} y={4 + MINI_H - 2 - h} width={Math.max(1, w - 0.5)} height={h} fill="#334155" />;
      })}
      {events.map((e) => <circle key={e.id} cx={x(e.ts)} cy={14} r={e.key ? 4 : 3} fill={PHASE_COLOR[e.phase]} />)}
      <rect x={bx0} y={3} width={Math.max(4, bx1 - bx0)} height={MINI_H + 2} rx={6} fill="rgba(125,211,252,0.12)" stroke="#7dd3fc" strokeWidth={1.5} style={{ cursor: 'grab' }} />
    </svg>
  );
}

const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
function humanSpan(ms: number) {
  if (ms < 120_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 7_200_000) return `${Math.round(ms / 60_000)} min`;
  if (ms < 172_800_000) return `${(ms / 3_600_000).toFixed(1)} h`;
  return `${(ms / 86_400_000).toFixed(1)} days`;
}
