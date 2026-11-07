#!/usr/bin/env node
/**
 * SeenVisualizer agent: records hardware utilization on this machine and serves it (plus the
 * machine's own event logs) to the SeenVisualizer server when asked. Zero dependencies, Node >= 18.
 *
 *   node seen-agent.mjs [--port 9870] [--interval 5] [--retention 72] [--data ./seen-agent-data] [--token X]
 *
 * Every <interval> seconds it samples CPU, RAM, swap, GPU, disk usage per volume, disk read/write
 * throughput and network throughput; every 30 s it also records the top CPU processes. Samples are
 * kept in memory and appended to daily JSONL files so history survives restarts.
 *
 * HTTP (all endpoints need `Authorization: Bearer <token>`; the token is generated on first start
 * and printed, and stored in <data>/token.txt):
 *   GET /health                     -> status
 *   GET /metrics?since=<ms>&until=<ms> -> samples
 *   GET /logs?since=<ms>            -> Windows event logs (Get-WinEvent) or the systemd journal
 */
import { execFile, spawn } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '1.0.0';
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]?.startsWith('--') ? 'true' : all[i + 1] ?? 'true']] : acc), []),
);
const PORT = Number(args.port ?? process.env.SEEN_AGENT_PORT ?? 9870);
const INTERVAL = Math.max(1, Number(args.interval ?? 5));
const RETENTION_H = Number(args.retention ?? 72);
const DATA = path.resolve(args.data ?? process.env.SEEN_AGENT_DATA ?? path.join(path.dirname(fileURLToPath(import.meta.url)), 'seen-agent-data'));
const WIN = process.platform === 'win32';
const LINUX = process.platform === 'linux';

fs.mkdirSync(DATA, { recursive: true });
const tokenFile = path.join(DATA, 'token.txt');
const TOKEN = args.token ?? process.env.SEEN_AGENT_TOKEN ?? (fs.existsSync(tokenFile) ? fs.readFileSync(tokenFile, 'utf8').trim() : (() => {
  const t = randomBytes(18).toString('base64url');
  fs.writeFileSync(tokenFile, t, { mode: 0o600 });
  return t;
})());

