import { useEffect, useMemo, useState } from 'react';
import type { CaseSummary, Level, Status, TimelineEvent } from '../../shared/types.ts';
import { LEVELS, PHASES } from '../../shared/types.ts';
import { Icon } from '../../shared/Icon.tsx';
import { fmtClock, fmtDate, LEVEL_ACCENT, PHASE_COLOR, PHASE_ICON, SEV_COLOR } from '../../shared/theme.ts';
import { api } from '../api.ts';
import { EventDetail } from '../components/EventDetail.tsx';
import { InteractiveTimeline } from '../components/InteractiveTimeline.tsx';
import { RawLogs } from '../components/RawLogs.tsx';
import { EngineSelect } from './ImportView.tsx';
import { VideoView } from './VideoView.tsx';

const LEVEL_ICON: Record<Level, 'user' | 'shield' | 'terminal'> = { layman: 'user', analyst: 'shield', senior: 'terminal' };

export function visibleEvents(level: Level, events: TimelineEvent[]) {
  if (level === 'layman') return events.filter((e) => e.key);
  if (level === 'analyst') return events.filter((e) => e.key || e.severity !== 'info');
  return events;
}

export function TimelineView({ c, status, onUpdate }: { c: CaseSummary; status: Status | null; onUpdate: () => void }) {
  const [level, setLevel] = useState<Level>(() => (localStorage.getItem('sv.level') as Level) || 'layman');
  const [mode, setMode] = useState<'interactive' | 'video'>('interactive');
  const [selected, setSelected] = useState<string | null>(null);
  const [viewWin, setViewWin] = useState<[number, number] | null>(null);
  const [tab, setTab] = useState<'story' | 'logs'>('story');
  const [engine, setEngine] = useState('auto');
  const inc = c.incident;

  useEffect(() => localStorage.setItem('sv.level', level), [level]);
  const events = useMemo(() => (inc ? visibleEvents(level, inc.events) : []), [inc, level]);
  const sel = inc?.events.find((e) => e.id === selected) ?? null;

  // keyboard: ← → step through the story
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (mode !== 'interactive' || !events.length || (ev.target as HTMLElement)?.tagName === 'INPUT') return;
      const i = events.findIndex((e) => e.id === selected);
      if (ev.key === 'ArrowRight') setSelected(events[Math.min(events.length - 1, i + 1)].id);
      if (ev.key === 'ArrowLeft') setSelected(events[Math.max(0, i - 1)].id);
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [events, selected, mode]);

  if (c.analysis.state === 'running' || c.analysis.state === 'idle') {
    return (
      <div className="page center-col">
        <div className="analyzing">
          <div className="spinner" />
          <h2>Reconstructing the attack…</h2>
          <p className="muted">{c.analysis.message || 'Queued'}</p>
          <div className="progress"><div style={{ width: `${Math.round(c.analysis.progress * 100)}%` }} /></div>
          <div className="muted small">{c.recordCount.toLocaleString()} records from {c.sources.length} sources: {c.sources.map((s) => `${s.name} (${s.format})`).join(', ')}</div>
          {c.analysis.state === 'idle' && <button className="btn primary" onClick={() => api.analyze(c.id, engine).then(onUpdate)}>Run analysis</button>}
        </div>
      </div>
    );
  }
  if (!inc) {
    return (
      <div className="page center-col">
        <div className="analyzing">
          <Icon name="alert" size={36} color="#ef4444" />
          <h2>Analysis failed</h2>
          <p className="muted">{c.analysis.error}</p>
          <button className="btn primary" onClick={() => api.analyze(c.id, engine).then(onUpdate)}>Retry</button>
        </div>
      </div>
    );
  }

  const story = inc.stories[level];
  const phases = [...new Set(inc.events.map((e) => e.phase))];
  const hosts = inc.assets.filter((a) => a.compromisedAt != null);

  return (
    <div className="timeline-page">
      {/* ---------- incident header ---------- */}
      <div className="inc-head">
        <div className="inc-title">
          <span className="sev-tag" style={{ background: SEV_COLOR[inc.severity] }}>{inc.severity}</span>
          <h1>{level === 'layman' ? story.title : inc.title}</h1>
        </div>
        <p className="lead">{inc.summary}</p>
        <div className="inc-meta">
          <span><Icon name="clock" size={14} /> {fmtDate(inc.startTs)} · {fmtClock(inc.startTs)} → {fmtClock(inc.endTs)} UTC</span>
          <span><Icon name="laptop" size={14} /> {hosts.length} host{hosts.length === 1 ? '' : 's'} compromised</span>
          <span><Icon name="list" size={14} /> {inc.events.length} events · {inc.stats.flagged} evidence lines / {inc.stats.records.toLocaleString()} records</span>
          <span className={`engine ${inc.engine}`}><Icon name="sparkles" size={14} /> {inc.engine === 'claude' ? `Analyzed by ${inc.model}` : 'Offline rule engine'}</span>
          <span className="reanalyze">
            <EngineSelect engine={engine} setEngine={setEngine} status={status} />
            <button className="btn ghost sm" onClick={() => api.analyze(c.id, engine).then(onUpdate)}>Re-analyze</button>
          </span>
        </div>
        {c.analysis.error && <div className="warnbox"><Icon name="alert" size={14} /> {c.analysis.error}</div>}
        <div className="killchain">
          {PHASES.filter((p) => phases.includes(p.id)).map((p, i) => (
            <span key={p.id} className="kc-step" style={{ ['--c' as string]: PHASE_COLOR[p.id] }}>
              <Icon name={PHASE_ICON[p.id]} size={13} /> {level === 'layman' ? p.plain : p.label}
              {i < phases.length - 1 && <Icon name="chevron-right" size={12} />}
            </span>
          ))}
        </div>
      </div>

      {/* ---------- controls ---------- */}
      <div className="controls">
        <div className="levels">
          {LEVELS.map((l) => (
            <button key={l.id} className={`level ${level === l.id ? 'on' : ''}`} style={{ ['--accent' as string]: LEVEL_ACCENT[l.id] }} onClick={() => setLevel(l.id)}>
              <Icon name={LEVEL_ICON[l.id]} size={18} />
              <span><b>{l.label}</b><small>{l.blurb}</small></span>
            </button>
          ))}
        </div>
        <div className="seg big">
          <button className={mode === 'interactive' ? 'on' : ''} onClick={() => setMode('interactive')}><Icon name="layers" size={16} /> Interactive timeline</button>
          <button className={mode === 'video' ? 'on' : ''} onClick={() => setMode('video')}><Icon name="film" size={16} /> Video</button>
        </div>
      </div>

      {mode === 'video' ? (
        <VideoView c={c} level={level} status={status} />
      ) : (
        <>
          <InteractiveTimeline c={c} level={level} events={events} selected={selected} onSelect={setSelected} onWindow={setViewWin} />
          <div className="bottom">
            <div className="panel">
              <div className="tabs">
                <button className={tab === 'story' ? 'on' : ''} onClick={() => setTab('story')}><Icon name="list" size={14} /> Story ({events.length})</button>
                <button className={tab === 'logs' ? 'on' : ''} onClick={() => setTab('logs')}><Icon name="terminal" size={14} /> Raw logs in view</button>
              </div>
              {tab === 'story' ? (
                <div className="story">
                  <div className="story-intro">{story.scenes[0]?.narration}</div>
                  {events.map((e, i) => (
                    <button key={e.id} className={`story-item ${e.id === selected ? 'on' : ''}`} onClick={() => setSelected(e.id)} style={{ ['--c' as string]: PHASE_COLOR[e.phase] }}>
                      <span className="si-rail"><span className="si-dot"><Icon name={PHASE_ICON[e.phase]} size={13} /></span>{i < events.length - 1 && <span className="si-line" />}</span>
                      <span className="si-body">
                        <span className="si-time">{fmtClock(e.ts)}{level !== 'layman' && e.technique ? ` · ${e.technique.id}` : ''}</span>
                        <span className="si-title">{e.narratives[level].title}</span>
                        {e.id === selected && <span className="si-text">{e.narratives[level].text}</span>}
                      </span>
                    </button>
                  ))}
                  <div className="story-recs">
                    <b>{story.scenes.find((s) => s.kind === 'actions')?.heading ?? 'Next steps'}</b>
                    <ol>{story.recommendations.map((r) => <li key={r}>{r}</li>)}</ol>
                  </div>
                </div>
              ) : (
                <RawLogs caseId={c.id} window={viewWin} incident={inc} />
              )}
            </div>
            <EventDetail caseId={c.id} event={sel} level={level} incident={inc} events={events} onSelect={setSelected} />
          </div>
        </>
      )}
    </div>
  );
}
