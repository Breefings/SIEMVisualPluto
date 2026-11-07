import { useEffect, useState } from 'react';
import type { Incident, Level, LogRecord, TimelineEvent } from '../../shared/types.ts';
import { PHASES } from '../../shared/types.ts';
import { Icon } from '../../shared/Icon.tsx';
import { fmtClockSec, fmtDate, PHASE_COLOR, PHASE_ICON, SEV_COLOR } from '../../shared/theme.ts';
import { api } from '../api.ts';

export function EventDetail({ caseId, event, level, incident, events, onSelect }: { caseId: string; event: TimelineEvent | null; level: Level; incident: Incident; events: TimelineEvent[]; onSelect: (id: string) => void }) {
  const [logs, setLogs] = useState<LogRecord[]>([]);
  const [showLogs, setShowLogs] = useState(level === 'senior');
  useEffect(() => setShowLogs(level === 'senior'), [level]);
  useEffect(() => {
    setLogs([]);
    if (event?.evidence.length) api.records(caseId, { ids: event.evidence, limit: 50 }).then((r) => setLogs(r.records)).catch(() => {});
  }, [caseId, event]);

  if (!event) {
    const first = events[0];
    return (
      <div className="panel detail empty-detail">
        <Icon name="chevron-left" size={22} />
        <h3>Pick an event</h3>
        <p className="muted">Click a marker on the timeline or a step in the story. Use ← → to walk through the attack.</p>
        {first && <button className="btn primary" onClick={() => onSelect(first.id)}><Icon name="play" size={14} /> Start at the beginning</button>}
      </div>
    );
  }

  const n = event.narratives[level];
  const phase = PHASES.find((p) => p.id === event.phase)!;
  const col = PHASE_COLOR[event.phase];
  const idx = events.findIndex((e) => e.id === event.id);
  const asset = (id?: string) => incident.assets.find((a) => a.id === id);
  const hostLabel = (id?: string) => (id ? (level === 'layman' ? asset(id)?.friendly ?? id : id) : '');

  return (
    <div className="panel detail" style={{ ['--c' as string]: col }}>
      <div className="detail-nav">
        <button className="icon-btn" disabled={idx <= 0} onClick={() => onSelect(events[idx - 1].id)}><Icon name="chevron-left" size={16} /></button>
        <span className="muted small">{idx >= 0 ? `Step ${idx + 1} of ${events.length}` : 'Not in this view'}</span>
        <button className="icon-btn" disabled={idx < 0 || idx >= events.length - 1} onClick={() => onSelect(events[idx + 1].id)}><Icon name="chevron-right" size={16} /></button>
      </div>
      <div className="detail-phase">
        <span className="phase-chip"><Icon name={PHASE_ICON[event.phase]} size={14} /> {level === 'layman' ? phase.plain : phase.label}</span>
        {level !== 'layman' && <span className="sev" style={{ color: SEV_COLOR[event.severity] }}>{event.severity}</span>}
        {level === 'senior' && <span className="muted small">confidence {Math.round(event.confidence * 100)}%</span>}
      </div>
      <div className="detail-time">{fmtClockSec(event.ts)}{event.endTs ? ` → ${fmtClockSec(event.endTs)}` : ''} <span className="muted small">{fmtDate(event.ts)} UTC</span></div>
      <h2 className="detail-title">{n.title}</h2>
      <p className="detail-text">{n.text}</p>

      <div className="facts">
        {event.fromHost ? (
          <Fact icon="share" k="Movement" v={`${hostLabel(event.fromHost)} → ${hostLabel(event.toHost)}`} />
        ) : event.host ? (
          <Fact icon="laptop" k={level === 'layman' ? 'Computer' : 'Host'} v={hostLabel(event.host)} />
        ) : null}
        {event.user && <Fact icon="user" k={level === 'layman' ? 'Account' : 'User'} v={event.user} />}
        {level !== 'layman' && event.technique && <Fact icon="shield" k="ATT&CK" v={`${event.technique.id} · ${event.technique.name}`} href={`https://attack.mitre.org/techniques/${event.technique.id.replace('.', '/')}/`} />}
      </div>

      {level !== 'layman' && event.iocs && event.iocs.length > 0 && (
        <div className="iocs">
          <div className="sub">Indicators of compromise</div>
          {event.iocs.map((i) => <code key={i} className="ioc" onClick={() => navigator.clipboard?.writeText(i)} title="Copy">{i}</code>)}
        </div>
      )}

      <div className="evidence">
        <button className="sub link" onClick={() => setShowLogs((s) => !s)}>
          <Icon name="terminal" size={13} /> {level === 'layman' ? 'Show the original log lines' : `Evidence (${event.evidence.length} log lines)`} <Icon name={showLogs ? 'chevron-left' : 'chevron-right'} size={12} />
        </button>
        {showLogs && (
          <div className="loglines">
            {logs.map((r) => (
              <div key={r.id} className="logline">
                <span className="ll-meta">#{r.id} · {fmtClockSec(r.ts)} · {r.source}</span>
                <span className="ll-raw">{r.raw}</span>
              </div>
            ))}
            {!logs.length && <div className="muted small">Loading…</div>}
          </div>
        )}
      </div>
    </div>
  );
}

function Fact({ icon, k, v, href }: { icon: 'laptop' | 'user' | 'shield' | 'share'; k: string; v: string; href?: string }) {
  return (
    <div className="fact">
      <Icon name={icon} size={14} />
      <span className="muted small">{k}</span>
      {href ? <a href={href} target="_blank" rel="noreferrer">{v}</a> : <b>{v}</b>}
    </div>
  );
}
