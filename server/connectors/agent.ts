/** SIEMVisual agent: hardware-utilization history + the host's own event logs, pulled over HTTP. */
import type { SourceConfig } from '../../shared/sources.ts';
import { httpJson, iso, journalToText, jsonl, normalizeWinEvents, portOf, slug, type Collected, type Window } from './util.ts';

interface Sample {
  t: number;
  cpu: number;
  load?: number[];
  mem: { used: number; total: number; swapUsed?: number; swapTotal?: number };
  disks: { mount: string; used: number; total: number }[];
  io: { read: number; write: number };
  net: { rx: number; tx: number };
  gpu: { name: string; util?: number; memUsed?: number; memTotal?: number }[];
  top?: { pid: number; name: string; cpu: number; mem: number }[];
}

const opts = (s: SourceConfig) => ({ headers: { Authorization: `Bearer ${s.token ?? ''}` }, timeoutMs: 120_000 });
const GB = (b: number) => (b / 1073741824).toFixed(1);
const rate = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB/s` : `${Math.round(b / 1024)} KB/s`);
const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : 0);

export async function testAgent(s: SourceConfig): Promise<string> {
  const h = await httpJson<{ version: string; host: string; os: string; samples: number; oldest: number | null; intervalSec: number }>(s.host, portOf(s), '/health', opts(s));
  const hours = h.oldest ? ((Date.now() - h.oldest) / 3600_000).toFixed(1) : '0';
  return `Agent ${h.version} on ${h.host} (${h.os}) · ${h.samples.toLocaleString()} samples covering ${hours} h`;
}

/** One record per minute: peaks (what matters for spotting abuse) plus averages. */
function toMinuteRecords(samples: Sample[], host: string) {
  const byMin = new Map<number, Sample[]>();
  for (const s of samples) {
    const m = Math.floor(s.t / 60_000) * 60_000;
    (byMin.get(m) ?? byMin.set(m, []).get(m)!).push(s);
  }
  const rows: object[] = [];
  for (const [m, ss] of [...byMin].sort((a, b) => a[0] - b[0])) {
    const last = ss[ss.length - 1];
    const cpuMax = Math.max(...ss.map((s) => s.cpu));
    const cpuAvg = ss.reduce((a, s) => a + s.cpu, 0) / ss.length;
    const memMax = Math.max(...ss.map((s) => s.mem.used));
    const read = Math.max(...ss.map((s) => s.io?.read ?? 0));
    const write = Math.max(...ss.map((s) => s.io?.write ?? 0));
    const rx = Math.max(...ss.map((s) => s.net?.rx ?? 0));
    const tx = Math.max(...ss.map((s) => s.net?.tx ?? 0));
    const gpu = Math.max(-1, ...ss.flatMap((s) => s.gpu.map((g) => g.util ?? -1)));
    const top = [...ss].reverse().find((s) => s.top?.length)?.top?.filter((p) => p.cpu >= 1).slice(0, 3);
    const ramPct = pct(memMax, last.mem.total);
    const fullest = [...last.disks].sort((a, b) => b.used / b.total - a.used / a.total)[0];
    const parts = [
      `cpu=${Math.round(cpuMax)}% (avg ${Math.round(cpuAvg)}%)`,
      `ram=${GB(memMax)}/${GB(last.mem.total)} GB (${ramPct}%)`,
      last.mem.swapTotal ? `swap=${GB(last.mem.swapUsed ?? 0)}/${GB(last.mem.swapTotal)} GB` : '',
      gpu >= 0 ? `gpu=${Math.round(gpu)}%` : '',
      ...last.disks.map((d) => `disk ${d.mount}=${pct(d.used, d.total)}% (${GB(d.used)}/${GB(d.total)} GB)`),
      `read=${rate(read)} write=${rate(write)}`,
      `net rx=${rate(rx)} tx=${rate(tx)}`,
      top?.length ? `top: ${top.map((p) => `${p.name} ${p.cpu}%`).join(', ')}` : '',
    ].filter(Boolean);
    const hot = cpuMax >= 90 || ramPct >= 95 || (fullest && pct(fullest.used, fullest.total) >= 95);
    rows.push({
      timestamp: iso(m), host, process: top?.[0]?.name ?? 'seen-agent', action: 'metrics',
      level: hot ? 'warning' : 'info', message: parts.join(' '),
      cpu: Math.round(cpuMax), ram_pct: ramPct, gpu: gpu >= 0 ? Math.round(gpu) : undefined, disk_read_bps: read, disk_write_bps: write, net_rx_bps: rx, net_tx_bps: tx,
    });
  }
  return rows;
}

export async function collectAgent(s: SourceConfig, w: Window): Promise<Collected> {
  const port = portOf(s);
  const m = await httpJson<{ host: string; platform: string; samples: Sample[] }>(s.host, port, `/metrics?since=${w.since}&until=${w.until}`, opts(s));
  const host = m.host || s.name;
  const files: Collected['files'] = [];
  const notes: string[] = [];
  const metrics = toMinuteRecords(m.samples, host.split('.')[0]);
  files.push({ name: `agent-${slug(host)}-hardware.jsonl`, text: jsonl(metrics) });
  notes.push(`${m.samples.length.toLocaleString()} hardware samples → ${metrics.length} one-minute records`);
  if (!m.samples.length) notes.push('The agent has no samples in this window (was it running then?).');

  try {
    const l = await httpJson<{ kind: string; text: string; error?: string }>(s.host, port, `/logs?since=${w.since}&until=${w.until}`, opts(s));
    if (l.kind === 'winevent') {
      const rows = normalizeWinEvents(l.text, w);
      files.push({ name: `agent-${slug(host)}-events.jsonl`, text: jsonl(rows) });
      notes.push(`${rows.length} Windows events`);
    } else if (l.kind === 'journal') {
      const j = journalToText(l.text, host);
      files.push({ name: `agent-${slug(host)}-journal.log`, text: j.text });
      notes.push(`${j.lines} journal lines`);
    }
    if (l.error) notes.push(`Event logs: ${l.error}`);
  } catch (e: any) {
    notes.push(`Event logs unavailable: ${e.message}`);
  }
  return { files, notes };
}
