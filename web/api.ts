import type { CaseSummary, Level, LogRecord, Scene, Status } from '../shared/types.ts';

async function j<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? res.statusText);
  return body as T;
}

export interface Histogram { from: number; to: number; buckets: number[][]; flags: number[]; sources: string[] }
export interface RenderJob { state: 'none' | 'running' | 'done' | 'error'; progress: number; message: string; url?: string; error?: string }
export interface Integration { id: string; name: string; desc: string; status: string }
export interface Sample { id: string; files: { name: string; bytes: number }[] }

export const api = {
  status: () => fetch('/api/status').then((r) => j<Status>(r)),
  samples: () => fetch('/api/samples').then((r) => j<Sample[]>(r)),
  integrations: () => fetch('/api/integrations').then((r) => j<Integration[]>(r)),
  cases: () => fetch('/api/cases').then((r) => j<CaseSummary[]>(r)),
  get: (id: string) => fetch(`/api/cases/${id}`).then((r) => j<CaseSummary>(r)),
  remove: (id: string) => fetch(`/api/cases/${id}`, { method: 'DELETE' }).then((r) => j<{ ok: boolean }>(r)),
  upload: (files: File[], engine: string, name?: string) => {
    const fd = new FormData();
    files.forEach((f) => fd.append('files', f));
    fd.append('engine', engine);
    if (name) fd.append('name', name);
    return fetch('/api/cases', { method: 'POST', body: fd }).then((r) => j<CaseSummary>(r));
  },
  sample: (name: string, engine: string) =>
    fetch(`/api/cases/sample/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ engine }) }).then((r) => j<CaseSummary>(r)),
  analyze: (id: string, engine: string) =>
    fetch(`/api/cases/${id}/analyze`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ engine }) }).then((r) => j<CaseSummary>(r)),
  records: (id: string, q: { from?: number; to?: number; ids?: number[]; q?: string; host?: string; limit?: number }) => {
    const p = new URLSearchParams();
    if (q.from != null) p.set('from', String(Math.floor(q.from)));
    if (q.to != null) p.set('to', String(Math.ceil(q.to)));
    if (q.ids) p.set('ids', q.ids.join(','));
    if (q.q) p.set('q', q.q);
    if (q.host) p.set('host', q.host);
    if (q.limit) p.set('limit', String(q.limit));
    return fetch(`/api/cases/${id}/records?${p}`).then((r) => j<{ total: number; records: LogRecord[] }>(r));
  },
  histogram: (id: string, from: number, to: number, buckets: number) =>
    fetch(`/api/cases/${id}/histogram?from=${Math.floor(from)}&to=${Math.ceil(to)}&buckets=${buckets}`).then((r) => j<Histogram>(r)),
  narrate: (id: string, level: Level) => fetch(`/api/cases/${id}/narrate/${level}`, { method: 'POST' }).then((r) => j<{ scenes: Scene[]; tts: boolean }>(r)),
  render: (id: string, level: Level) => fetch(`/api/cases/${id}/render/${level}`, { method: 'POST' }).then((r) => j<RenderJob>(r)),
  renderStatus: (id: string, level: Level) => fetch(`/api/cases/${id}/render/${level}`).then((r) => j<RenderJob>(r)),
};
