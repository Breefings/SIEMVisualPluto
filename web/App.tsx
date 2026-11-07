import { useCallback, useEffect, useState } from 'react';
import type { CaseSummary, Status } from '../shared/types.ts';
import { Icon } from '../shared/Icon.tsx';
import { SEV_COLOR } from '../shared/theme.ts';
import { api } from './api.ts';
import { Halftone } from './components/Halftone.tsx';
import { AggregateView } from './views/AggregateView.tsx';
import { ImportView } from './views/ImportView.tsx';
import { TimelineView } from './views/TimelineView.tsx';

export type View = 'import' | 'aggregate' | 'timeline';

export function App() {
  const [view, setView] = useState<View>('import');
  const [status, setStatus] = useState<Status | null>(null);
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(() => localStorage.getItem('sv.case'));

  const refresh = useCallback(() => api.cases().then(setCases).catch(() => {}), []);
  useEffect(() => {
    api.status().then(setStatus).catch(() => {});
    refresh();
  }, [refresh]);
  useEffect(() => {
    if (activeId) localStorage.setItem('sv.case', activeId);
  }, [activeId]);

  const active = cases.find((c) => c.id === activeId) ?? null;

  // poll while any analysis is running
  useEffect(() => {
    if (!cases.some((c) => c.analysis.state === 'running')) return;
    const t = setInterval(refresh, 700);
    return () => clearInterval(t);
  }, [cases, refresh]);

  const openCase = (c: CaseSummary) => {
    setCases((cs) => [c, ...cs.filter((x) => x.id !== c.id)]);
    setActiveId(c.id);
    setView('timeline');
  };

  return (
    <div className="app">
      <Halftone />
      <header className="topbar">
        <div className="brand">
          <div className="logo" aria-hidden><span>S</span><span>I</span><span>E</span><span>M</span></div>
          <span className="brand-name"><b>SIEM</b>Visual</span>
        </div>
        <div className="grow" />
        <div className="status-pills">
          <span className={`pill ${status?.claude ? 'ok' : 'warn'}`} title={status?.claude ? 'Claude analyzes your logs' : 'Set ANTHROPIC_API_KEY to enable Claude; the offline rule engine is used meanwhile'}>
            <Icon name="sparkles" size={13} /> {status ? (status.claude ? status.model : 'Offline engine') : '…'}
          </span>
          <span className={`pill ${status?.tts.engine === 'piper' ? 'ok' : 'warn'}`} title="Open-source neural text-to-speech (Piper)">
            <Icon name="signal" size={13} /> {status ? (status.tts.engine === 'piper' ? 'Piper TTS' : 'No TTS') : '…'}
          </span>
        </div>
      </header>

      <nav className="sidebar">
        <NavItem icon="upload" label="Import" active={view === 'import'} onClick={() => setView('import')} />
        <NavItem icon="plug" label="Connect" active={view === 'aggregate'} onClick={() => setView('aggregate')} />
        <NavItem icon="film" label="Timeline" active={view === 'timeline'} onClick={() => setView('timeline')} disabled={!active} />

        <div className="side-section">Cases</div>
        <div className="case-list">
          {cases.length === 0 && <div className="muted small pad">No cases yet</div>}
          {cases.map((c) => (
            <button key={c.id} className={`case-item ${c.id === activeId ? 'active' : ''}`} onClick={() => { setActiveId(c.id); setView('timeline'); }}>
              <span className="sev-dot" style={{ background: c.incident ? SEV_COLOR[c.incident.severity] : '#55575e' }} />
              <span className="case-text">
                <span className="case-name">{c.incident?.title && c.analysis.state === 'done' ? c.incident.title : c.name}</span>
                <span className="case-meta">
                  {c.analysis.state === 'running' ? `${Math.round(c.analysis.progress * 100)}%` : `${c.recordCount.toLocaleString()} records`}
                </span>
              </span>
              <span className="case-del" title="Delete case" onClick={(e) => { e.stopPropagation(); api.remove(c.id).then(refresh); if (c.id === activeId) setActiveId(null); }}>
                <Icon name="trash" size={13} />
              </span>
            </button>
          ))}
        </div>
      </nav>

      <main className="main">
        {view === 'import' && <ImportView status={status} onCase={openCase} />}
        {view === 'aggregate' && <AggregateView onCase={openCase} />}
        {view === 'timeline' && (active ? <TimelineView key={active.id} c={active} status={status} onUpdate={refresh} /> : <Empty onGo={() => setView('import')} />)}
      </main>
    </div>
  );
}

function NavItem({ icon, label, active, onClick, badge, disabled }: { icon: Parameters<typeof Icon>[0]['name']; label: string; active: boolean; onClick: () => void; badge?: string; disabled?: boolean }) {
  return (
    <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick} disabled={disabled}>
      <span className="nav-icon"><Icon name={icon} size={18} /></span>
      <span className="nav-text"><span>{label}</span></span>
      {badge && <span className="badge">{badge}</span>}
    </button>
  );
}

function Empty({ onGo }: { onGo: () => void }) {
  return (
    <div className="empty">
      <Icon name="film" size={40} />
      <button className="btn primary" onClick={onGo}>Import logs</button>
    </div>
  );
}
