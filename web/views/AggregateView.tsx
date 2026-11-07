import { useEffect, useState, type ReactNode } from 'react';
import { Icon } from '../../shared/Icon.tsx';
import { defaultPort, kindInfo, KINDS, type PublicSource, type SourceKind, type SourceReport, type Via } from '../../shared/sources.ts';
import type { CaseSummary } from '../../shared/types.ts';
import { api, type SourceInput } from '../api.ts';

const WINDOWS = [
  { h: 1, label: '1 h' },
  { h: 6, label: '6 h' },
  { h: 24, label: '24 h' },
  { h: 72, label: '3 d' },
  { h: 168, label: '7 d' },
];

interface Draft {
  kind: SourceKind;
  name: string;
  host: string;
  port: string;
  via: Via;
  tls: boolean;
  insecure: boolean;
  username: string;
  password: string;
  privateKey: string;
  token: string;
  sudo: boolean;
}

const blank = (kind: SourceKind): Draft => ({
  kind, name: '', host: '', port: '', via: 'api', tls: false, insecure: kind === 'kubernetes', username: '', password: '', privateKey: '', token: '', sudo: false,
});

const fromSource = (s: PublicSource): Draft => ({
  kind: s.kind, name: s.name, host: s.host, port: s.port ? String(s.port) : '', via: s.via ?? 'api', tls: !!s.tls, insecure: !!s.insecure,
  username: s.username ?? '', password: '', privateKey: '', token: '', sudo: !!s.sudo,
});

