/** Transport helpers (HTTP(S), SSH) and log normalizers shared by the connectors. */
import http from 'node:http';
import https from 'node:https';
import { Client, type ConnectConfig } from 'ssh2';
import { defaultPort, type SourceConfig } from '../../shared/sources.ts';

export interface Collected {
  /** Files handed to the normal parser, exactly as if the user had uploaded them. */
  files: { name: string; text: string }[];
  notes: string[];
}

export interface Window {
  since: number; // epoch ms
  until: number;
}

export const MAX_LINES = 20_000;
export const portOf = (s: SourceConfig) => s.port || defaultPort(s);
export const slug = (s: string) => s.replace(/[^\w.-]+/g, '_').slice(0, 60) || 'source';
export const iso = (ms: number) => new Date(ms).toISOString();
export const jsonl = (rows: object[]) => rows.map((r) => JSON.stringify(r)).join('\n');
const sq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
export { sq as shellQuote };

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
export interface HttpOpts {
  https?: boolean;
  insecure?: boolean;
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxBytes?: number;
}

export function httpGet(host: string, port: number, path: string, o: HttpOpts = {}): Promise<{ status: number; body: Buffer; headers: http.IncomingHttpHeaders }> {
  const lib = o.https ? https : http;
  const max = o.maxBytes ?? 30 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    const req = lib.request(
      { host, port, path, method: 'GET', headers: o.headers, timeout: o.timeoutMs ?? 15_000, ...(o.https ? { rejectUnauthorized: !o.insecure } : {}) },
      (res) => {
        const chunks: Buffer[] = [];
        let n = 0;
        res.on('data', (c: Buffer) => {
          n += c.length;
          if (n <= max) chunks.push(c);
          else res.destroy(); // keep what we have
        });
        const done = () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks), headers: res.headers });
        res.on('end', done);
        res.on('close', done);
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error(`timed out talking to ${host}:${port}`)));
    req.on('error', (e: NodeJS.ErrnoException) => reject(new Error(netError(e, host, port))));
    req.end();
  });
}

export async function httpJson<T>(host: string, port: number, path: string, o: HttpOpts = {}): Promise<T> {
  const r = await httpGet(host, port, path, o);
  if (r.status === 401 || r.status === 403) throw new Error(`HTTP ${r.status}: access denied (check the token / permissions)`);
  if (r.status >= 400) throw new Error(`HTTP ${r.status} for ${path}: ${r.body.toString('utf8').slice(0, 200)}`);
  return JSON.parse(r.body.toString('utf8')) as T;
}

export function netError(e: NodeJS.ErrnoException, host: string, port: number) {
  if (e.code === 'ECONNREFUSED') return `connection refused at ${host}:${port} (is the service listening on that port?)`;
  if (e.code === 'ETIMEDOUT' || e.code === 'EHOSTUNREACH' || e.code === 'ENETUNREACH') return `${host}:${port} is unreachable`;
  if (e.code === 'ENOTFOUND') return `unknown host ${host}`;
  if (e.code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || e.code === 'SELF_SIGNED_CERT_IN_CHAIN' || e.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE')
    return `${host} uses a self-signed certificate (tick "accept self-signed certificate")`;
  return e.message;
}

// ---------------------------------------------------------------------------
// SSH
// ---------------------------------------------------------------------------
export interface Ssh {
  /** Run a command; resolves with stdout even on a non-zero exit (stderr is kept for errors). */
  run(cmd: string, maxBytes?: number): Promise<{ out: string; err: string; code: number | null }>;
}

export function withSsh<T>(s: SourceConfig, fn: (ssh: Ssh) => Promise<T>): Promise<T> {
  const conn = new Client();
  const cfg: ConnectConfig = {
    host: s.host,
    port: portOf(s),
    username: s.username || 'root',
    readyTimeout: 12_000,
    keepaliveInterval: 10_000,
    tryKeyboard: true,
  };
  if (s.privateKey?.trim()) cfg.privateKey = s.privateKey.trim();
  if (s.password) cfg.password = s.password;
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (f: () => void) => {
      if (settled) return;
      settled = true;
      f();
      conn.end();
    };
    conn.on('keyboard-interactive', (_n, _i, _l, prompts, reply) => reply(prompts.map(() => s.password ?? '')));
    conn.on('error', (e: NodeJS.ErrnoException) =>
      finish(() => reject(new Error(/authentication/i.test(e.message) ? `SSH login to ${s.username || 'root'}@${s.host} was rejected (check user / password / key)` : netError(e, s.host, portOf(s))))));
    conn.on('ready', () => {
      const ssh: Ssh = {
        run: (cmd, maxBytes = 40 * 1024 * 1024) =>
          new Promise((res, rej) => {
            conn.exec(cmd, (err, stream) => {
              if (err) return rej(err);
              const out: Buffer[] = [];
              const errb: Buffer[] = [];
              let n = 0;
              stream.on('data', (c: Buffer) => {
                n += c.length;
                if (n <= maxBytes) out.push(c);
              });
              stream.stderr.on('data', (c: Buffer) => errb.length < 200 && errb.push(c));
              stream.on('close', (code: number | null) => res({ out: Buffer.concat(out).toString('utf8'), err: Buffer.concat(errb).toString('utf8'), code }));
            });
          }),
      };
      fn(ssh).then((v) => finish(() => resolve(v)), (e) => finish(() => reject(e)));
    });
    conn.connect(cfg);
  });
}

export const sudo = (s: SourceConfig, cmd: string) => (s.sudo ? `sudo -n ${cmd}` : cmd);

