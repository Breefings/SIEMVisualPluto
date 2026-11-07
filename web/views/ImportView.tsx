import { useEffect, useRef, useState } from 'react';
import type { CaseSummary, Status } from '../../shared/types.ts';
import { Icon } from '../../shared/Icon.tsx';
import { api, type Sample } from '../api.ts';

const SAMPLE_TITLE: Record<string, string> = {
  'operation-nightfall': 'Operation Nightfall',
  'ssh-cryptominer': 'SSH brute force → cryptominer',
};


export function ImportView({ status, onCase }: { status: Status | null; onCase: (c: CaseSummary) => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [engine, setEngine] = useState('auto');
  const [samples, setSamples] = useState<Sample[]>([]);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.samples().then(setSamples).catch(() => {});
  }, []);

  const add = (list: FileList | null) => list && setFiles((f) => [...f, ...Array.from(list)].filter((x, i, a) => a.findIndex((y) => y.name === x.name) === i));

  const submit = async () => {
    setBusy(true);
    setErr('');
    try {
      onCase(await api.upload(files, engine));
      setFiles([]);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const loadSample = async (id: string) => {
    setBusy(true);
    setErr('');
    try {
      onCase(await api.sample(id, engine));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Import logs</h1>
        </div>
      </div>

      <div className="grid-2">
        <section className="card">
          <div
            className={`dropzone ${drag ? 'drag' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); add(e.dataTransfer.files); }}
            onClick={() => input.current?.click()}
          >
            <input ref={input} type="file" multiple hidden onChange={(e) => add(e.target.files)} />
            <div className="drop-icon"><Icon name="upload" size={28} /></div>
            <div className="drop-title">Drop log files</div>
            <div className="muted small">CSV · JSON · syslog · txt</div>
          </div>

          {files.length > 0 && (
            <div className="file-list">
              {files.map((f) => (
                <div key={f.name} className="file-row">
                  <Icon name="file" size={15} />
                  <span className="grow">{f.name}</span>
                  <span className="muted small">{(f.size / 1024).toFixed(1)} KB</span>
                  <button className="icon-btn" onClick={() => setFiles((x) => x.filter((y) => y !== f))}><Icon name="x" size={14} /></button>
                </div>
              ))}
            </div>
          )}

          <div className="row gap wrap" style={{ marginTop: 16 }}>
            <EngineSelect engine={engine} setEngine={setEngine} status={status} />
            <button className="btn primary" disabled={!files.length || busy} onClick={submit}>
              <Icon name="sparkles" size={16} /> {busy ? 'Uploading…' : `Analyze ${files.length || ''} file${files.length === 1 ? '' : 's'}`}
            </button>
          </div>
          {err && <div className="error">{err}</div>}
        </section>

        <section className="card">
          <h3><Icon name="play" size={16} /> Samples</h3>
          <div className="sample-list">
            {samples.map((s) => {
              return (
                <button key={s.id} className="sample" disabled={busy} onClick={() => loadSample(s.id)}>
                  <div className="sample-title">{SAMPLE_TITLE[s.id] ?? s.id}<Icon name="chevron-right" size={16} /></div>
                  <div className="muted small">{s.files.length} log sources</div>
                </button>
              );
            })}
          </div>
        </section>
      </div>

    </div>
  );
}

export function EngineSelect({ engine, setEngine, status }: { engine: string; setEngine: (e: string) => void; status: Status | null }) {
  return (
    <div className="seg">
      {[
        ['auto', 'Auto'],
        ['claude', 'Claude AI'],
        ['heuristic', 'Offline rules'],
      ].map(([id, label]) => (
        <button key={id} className={engine === id ? 'on' : ''} onClick={() => setEngine(id)} disabled={id === 'claude' && !status?.claude} title={id === 'claude' && !status?.claude ? 'Set ANTHROPIC_API_KEY to enable' : ''}>
          {label}
        </button>
      ))}
    </div>
  );
}