export function AggregateView({ onCase }: { onCase: (c: CaseSummary) => void }) {
  const [sources, setSources] = useState<PublicSource[]>([]);
  const [editing, setEditing] = useState<{ id?: string; draft: Draft } | null>(null);
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [err, setErr] = useState('');
  const [hours, setHours] = useState(24);
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [collecting, setCollecting] = useState(false);
  const [result, setResult] = useState<{ reports: SourceReport[]; case?: CaseSummary; error?: string } | null>(null);

  const refresh = () => api.sources().then(setSources).catch((e) => setErr(e.message));
  useEffect(() => {
    refresh();
  }, []);

  const picked = selected ?? new Set(sources.filter((s) => s.enabled).map((s) => s.id));
  const toggle = (id: string) => {
    const n = new Set(picked);
    n.has(id) ? n.delete(id) : n.add(id);
    setSelected(n);
  };
  const mark = (id: string, what?: string) => setBusy((b) => { const n = { ...b }; if (what) n[id] = what; else delete n[id]; return n; });

  const test = async (id: string) => {
    mark(id, 'Testing…');
    try {
      await api.testSource(id);
    } finally {
      mark(id);
      refresh();
    }
  };

  const save = async (andTest: boolean) => {
    if (!editing) return;
    const d = editing.draft;
    const info = kindInfo(d.kind);
    const body: SourceInput = {
      kind: d.kind, name: d.name, host: d.host.trim(), port: d.port ? Number(d.port) : undefined,
      via: d.kind === 'docker' ? d.via : undefined,
      tls: info.fields.includes('tls') ? d.tls : undefined,
      insecure: info.fields.includes('insecure') ? d.insecure : undefined,
      sudo: info.fields.includes('sudo') ? d.sudo : undefined,
      username: info.fields.includes('username') ? d.username : undefined,
      password: d.password || undefined, privateKey: d.privateKey || undefined, token: d.token || undefined,
    };
    setErr('');
    try {
      const s = await api.saveSource(body, editing.id);
      setEditing(null);
      await refresh();
      if (andTest) await test(s.id);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const remove = async (s: PublicSource) => {
    if (!confirm(`Remove ${s.name}? Its saved credentials are deleted too.`)) return;
    await api.removeSource(s.id);
    refresh();
  };

  const enableLogging = async (s: PublicSource) => {
    if (!confirm(`This changes ${s.name}'s configuration: 2 MB log buffer, DNS query logging, WAN firewall logging and connection byte counters, then restarts log, dnsmasq and firewall services (a few seconds of interruption). Continue?`)) return;
    mark(s.id, 'Configuring…');
    try {
      const r = await api.openwrtLogging(s.id);
      alert(r.detail);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      mark(s.id);
    }
  };

  const collect = async () => {
    setCollecting(true);
    setResult(null);
    try {
      const r = await api.collect([...picked], hours, 'auto');
      setResult(r);
    } catch (e) {
      setResult({ reports: (e as { reports?: SourceReport[] }).reports ?? [], error: (e as Error).message });
    } finally {
      setCollecting(false);
      refresh();
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Connect</h1>
          <p className="lead">Pull logs straight from your machines: containers, clusters, the router, the hypervisor and every Windows and Linux host. Then read them as one timeline.</p>
        </div>
      </div>

      <h3><Icon name="plug" size={14} /> Sources</h3>
      <div className="sources">
        {sources.map((s) => {
          const info = kindInfo(s.kind);
          const state = busy[s.id] ? 'busy' : s.lastTest ? (s.lastTest.ok ? 'ok' : 'bad') : 'idle';
          return (
            <div key={s.id} className={`src ${picked.has(s.id) ? 'on' : ''}`}>
              <div className="src-head">
                <label className="check" title="Include in the next collection">
                  <input type="checkbox" checked={picked.has(s.id)} onChange={() => toggle(s.id)} />
                </label>
                <div className="int-icon"><Icon name={info.icon} size={16} /></div>
                <div className="src-title">
                  <b>{s.name}</b>
                  <span className="src-kind">{info.label}{s.kind === 'docker' ? (s.via === 'ssh' ? ' · SSH' : ' · API') : ''}</span>
                </div>
                <span className={`dot ${state}`} title={state} />
              </div>
              <div className="src-addr mono">{s.username && s.kind !== 'kubernetes' && s.kind !== 'agent' && (s.kind !== 'docker' || s.via === 'ssh') ? `${s.username}@` : ''}{s.host}:{s.port || defaultPort(s)}</div>
              <div className={`src-status small ${state}`}>{busy[s.id] ?? s.lastTest?.detail ?? 'Not tested yet'}</div>
              <div className="src-actions">
                <button className="btn sm" onClick={() => test(s.id)} disabled={!!busy[s.id]}>Test</button>
                <button className="btn sm" onClick={() => setEditing({ id: s.id, draft: fromSource(s) })}>Edit</button>
                {s.kind === 'openwrt' && <button className="btn sm" onClick={() => enableLogging(s)} disabled={!!busy[s.id]} title="Turn on DNS-query, firewall and connection logging on the router">Enable traffic logging</button>}
                <button className="icon-btn sm" onClick={() => remove(s)} title="Remove"><Icon name="trash" size={13} /></button>
              </div>
            </div>
          );
        })}
        {!editing && (
          <button className="src add" onClick={() => setEditing({ draft: blank('linux') })}>
            <span className="drop-icon"><Icon name="plug" size={20} /></span>
            <b>Add a source</b>
            <span className="small muted">Docker · Kubernetes · OpenWrt · Proxmox · Windows · Linux · Agent</span>
          </button>
        )}
      </div>

      {editing && <SourceForm editing={editing} setEditing={setEditing} onSave={save} onCancel={() => { setEditing(null); setErr(''); }} />}
      {err && <div className="error">{err}</div>}

      <h3 style={{ marginTop: 44 }}><Icon name="clock" size={14} /> Collect</h3>
      <div className="collect card">
        <div className="row gap wrap">
          <span className="sub muted">Time window · last</span>
          <div className="seg">
            {WINDOWS.map((w) => <button key={w.h} className={hours === w.h ? 'on' : ''} onClick={() => setHours(w.h)}>{w.label}</button>)}
          </div>
          <div className="grow" />
          <button className="btn primary" onClick={collect} disabled={collecting || !picked.size}>
            <Icon name="download" size={14} /> {collecting ? 'Collecting…' : `Collect from ${picked.size} source${picked.size === 1 ? '' : 's'}`}
          </button>
        </div>
        {collecting && <div className="progress indeterminate"><div /></div>}
        {result && (
          <div className="reports">
            {result.reports.map((r) => (
              <div key={r.id} className={`report ${r.ok ? 'ok' : 'bad'}`}>
                <span className={`dot ${r.ok ? 'ok' : 'bad'}`} />
                <div className="grow-col">
                  <b>{r.name}</b> <span className="muted small mono">{(r.ms / 1000).toFixed(1)} s</span>
                  {r.ok ? (
                    <div className="small muted">
                      {r.notes.map((n, i) => <div key={i}>{n}</div>)}
                      <div className="mono">{r.files.map((f) => `${f.name} (${f.lines.toLocaleString()})`).join(' · ') || 'no files'}</div>
                    </div>
                  ) : (
                    <div className="small bad-text">{r.error}</div>
                  )}
                </div>
              </div>
            ))}
            {result.error && <div className="error">{result.error}</div>}
            {result.case && (
              <div className="row gap" style={{ marginTop: 18 }}>
                <span className="muted">{result.case.recordCount.toLocaleString()} records from {result.case.sources.length} files · analysis running</span>
                <div className="grow" />
                <button className="btn primary" onClick={() => onCase(result.case!)}><Icon name="film" size={14} /> Open timeline</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SourceForm({ editing, setEditing, onSave, onCancel }: {
  editing: { id?: string; draft: Draft };
  setEditing: (e: { id?: string; draft: Draft }) => void;
  onSave: (andTest: boolean) => void;
  onCancel: () => void;
}) {
  const d = editing.draft;
  const info = kindInfo(d.kind);
  const has = (f: string) => info.fields.includes(f as never);
  const set = (p: Partial<Draft>) => setEditing({ ...editing, draft: { ...d, ...p } });
  const sshAuth = has('username') && (d.kind !== 'docker' || d.via === 'ssh');
  const port = defaultPort({ kind: d.kind, via: d.via, tls: d.tls });

  return (
    <div className="card src-form">
      <div className="kinds">
        {KINDS.map((k) => (
          <button key={k.kind} className={`kind ${d.kind === k.kind ? 'on' : ''}`} onClick={() => !editing.id && set({ ...blank(k.kind), name: d.name, host: d.host })} disabled={!!editing.id && d.kind !== k.kind}>
            <Icon name={k.icon} size={18} />
            <span>{k.label}</span>
          </button>
        ))}
      </div>
      <p className="muted small what"><b>Collects:</b> {info.what}</p>

      <div className="form-grid">
        <Field label="Name"><input value={d.name} placeholder={`${info.label} ${d.host || ''}`.trim()} onChange={(e) => set({ name: e.target.value })} /></Field>
        <Field label="IP address / hostname"><input className="mono" value={d.host} placeholder="192.168.1.20" onChange={(e) => set({ host: e.target.value })} autoFocus /></Field>
        <Field label="Port"><input className="mono" value={d.port} placeholder={`${port} (default)`} onChange={(e) => set({ port: e.target.value.replace(/\D/g, '') })} /></Field>
        {has('via') && (
          <Field label="Connect via">
            <div className="seg">
              <button className={d.via === 'api' ? 'on' : ''} onClick={() => set({ via: 'api' })}>Engine API</button>
              <button className={d.via === 'ssh' ? 'on' : ''} onClick={() => set({ via: 'ssh' })}>SSH</button>
            </div>
          </Field>
        )}
        {sshAuth && <Field label="SSH user"><input className="mono" value={d.username} placeholder={info.defaultUser ?? 'root'} onChange={(e) => set({ username: e.target.value })} /></Field>}
        {sshAuth && has('password') && (
          <Field label="Password"><input type="password" value={d.password} placeholder={editing.id ? 'unchanged' : ''} onChange={(e) => set({ password: e.target.value })} /></Field>
        )}
        {has('token') && (
          <Field label={d.kind === 'agent' ? 'Agent token' : 'Bearer token'}><input type="password" className="mono" value={d.token} placeholder={editing.id ? 'unchanged' : d.kind === 'agent' ? 'printed by the agent on start' : 'service-account token'} onChange={(e) => set({ token: e.target.value })} /></Field>
        )}
        {sshAuth && has('privateKey') && (
          <Field label="Private key (optional)" wide>
            <textarea className="mono" rows={3} value={d.privateKey} placeholder={editing.id ? 'unchanged' : '-----BEGIN OPENSSH PRIVATE KEY-----'} onChange={(e) => set({ privateKey: e.target.value })} />
          </Field>
        )}
      </div>

      <div className="row gap wrap opts">
        {has('tls') && d.via !== 'ssh' && <label className="check"><input type="checkbox" checked={d.tls} onChange={(e) => set({ tls: e.target.checked })} /> TLS (https)</label>}
        {has('insecure') && (d.kind !== 'docker' || (d.tls && d.via !== 'ssh')) && <label className="check"><input type="checkbox" checked={d.insecure} onChange={(e) => set({ insecure: e.target.checked })} /> Accept self-signed certificate</label>}
        {has('sudo') && (d.kind !== 'docker' || d.via === 'ssh') && <label className="check"><input type="checkbox" checked={d.sudo} onChange={(e) => set({ sudo: e.target.checked })} /> Use sudo</label>}
      </div>

      <div className="warnbox setup"><Icon name="alert" size={14} /> <span>{info.setup}</span></div>
      {d.kind === 'agent' && (
        <div className="agent-help small">
          <a className="btn sm" href="/api/agent/seen-agent.mjs" download><Icon name="download" size={13} /> Download agent</a>
          <code>node seen-agent.mjs</code> <span className="muted">needs Node 18+ · listens on :9870 · see agent/README.md for running it as a service</span>
        </div>
      )}

      <div className="row gap" style={{ marginTop: 22 }}>
        <button className="btn primary" onClick={() => onSave(true)} disabled={!d.host.trim()}>Save &amp; test</button>
        <button className="btn" onClick={() => onSave(false)} disabled={!d.host.trim()}>Save</button>
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`field ${wide ? 'wide' : ''}`}>
      <span className="sub">{label}</span>
      {children}
    </label>
  );
}