// ---------------------------------------------------------------------------
// history
// ---------------------------------------------------------------------------
/** @type {any[]} */
const samples = [];
const dayFile = (t) => path.join(DATA, `samples-${new Date(t).toISOString().slice(0, 10)}.jsonl`);
function loadHistory() {
  const cutoff = Date.now() - RETENTION_H * 3600_000;
  for (const f of fs.readdirSync(DATA).filter((f) => /^samples-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort()) {
    const day = Date.parse(f.slice(8, 18));
    if (day + 86400_000 < cutoff) { fs.rmSync(path.join(DATA, f), { force: true }); continue; }
    for (const l of fs.readFileSync(path.join(DATA, f), 'utf8').split('\n')) {
      try { const s = JSON.parse(l); if (s.t >= cutoff) samples.push(s); } catch { /* partial line */ }
    }
  }
}
function record(s) {
  samples.push(s);
  const cutoff = Date.now() - RETENTION_H * 3600_000;
  while (samples.length && samples[0].t < cutoff) samples.shift();
  fs.appendFile(dayFile(s.t), JSON.stringify(s) + '\n', () => {});
}

// ---------------------------------------------------------------------------
// CPU / memory
// ---------------------------------------------------------------------------
let lastCpu = os.cpus().map((c) => c.times);
function cpuPercent() {
  const now = os.cpus().map((c) => c.times);
  let idle = 0, total = 0;
  now.forEach((t, i) => {
    const p = lastCpu[i] ?? t;
    const d = (k) => t[k] - p[k];
    idle += d('idle');
    total += d('user') + d('nice') + d('sys') + d('idle') + d('irq');
  });
  lastCpu = now;
  return total > 0 ? round(100 * (1 - idle / total), 1) : 0;
}
function memory() {
  if (LINUX) {
    try {
      const m = Object.fromEntries(fs.readFileSync('/proc/meminfo', 'utf8').split('\n').map((l) => l.split(/:\s+/)).filter((x) => x.length === 2).map(([k, v]) => [k, parseInt(v, 10) * 1024]));
      return { used: m.MemTotal - m.MemAvailable, total: m.MemTotal, swapUsed: m.SwapTotal - m.SwapFree, swapTotal: m.SwapTotal };
    } catch { /* fall through */ }
  }
  return { used: os.totalmem() - os.freemem(), total: os.totalmem() };
}

// ---------------------------------------------------------------------------
// disks (usage)
// ---------------------------------------------------------------------------
let mounts = [];
let mountsAt = 0;
function listMounts() {
  if (Date.now() - mountsAt < 60_000) return mounts;
  mountsAt = Date.now();
  if (WIN) {
    mounts = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((l) => `${l}:\\`).filter((m) => { try { fs.statfsSync(m); return true; } catch { return false; } });
  } else {
    try {
      const seen = new Set();
      mounts = fs.readFileSync('/proc/mounts', 'utf8').split('\n').map((l) => l.split(' ')).filter(([dev, mnt, type]) => dev?.startsWith('/dev/') && !/loop|ram/.test(dev) && !/squashfs|iso9660/.test(type) && !seen.has(dev) && seen.add(dev)).map(([, mnt]) => mnt.replace(/\\040/g, ' '));
    } catch { mounts = ['/']; }
  }
  return mounts;
}
function disks() {
  return listMounts().flatMap((m) => {
    try {
      const s = fs.statfsSync(m);
      const total = s.blocks * s.bsize;
      return total ? [{ mount: m, used: (s.blocks - s.bfree) * s.bsize, total }] : [];
    } catch { return []; }
  });
}

// ---------------------------------------------------------------------------
// throughput (disk io, network): Linux via /proc counters, Windows via a long-running typeperf
// ---------------------------------------------------------------------------
let lastIo = null;
function linuxCounters() {
  let r = 0, w = 0, rx = 0, tx = 0;
  try {
    for (const l of fs.readFileSync('/proc/diskstats', 'utf8').split('\n')) {
      const f = l.trim().split(/\s+/);
      if (f.length < 10 || !/^(sd[a-z]+|vd[a-z]+|xvd[a-z]+|hd[a-z]+|nvme\d+n\d+|mmcblk\d+)$/.test(f[2])) continue;
      r += Number(f[5]) * 512;
      w += Number(f[9]) * 512;
    }
  } catch { /* none */ }
  try {
    for (const l of fs.readFileSync('/proc/net/dev', 'utf8').split('\n').slice(2)) {
      const [name, rest] = l.split(':');
      if (!rest || name.trim() === 'lo') continue;
      const f = rest.trim().split(/\s+/);
      rx += Number(f[0]);
      tx += Number(f[8]);
    }
  } catch { /* none */ }
  return { t: Date.now(), r, w, rx, tx };
}
function linuxRates() {
  const now = linuxCounters();
  const p = lastIo;
  lastIo = now;
  if (!p) return { io: { read: 0, write: 0 }, net: { rx: 0, tx: 0 } };
  const dt = Math.max(0.001, (now.t - p.t) / 1000);
  const rate = (a, b) => Math.max(0, Math.round((a - b) / dt));
  return { io: { read: rate(now.r, p.r), write: rate(now.w, p.w) }, net: { rx: rate(now.rx, p.rx), tx: rate(now.tx, p.tx) } };
}

/** typeperf streams one CSV row per interval; we keep the latest summed values per counter class. */
const perf = { read: 0, write: 0, rx: 0, tx: 0, gpu3d: null };
function typeperf(counters, onRow, restartEveryMs) {
  let child;
  const start = () => {
    child = spawn('typeperf', [...counters, '-si', String(INTERVAL)], { windowsHide: true });
    let header = null, buf = '';
    child.stdout.on('data', (d) => {
      buf += d.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      for (const l of lines) {
        if (!l.startsWith('"')) continue;
        const cols = l.slice(1, -1).split('","');
        if (cols[0].startsWith('(PDH-CSV')) { header = cols; continue; }
        if (header) onRow(header, cols.map((c) => Number(c.replace(',', '.')) || 0));
      }
    });
    child.on('error', () => {});
    child.on('exit', () => setTimeout(start, 5000));
  };
  start();
  if (restartEveryMs) setInterval(() => child?.kill(), restartEveryMs).unref();
}
function startWindowsPerf() {
  typeperf(['\\PhysicalDisk(_Total)\\Disk Read Bytes/sec', '\\PhysicalDisk(_Total)\\Disk Write Bytes/sec', '\\Network Interface(*)\\Bytes Received/sec', '\\Network Interface(*)\\Bytes Sent/sec'], (h, v) => {
    const sum = (re) => Math.round(h.reduce((a, name, i) => (re.test(name) ? a + v[i] : a), 0));
    perf.read = sum(/Disk Read Bytes/i);
    perf.write = sum(/Disk Write Bytes/i);
    perf.rx = sum(/Bytes Received/i);
    perf.tx = sum(/Bytes Sent/i);
  });
}

// ---------------------------------------------------------------------------
// GPU: nvidia-smi when present, AMD sysfs on Linux, Windows GPU-engine counters otherwise
// ---------------------------------------------------------------------------
let gpus = [];
function startGpu() {
  const smi = spawn('nvidia-smi', ['--query-gpu=name,utilization.gpu,memory.used,memory.total', '--format=csv,noheader,nounits', '-l', String(INTERVAL)], { windowsHide: true });
  let buf = '', ok = false;
  smi.stdout.on('data', (d) => {
    ok = true;
    buf += d.toString();
    const lines = buf.split(/\r?\n/);
    buf = lines.pop();
    const fresh = lines.map((l) => l.split(',').map((x) => x.trim())).filter((f) => f.length === 4).map(([name, util, used, total]) => ({ name, util: +util, memUsed: +used * 1048576, memTotal: +total * 1048576 }));
    if (fresh.length) gpus = fresh;
  });
  smi.on('error', fallback);
  smi.on('exit', () => { if (!ok) fallback(); });
  let fellBack = false;
  function fallback() {
    if (fellBack) return;
    fellBack = true;
    if (WIN) {
      typeperf(['\\GPU Engine(*engtype_3D)\\Utilization Percentage'], (h, v) => {
        perf.gpu3d = Math.min(100, round(v.slice(1).reduce((a, b) => a + b, 0), 1));
      }, 10 * 60_000); // restart now and then so new processes' GPU engines are counted
    }
  }
}
function gpuNow() {
  if (gpus.length) return gpus;
  if (LINUX) {
    try {
      return fs.readdirSync('/sys/class/drm').filter((c) => /^card\d+$/.test(c)).flatMap((c) => {
        const p = `/sys/class/drm/${c}/device/gpu_busy_percent`;
        if (!fs.existsSync(p)) return [];
        const rd = (f) => { try { return Number(fs.readFileSync(`/sys/class/drm/${c}/device/${f}`, 'utf8')); } catch { return undefined; } };
        return [{ name: c, util: rd('gpu_busy_percent'), memUsed: rd('mem_info_vram_used'), memTotal: rd('mem_info_vram_total') }];
      });
    } catch { return []; }
  }
  return perf.gpu3d != null ? [{ name: 'GPU (3D engine)', util: perf.gpu3d }] : [];
}

// ---------------------------------------------------------------------------
// top processes (every 30 s)
// ---------------------------------------------------------------------------
let lastProc = new Map();
let lastProcAt = 0;
let topCache = null;
function linuxTop() {
  const now = Date.now();
  const cur = new Map();
  for (const pid of fs.readdirSync('/proc').filter((p) => /^\d+$/.test(p))) {
    try {
      const st = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      const name = st.slice(st.indexOf('(') + 1, st.lastIndexOf(')'));
      const f = st.slice(st.lastIndexOf(')') + 2).split(' ');
      cur.set(pid, { name, ticks: Number(f[11]) + Number(f[12]), rss: Number(f[21]) * 4096 });
    } catch { /* exited */ }
  }
  const dt = (now - lastProcAt) / 1000;
  const cores = os.cpus().length;
  const top = lastProcAt ? [...cur].map(([pid, p]) => ({ pid: Number(pid), name: p.name, cpu: round(((p.ticks - (lastProc.get(pid)?.ticks ?? p.ticks)) / 100 / dt / cores) * 100, 1), mem: p.rss })) : [];
  lastProc = cur;
  lastProcAt = now;
  return top.sort((a, b) => b.cpu - a.cpu).slice(0, 5);
}
function windowsTop() {
  execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command',
    "Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Where-Object { $_.Name -notin '_Total','Idle' } | Sort-Object PercentProcessorTime -Descending | Select-Object -First 5 Name,IDProcess,PercentProcessorTime,WorkingSetPrivate | ConvertTo-Json -Compress"],
  { windowsHide: true, timeout: 20_000 }, (err, out) => {
    if (err) return;
    try {
      const cores = os.cpus().length;
      const arr = [].concat(JSON.parse(out));
      topCache = arr.map((p) => ({ pid: p.IDProcess, name: p.Name, cpu: round(p.PercentProcessorTime / cores, 1), mem: Number(p.WorkingSetPrivate) }));
    } catch { /* ignore */ }
  });
}

