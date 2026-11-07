import { useEffect, useMemo, useState } from 'react';
import type { Incident, LogRecord } from '../../shared/types.ts';
import { Icon } from '../../shared/Icon.tsx';
import { fmtClockSec } from '../../shared/theme.ts';
import { api } from '../api.ts';

/** Raw log explorer for the time window currently visible on the timeline. */
export function RawLogs({ caseId, window: win, incident }: { caseId: string; window: [number, number] | null; incident: Incident }) {
  const [q, setQ] = useState('');
  const [onlyEvidence, setOnlyEvidence] = useState(false);
  const [data, setData] = useState<{ total: number; records: LogRecord[] } | null>(null);
  const flagged = useMemo(() => new Set(incident.events.flatMap((e) => e.evidence)), [incident]);

  useEffect(() => {
    if (!win) return;
    const t = setTimeout(() => {
      api.records(caseId, { from: win[0], to: win[1], q: q || undefined, limit: 400, ids: onlyEvidence ? [...flagged] : undefined }).then(setData).catch(() => {});
    }, 200);
    return () => clearTimeout(t);
  }, [caseId, win, q, onlyEvidence, flagged]);

  return (
    <div className="rawlogs">
      <div className="row gap">
        <div className="search"><Icon name="search" size={14} /><input placeholder="Filter lines in view…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <label className="check"><input type="checkbox" checked={onlyEvidence} onChange={(e) => setOnlyEvidence(e.target.checked)} /> evidence only</label>
      </div>
      <div className="muted small" style={{ margin: '6px 0' }}>
        {data ? `${data.total.toLocaleString()} lines in the visible window${data.total > data.records.length ? ` (showing first ${data.records.length}; zoom in for fewer)` : ''}` : 'Loading…'}
      </div>
      <div className="loglines tall">
        {data?.records.map((r) => (
          <div key={r.id} className={`logline ${flagged.has(r.id) ? 'flag' : ''}`}>
            <span className="ll-meta">{fmtClockSec(r.ts)} · {r.source}{r.host ? ` · ${r.host}` : ''}</span>
            <span className="ll-raw">{r.raw}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
