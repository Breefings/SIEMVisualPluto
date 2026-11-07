/**
 * Universal log parser. Turns CSV / TSV / JSON / JSONL / syslog / web access
 * logs / key=value / free-text logs into normalized LogRecords.
 */
import type { LogRecord, Severity } from '../shared/types.ts';

type Draft = Omit<LogRecord, 'id'> & { noYear?: boolean };

const MON: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;

// ---------------------------------------------------------------------------
// timestamps
// ---------------------------------------------------------------------------
const RE_ISO = /(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2}(?:[.,]\d+)?)(Z|[+-]\d{2}:?\d{2})?/;
const RE_CLF = /\[(\d{2})\/(\w{3})\/(\d{4}):(\d{2}:\d{2}:\d{2})(?: ([+-]\d{4}))?\]/;
const RE_SYSLOG = /^(\w{3})\s+(\d{1,2})\s+(\d{2}:\d{2}:\d{2})/;
const RE_US = /(\d{1,2})\/(\d{1,2})\/(\d{4})[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i;

/** Parse a timestamp string. Naive timestamps are treated as UTC. */
export function parseTime(s: string | number | undefined | null): number | null {
  if (s == null || s === '') return null;
  if (typeof s === 'number') return s > 1e12 ? s : s > 1e9 ? s * 1000 : null;
  const str = String(s).trim();
  if (/^\d{10}(\.\d+)?$/.test(str)) return Math.round(parseFloat(str) * 1000);
  if (/^\d{13}$/.test(str)) return parseInt(str, 10);
  let m = str.match(RE_ISO);
  if (m) {
    const tz = m[3] ? (m[3] === 'Z' ? 'Z' : m[3].length === 5 ? m[3].slice(0, 3) + ':' + m[3].slice(3) : m[3]) : 'Z';
    const ms = Date.parse(`${m[1]}T${m[2].replace(',', '.')}${tz}`);
    if (!isNaN(ms)) return ms;
  }
  m = str.match(RE_CLF);
  if (m) {
    const tz = m[5] ? m[5].slice(0, 3) + ':' + m[5].slice(3) : 'Z';
    const mon = String((MON[m[2].toLowerCase()] ?? 0) + 1).padStart(2, '0');
    const ms = Date.parse(`${m[3]}-${mon}-${m[1]}T${m[4]}${tz}`);
    if (!isNaN(ms)) return ms;
  }
  m = str.match(RE_US);
  if (m) {
    let h = parseInt(m[4], 10);
    if (m[7]) h = (h % 12) + (m[7].toUpperCase() === 'PM' ? 12 : 0);
    return Date.UTC(+m[3], +m[1] - 1, +m[2], h, +m[5], +(m[6] ?? 0));
  }
  const d = Date.parse(str);
  return isNaN(d) ? null : d;
}

function syslogTime(line: string): number | null {
  const m = line.match(RE_SYSLOG);
  if (!m || MON[m[1].toLowerCase()] === undefined) return null;
  const [hh, mm, ss] = m[3].split(':').map(Number);
  return Date.UTC(2000, MON[m[1].toLowerCase()], +m[2], hh, mm, ss); // year fixed later
}

// ---------------------------------------------------------------------------
// field mapping for structured logs
// ---------------------------------------------------------------------------
const KEYS = {
  ts: ['@timestamp', 'timestamp', 'time', 'timecreated', 'datetime', 'date', 'eventtime', 'event_time', 'ts', 'created', 'utctime', 'logtime', 'time_generated', 'timegenerated'],
  host: ['host', 'hostname', 'computer', 'computername', 'device', 'devicename', 'host.name', 'agent.hostname', 'machine', 'workstation', 'node', 'pod', 'container'],
  user: ['user', 'username', 'user.name', 'account', 'accountname', 'targetusername', 'subjectusername', 'useridentity.username', 'principal', 'actor'],
  process: ['image', 'process', 'process.name', 'processname', 'process_name', 'exe', 'newprocessname', 'program', 'app'],
  srcIp: ['srcip', 'src_ip', 'sourceip', 'source_ip', 'src', 'source.ip', 'client_ip', 'clientip', 'ipaddress', 'sourceipaddress', 'remote_addr', 'remoteip'],
  dstIp: ['dstip', 'dst_ip', 'destip', 'destinationip', 'destination_ip', 'dst', 'destination.ip', 'dest'],
  action: ['eventid', 'event_id', 'eventcode', 'event.code', 'action', 'event', 'eventname', 'event.action', 'type', 'method', 'operation'],
  level: ['level', 'severity', 'loglevel', 'log.level', 'priority'],
  message: ['message', 'msg', 'description', 'command_line', 'commandline', 'details', 'summary', 'text', 'log'],
};

function norm(k: string) {
  return k.toLowerCase().replace(/[\s-]/g, '');
}

function flatten(obj: unknown, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else if (Array.isArray(obj)) {
    out[prefix] = obj.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ');
  } else if (obj !== undefined && obj !== null) {
    out[prefix] = String(obj);
  }
  return out;
}

function pickField(f: Record<string, string>, keys: string[]): string | undefined {
  const map = new Map(Object.keys(f).map((k) => [norm(k), k] as const));
  for (const k of keys) {
    const real = map.get(norm(k));
    if (real && f[real] !== '' && f[real] !== '-') return f[real];
  }
  return undefined;
}

function toSeverity(level?: string, text = ''): Severity | undefined {
  const l = (level ?? '').toLowerCase();
  if (/crit|emerg|alert|fatal/.test(l)) return 'critical';
  if (/err|high/.test(l)) return 'high';
  if (/warn|medium/.test(l)) return 'medium';
  if (/info|notice|low/.test(l)) return 'info';
  if (/\b(fail(ed|ure)?|denied|drop|blocked|error|invalid)\b/i.test(text)) return 'low';
  return undefined;
}

const cleanUser = (u?: string) => (u ? u.replace(/^.*\\/, '').trim() || undefined : undefined);

function fromFields(f: Record<string, string>, raw: string, source: string, format: string): Draft | null {
  const tsRaw = pickField(f, KEYS.ts);
  const ts = parseTime(tsRaw) ?? (raw ? parseTime(raw) : null);
  if (ts == null) return null;
  const host = pickField(f, KEYS.host);
  const user = cleanUser(pickField(f, KEYS.user));
  const process = pickField(f, KEYS.process);
  const action = pickField(f, KEYS.action);
  let message = pickField(f, KEYS.message);
  // Include the most informative extra fields in the message so nothing is lost.
  const extras = Object.entries(f)
    .filter(([k, v]) => v && !KEYS.ts.includes(norm(k)) && norm(k) !== 'message')
    .filter(([k]) => /target|parent|file|object|hash|granted|details|url|bytes|status|integrity|query/i.test(k))
    .map(([k, v]) => `${k}=${v}`);
  if (!message) message = Object.entries(f).filter(([k]) => !KEYS.ts.includes(norm(k))).map(([k, v]) => `${k}=${v}`).join(' ');
  else if (extras.length) message = `${message} | ${extras.join(' ')}`;
  return {
    ts,
    source,
    format,
    host: host?.split('.')[0],
    user,
    process,
    srcIp: pickField(f, KEYS.srcIp)?.match(IPV4)?.[0],
    dstIp: pickField(f, KEYS.dstIp)?.match(IPV4)?.[0],
    action,
    severity: toSeverity(pickField(f, KEYS.level), message),
    message: message.slice(0, 2000),
    raw: raw.slice(0, 4000),
  };
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------
function parseCsvRows(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

function parseCsv(text: string, source: string): Draft[] {
  const first = text.split('\n', 1)[0];
  const delim = (first.match(/\t/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? '\t' : first.includes(';') && !first.includes(',') ? ';' : ',';
  const rows = parseCsvRows(text, delim);
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim());
  // SIEM exports (Splunk `_raw`, Elastic `event.original`, generic `raw`) carry the untouched original
  // line: parse that exactly as if it came from its original file, so no detail is lost in the CSV.
  const rawCol = header.findIndex((h) => /^(_raw|raw|event\.original|raw_log)$/i.test(h));
  if (rawCol >= 0) {
    const out: Draft[] = [];
    for (const r of rows.slice(1)) {
      const raw = (r[rawCol] ?? '').trim();
      if (!raw) continue;
      let d: Draft | null = null;
      if (raw.startsWith('{')) {
        try { d = fromFields(flatten(JSON.parse(raw)), raw, source, 'jsonl'); } catch { /* not JSON */ }
      }
      if (!d) d = parseLine(raw, source);
      if (d) out.push(d);
    }
    return out;
  }
  const lines = text.split(/\r?\n/);
  return rows.slice(1).flatMap((r, i) => {
    const f: Record<string, string> = {};
    header.forEach((h, j) => (f[h] = (r[j] ?? '').trim()));
    const d = fromFields(f, lines[i + 1] ?? r.join(delim), source, delim === '\t' ? 'tsv' : 'csv');
    return d ? [d] : [];
  });
}

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------
function parseJson(text: string, source: string): Draft[] | null {
  const t = text.trim();
  let items: unknown[] | null = null;
  if (t.startsWith('[') || t.startsWith('{')) {
    try {
      const j = JSON.parse(t);
      if (Array.isArray(j)) items = j;
      else if (j && typeof j === 'object') {
        const arr = Object.values(j).find((v) => Array.isArray(v) && v.length && typeof v[0] === 'object');
        items = (arr as unknown[]) ?? [j];
      }
    } catch {
      /* maybe JSONL */
    }
  }
  if (!items) {
    const lines = t.split(/\r?\n/).filter(Boolean);
    const parsed = lines.map((l) => { try { return JSON.parse(l); } catch { return undefined; } });
    if (parsed.filter(Boolean).length < lines.length * 0.6) return null;
    return parsed.flatMap((o, i) => {
      if (!o) return [];
      const d = fromFields(flatten(o), lines[i], source, 'jsonl');
      return d ? [d] : [];
    });
  }
  return items.flatMap((o) => {
    const d = fromFields(flatten(o), JSON.stringify(o), source, 'json');
    return d ? [d] : [];
  });
}

// ---------------------------------------------------------------------------
// line-oriented text logs
// ---------------------------------------------------------------------------
const RE_CLF_LINE = /^(\S+) \S+ (\S+) \[[^\]]+\] "(\S+) (\S+)[^"]*" (\d{3}) (\d+|-)(?: "([^"]*)" "([^"]*)")?/;
const RE_KV = /\b([A-Za-z_][\w.]*)=("[^"]*"|<[^>]*>|\S+)/g;

function parseLine(line: string, source: string): Draft | null {
  // Apache / nginx / squid access log
  let m = line.match(RE_CLF_LINE);
  if (m) {
    const ts = parseTime(line);
    if (ts == null) return null;
    const [, ip, user, method, url, status, size, , ua] = m;
    return {
      ts, source, format: 'access', srcIp: ip, user: user === '-' ? undefined : user, action: method,
      message: `${method} ${url} -> ${status} (${size} bytes)${ua ? ` UA="${ua}"` : ''}`,
      severity: +status >= 500 ? 'medium' : +status >= 400 ? 'low' : undefined,
      raw: line, process: ua?.split(' ')[0],
    };
  }

  let ts: number | null = null;
  let rest = line;
  let noYear = false;
  let host: string | undefined;
  let proc: string | undefined;

  const sy = syslogTime(line);
  if (sy != null) {
    ts = sy;
    noYear = true;
    // "Oct 14 09:05:12 host prog[pid]: msg"
    const sm = line.match(/^\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+(\S+)\s+([^:\[\s]+)(?:\[\d+\])?:\s*(.*)$/);
    if (sm) { host = sm[1]; proc = sm[2]; rest = sm[3]; }
  } else {
    ts = parseTime(line.slice(0, 40)) ?? parseTime(line);
    if (ts == null) return null;
    const im = line.match(/^\S+\s+(\S+)\s+(.*)$/); // "<iso> host message"
    if (im && /^[A-Za-z][\w-]{1,40}$/.test(im[1]) && RE_ISO.test(line.slice(0, 35))) { host = im[1]; rest = im[2]; }
  }

  const kv: Record<string, string> = {};
  for (const k of rest.matchAll(RE_KV)) kv[k[1]] = k[2].replace(/^["<]|[">]$/g, '');
  const ips = rest.match(IPV4) ?? [];
  const user =
    cleanUser(kv.user ?? kv.USER ?? kv.username ?? kv.account) ??
    rest.match(/(?:for (?:invalid user )?|user[= ])([A-Za-z0-9._$-]+)/i)?.[1];
  return {
    ts, source, noYear, format: noYear ? 'syslog' : 'text',
    host: host?.split('.')[0],
    process: proc,
    user,
    srcIp: kv.SRC ?? kv.src ?? kv.src_ip ?? (rest.match(/from (\d+\.\d+\.\d+\.\d+)/)?.[1]) ?? ips[0],
    dstIp: kv.DST ?? kv.dst ?? kv.dst_ip ?? (ips.length > 1 ? ips[1] : undefined),
    action: kv.ACTION ?? kv.action ?? undefined,
    severity: toSeverity(kv.level ?? kv.severity, rest),
    message: rest.slice(0, 2000),
    raw: line.slice(0, 4000),
  };
}

function parseText(text: string, source: string): Draft[] {
  const out: Draft[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const d = parseLine(line, source);
    if (d) out.push(d);
    else if (out.length) {
      // continuation line (stack trace etc.)
      const prev = out[out.length - 1];
      prev.message = (prev.message + '\n' + line).slice(0, 2000);
      prev.raw = (prev.raw + '\n' + line).slice(0, 4000);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
export interface ParsedFile {
  format: string;
  records: Draft[];
}

export function parseFile(name: string, text: string): ParsedFile {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  const head = text.trimStart().slice(0, 1);
  if (ext === 'json' || ext === 'jsonl' || ext === 'ndjson' || head === '{' || head === '[') {
    const j = parseJson(text, name);
    if (j && j.length) return { format: j[0].format, records: j };
  }
  if (ext === 'csv' || ext === 'tsv') {
    const c = parseCsv(text, name);
    if (c.length) return { format: c[0].format, records: c };
  }
  const t = parseText(text, name);
  if (t.length) {
    const fmts = new Set(t.map((r) => r.format));
    return { format: fmts.size === 1 ? [...fmts][0] : 'mixed', records: t };
  }
  // last resort: maybe CSV without the extension
  const c = parseCsv(text, name);
  return { format: c.length ? 'csv' : 'unknown', records: c };
}

/** Fix syslog records that lacked a year, using the dominant year of other sources. */
export function finalizeRecords(drafts: Draft[]): LogRecord[] {
  const years = drafts.filter((d) => !d.noYear).map((d) => new Date(d.ts).getUTCFullYear());
  const year = years.length ? mode(years) : new Date().getUTCFullYear();
  const fixed = drafts.map((d) => {
    if (!d.noYear) return d;
    const dt = new Date(d.ts);
    return { ...d, ts: Date.UTC(year, dt.getUTCMonth(), dt.getUTCDate(), dt.getUTCHours(), dt.getUTCMinutes(), dt.getUTCSeconds()) };
  });
  fixed.sort((a, b) => a.ts - b.ts);
  return fixed.map(({ noYear: _n, ...d }, i) => ({ ...d, id: i }));
}

function mode(a: number[]) {
  const c = new Map<number, number>();
  a.forEach((x) => c.set(x, (c.get(x) ?? 0) + 1));
  return [...c.entries()].sort((x, y) => y[1] - x[1])[0][0];
}

export const isPrivateIp = (ip?: string) =>
  !!ip && (/^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip) || /^127\./.test(ip));