// ---------------------------------------------------------------------------
const round = (x, d = 0) => Math.round(x * 10 ** d) / 10 ** d;
let ticks = 0;
function sample() {
  const t = Date.now();
  const rates = WIN ? { io: { read: perf.read, write: perf.write }, net: { rx: perf.rx, tx: perf.tx } } : linuxRates();
  const s = { t, cpu: cpuPercent(), mem: memory(), disks: disks(), ...rates, gpu: gpuNow() };
  if (LINUX) s.load = os.loadavg().map((x) => round(x, 2));
  const every = Math.max(1, Math.round(30 / INTERVAL));
  if (ticks++ % every === 0) {
    if (LINUX) s.top = linuxTop();
    else if (WIN) { if (topCache) s.top = topCache; windowsTop(); }
  }
  record(s);
}

// ---------------------------------------------------------------------------
// event logs served on demand
// ---------------------------------------------------------------------------
function winEventScript(since, maxPerLog = 3000) {
  return `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$since = [DateTimeOffset]::FromUnixTimeMilliseconds(${Math.floor(since)}).LocalDateTime
$logs = @('Security','System','Application','Microsoft-Windows-Sysmon/Operational','Microsoft-Windows-PowerShell/Operational','Microsoft-Windows-Windows Defender/Operational','Microsoft-Windows-TerminalServices-LocalSessionManager/Operational')
foreach ($l in $logs) {
  Get-WinEvent -FilterHashtable @{ LogName = $l; StartTime = $since } -MaxEvents ${maxPerLog} -ErrorAction SilentlyContinue | ForEach-Object {
    $e = $_
    $o = [ordered]@{ timestamp = $e.TimeCreated.ToUniversalTime().ToString('o'); host = $env:COMPUTERNAME; channel = $l; event_id = $e.Id; level = $e.LevelDisplayName; provider = $e.ProviderName }
    try { $x = [xml]$e.ToXml(); foreach ($d in $x.Event.EventData.Data) { if ($d.Name -and -not $o.Contains($d.Name)) { $o[$d.Name] = [string]$d.InnerText } } } catch {}
    $m = $e.Message
    if ($m) { $o['message'] = ((($m -split "\`r?\`n") | Where-Object { $_.Trim() }) | Select-Object -First 3) -join ' ' }
    ConvertTo-Json -InputObject ([pscustomobject]$o) -Compress -Depth 2
  }
}
`;
}
function logs(since, until) {
  return new Promise((resolve) => {
    if (WIN) {
      const enc = Buffer.from(winEventScript(since), 'utf16le').toString('base64');
      execFile('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc], { windowsHide: true, maxBuffer: 200 * 1024 * 1024, timeout: 120_000 },
        (err, out, errOut) => resolve({ kind: 'winevent', text: out ?? '', error: err && !out ? String(errOut || err.message).slice(0, 300) : undefined }));
    } else if (LINUX) {
      execFile('journalctl', ['--no-pager', '-o', 'json', '--since', `@${Math.floor(since / 1000)}`, '--until', `@${Math.ceil(until / 1000)}`, '-n', '20000'], { maxBuffer: 200 * 1024 * 1024, timeout: 120_000 },
        (err, out, errOut) => resolve({ kind: 'journal', text: out ?? '', error: err && !out ? String(errOut || err.message).slice(0, 300) : undefined }));
    } else resolve({ kind: 'none', text: '' });
  });
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
function authorized(req) {
  const h = req.headers.authorization ?? '';
  const given = Buffer.from(h.startsWith('Bearer ') ? h.slice(7) : new URL(req.url, 'http://x').searchParams.get('token') ?? '');
  const want = Buffer.from(TOKEN);
  return given.length === want.length && timingSafeEqual(given, want);
}
const send = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (!authorized(req)) return send(res, 401, { error: 'bad or missing token' });
  const since = Number(url.searchParams.get('since') ?? Date.now() - 3600_000);
  const until = Number(url.searchParams.get('until') ?? Date.now());
  if (url.pathname === '/health')
    return send(res, 200, { ok: true, version: VERSION, host: os.hostname(), platform: process.platform, os: `${os.type()} ${os.release()}`, cores: os.cpus().length, cpuModel: os.cpus()[0]?.model, intervalSec: INTERVAL, samples: samples.length, oldest: samples[0]?.t ?? null });
  if (url.pathname === '/metrics')
    return send(res, 200, { host: os.hostname(), platform: process.platform, cores: os.cpus().length, cpuModel: os.cpus()[0]?.model, intervalSec: INTERVAL, samples: samples.filter((s) => s.t >= since && s.t <= until) });
  if (url.pathname === '/logs') return send(res, 200, { host: os.hostname(), ...(await logs(since, until)) });
  send(res, 404, { error: 'not found' });
});

loadHistory();
if (WIN) startWindowsPerf();
startGpu();
sample();
setInterval(sample, INTERVAL * 1000);
server.listen(PORT, '0.0.0.0', () => {
  console.log(`SeenVisualizer agent ${VERSION} on ${os.hostname()} - listening on :${PORT}, sampling every ${INTERVAL}s, keeping ${RETENTION_H}h`);
  console.log(`Data: ${DATA}`);
  console.log(`Token: ${TOKEN}   (paste this into the agent source on the Connect page)`);
});