// ---------------------------------------------------------------------------
// Normalizers. Text lines use "<ISO> <host> <message>" so the regular text parser
// extracts IPs/users/kv fields the same way it does for uploaded logs.
// ---------------------------------------------------------------------------
const PRIO = ['emerg', 'alert', 'crit', 'err', 'warning', 'notice', 'info', 'debug'];
const hostTok = (h: string) => (h || 'unknown').replace(/\s+/g, '-');

/** `journalctl -o json` output → "<ISO> <host> <ident>[pid]: <msg>" lines. */
export function journalToText(out: string, fallbackHost: string): { text: string; lines: number } {
  const lines: string[] = [];
  for (const l of out.split('\n')) {
    if (!l.startsWith('{')) continue;
    try {
      const j = JSON.parse(l);
      const us = Number(j.__REALTIME_TIMESTAMP);
      if (!us) continue;
      let msg = j.MESSAGE;
      if (Array.isArray(msg)) msg = Buffer.from(msg).toString('utf8');
      if (msg == null) continue;
      const ident = j.SYSLOG_IDENTIFIER || j._COMM || 'journal';
      const pid = j._PID || j.SYSLOG_PID;
      const lvl = PRIO[Number(j.PRIORITY)] ?? '';
      const sev = lvl && Number(j.PRIORITY) <= 3 ? ` level=${lvl}` : '';
      lines.push(`${iso(us / 1000)} ${hostTok(j._HOSTNAME || fallbackHost)} ${ident}${pid ? `[${pid}]` : ''}: ${String(msg).replace(/\s*\n\s*/g, ' ')}${sev}`);
    } catch {
      /* skip */
    }
  }
  return { text: lines.slice(-MAX_LINES).join('\n'), lines: Math.min(lines.length, MAX_LINES) };
}

/** journalctl with a time window, falling back to sudo when the account can't read the system journal. */
export function journalCmd(s: SourceConfig, w: Window, extra = '') {
  const base = `journalctl --no-pager -o json --since @${Math.floor(w.since / 1000)} --until @${Math.ceil(w.until / 1000)} ${extra} | tail -n ${MAX_LINES}`;
  return s.sudo ? `sudo -n sh -c ${sq(base)}` : base;
}

/** `ss -Htunp state established` → firewall-style kv lines (same shape as the uploaded firewall logs). */
export function ssToText(out: string, host: string, at: number): string[] {
  const lines: string[] = [];
  for (const l of out.split('\n')) {
    const m = l.trim().match(/^(tcp|udp)\s+\d+\s+\d+\s+(\S+):(\d+|\*)\s+(\S+):(\d+|\*)\s*(.*)$/);
    if (!m) continue;
    const [, proto, la, lp, ra, rp, rest] = m;
    const clean = (a: string) => a.replace(/^\[|\]$/g, '').replace(/^::ffff:/, '');
    if (/^(127\.|::1$)/.test(clean(ra))) continue;
    const proc = rest.match(/"([^"]+)",pid=(\d+)/);
    lines.push(`${iso(at)} ${hostTok(host)} kernel: ACTION=ESTABLISHED SRC=${clean(la)} DST=${clean(ra)} PROTO=${proto.toUpperCase()} SPT=${lp} DPT=${rp}${proc ? ` PROC=${proc[1]} PID=${proc[2]}` : ''} NOTE=socket-snapshot`);
  }
  return lines;
}
export const SS_CMD = 'ss -Htunp state established 2>/dev/null || ss -Htun state established 2>/dev/null';

/** Docker/Kubernetes "<RFC3339Nano> message" lines → JSONL rows. */
export function stampedLines(text: string, extra: Record<string, unknown>, w: Window): object[] {
  const rows: object[] = [];
  for (const l of text.split('\n')) {
    const m = l.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})\s?(.*)$/);
    if (!m) continue;
    const ts = Date.parse(`${m[1]}${(m[2] ?? '').slice(0, 4)}${m[3]}`);
    if (isNaN(ts) || ts < w.since || ts > w.until) continue;
    const msg = m[4].trim();
    if (!msg) continue;
    rows.push({ timestamp: iso(ts), ...extra, message: msg.slice(0, 2000) });
  }
  return rows.slice(-MAX_LINES);
}

/** Map Windows EventData names onto the field names the detection rules use. */
export function winEventAliases(row: Record<string, any>) {
  if (row.CommandLine && !row.command_line) row.command_line = row.CommandLine;
  if (!row.image && (row.Image || row.NewProcessName)) row.image = row.Image || row.NewProcessName;
  if (!row.parent_image && (row.ParentImage || row.ParentProcessName)) row.parent_image = row.ParentImage || row.ParentProcessName;
  if (!row.user && (row.TargetUserName || row.User || row.SubjectUserName)) row.user = row.TargetUserName || row.User || row.SubjectUserName;
  if (!row.srcip && row.IpAddress && row.IpAddress !== '-') row.srcip = row.IpAddress;
  if (row.event_id === 1 && /sysmon/i.test(row.channel ?? '')) row.event = 'ProcessCreate';
  return row;
}

/** PowerShell that dumps Windows event logs since `since` (epoch ms) as one JSON object per line. */
export function winEventScript(since: number, maxPerLog = 3000) {
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

/** Turn JSONL produced by winEventScript into parser-ready JSONL (aliases applied, window enforced). */
export function normalizeWinEvents(out: string, w: Window): object[] {
  const rows: object[] = [];
  for (const l of out.split('\n')) {
    const t = l.trim();
    if (!t.startsWith('{')) continue;
    try {
      const r = JSON.parse(t);
      const ts = Date.parse(r.timestamp);
      if (isNaN(ts) || ts < w.since || ts > w.until) continue;
      rows.push(winEventAliases(r));
    } catch {
      /* skip */
    }
  }
  return rows.slice(-MAX_LINES * 2);
}
