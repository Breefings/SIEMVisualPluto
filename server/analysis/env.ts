/** Context derived from the whole record set: IP<->host maps, helpers, formatting. */
import type { Asset, LogRecord } from '../../shared/types.ts';
import { isPrivateIp } from '../parsers.ts';

export interface Env {
  records: LogRecord[];
  byId: Map<number, LogRecord>;
  ipToHost: Map<string, string>;
  userToHost: Map<string, string>;
  hostOf(ip?: string): string | undefined;
}

export function buildEnv(records: LogRecord[]): Env {
  const ipToHost = new Map<string, string>();
  const userToHost = new Map<string, string>();
  const userToIp = new Map<string, string>();

  for (const r of records) {
    const m =
      r.message.match(/(\d+\.\d+\.\d+\.\d+)\s+(?:to|for|->)\s+([A-Za-z][\w-]*)/) ??
      r.message.match(/\bA\s+([A-Za-z][\w-]*)(?:\.[\w.-]+)?\s+(\d+\.\d+\.\d+\.\d+)/);
    if (m && /assign|lease|update|register|dhcp|dns/i.test(r.message)) {
      const [ip, host] = /^\d/.test(m[1]) ? [m[1], m[2]] : [m[2], m[1]];
      ipToHost.set(ip, host.toUpperCase());
    }
    // interactive logons tell us who sits at which machine
    if (r.host && r.user && /logon type 2\b|interactive/i.test(r.message)) userToHost.set(r.user.toLowerCase(), r.host);
    // proxy logs tell us which IP a user browses from
    if (r.format === 'access' && r.user && r.srcIp && isPrivateIp(r.srcIp) && !userToIp.has(r.user.toLowerCase()))
      userToIp.set(r.user.toLowerCase(), r.srcIp);
  }
  for (const [u, ip] of userToIp) {
    const h = userToHost.get(u);
    if (h && !ipToHost.has(ip)) ipToHost.set(ip, h);
  }
  return {
    records,
    byId: new Map(records.map((r) => [r.id, r])),
    ipToHost,
    userToHost,
    hostOf: (ip) => (ip ? ipToHost.get(ip) ?? (isPrivateIp(ip) ? ip : undefined) : undefined),
  };
}

// ---------------------------------------------------------------------------
// formatting helpers used by narratives
// ---------------------------------------------------------------------------
export const T = (ts: number) =>
  new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
export const TS = (ts: number) => new Date(ts).toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z');
export const DATE = (ts: number) =>
  new Date(ts).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export function fmtBytes(b: number) {
  if (b >= 1e9) return `${(b / 1e9).toFixed(1)} GB`;
  if (b >= 1e6) return `${(b / 1e6).toFixed(0)} MB`;
  if (b >= 1e3) return `${(b / 1e3).toFixed(0)} KB`;
  return `${b} bytes`;
}
export function spokenBytes(b: number) {
  if (b >= 1e9) return `${(b / 1e9).toFixed(1)} gigabytes`;
  if (b >= 1e6) return `${Math.round(b / 1e6)} megabytes`;
  return `${Math.round(b / 1e3)} kilobytes`;
}

export function person(user?: string) {
  if (!user) return 'an employee';
  const u = user.replace(/^.*\\/, '');
  if (/^(svc|service|sys|admin|root|backup|sql)/i.test(u) || /_/.test(u)) return `the "${u}" account`;
  return u
    .split(/[._]/)
    .map((p, i, a) => (i < a.length - 1 && p.length <= 2 ? p[0].toUpperCase() + '.' : p[0].toUpperCase() + p.slice(1)))
    .join(' ');
}

export function assetKind(id: string): Asset['kind'] {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(id) && !isPrivateIp(id)) return 'external';
  if (/^(dc|ad|domain)/i.test(id)) return 'domain-controller';
  if (/sql|db|mongo|postgres|oracle/i.test(id)) return 'database';
  if (/^(fw|firewall|gw)/i.test(id)) return 'firewall';
  if (/^(ws|desk|laptop|pc|lt|nb)/i.test(id) || /-(ws|pc|lt)\b/i.test(id)) return 'workstation';
  if (/aws|azure|gcp|s3|lambda|k8s|pod/i.test(id)) return 'cloud';
  return 'server';
}

export function friendly(id: string): string {
  const k = assetKind(id);
  if (k === 'external') return "Attacker's server";
  if (k === 'domain-controller') return 'Domain controller';
  if (k === 'database') return 'Database server';
  if (/acct|fin|pay/i.test(id)) return 'Accounting laptop';
  if (/hr\b|-hr|hr-/i.test(id)) return 'HR computer';
  if (/sales/i.test(id)) return 'Sales computer';
  if (/-it-|^it/i.test(id)) return 'IT admin computer';
  if (/^fs|file|share|nas/i.test(id)) return 'File server';
  if (/web|www|nginx|apache|app/i.test(id)) return 'Web server';
  if (/mail|exch|smtp/i.test(id)) return 'Email server';
  return k === 'workstation' ? 'Employee computer' : 'Server';
}

/** Lower-case a friendly name but keep acronyms ("HR computer" -> "HR computer", "File server" -> "file server"). */
export const lowerFriendly = (id?: string) =>
  friendly(id ?? '')
    .split(' ')
    .map((w) => (/^[A-Z]{2,}$/.test(w) ? w : w.toLowerCase()))
    .join(' ');
/** "the accounting laptop" for laymen; "WS-ACCT-07 (accounting laptop)" for analysts. */
export const plainHost = (id?: string) => (id ? `the ${lowerFriendly(id)}` : 'a computer');
export const techHost = (id?: string) => (id ? `${id} (${lowerFriendly(id)})` : 'an unidentified host');

export function decodePsEncoded(cmd: string): string | undefined {
  const m = cmd.match(/-(?:e|enc|encodedcommand)\s+([A-Za-z0-9+/=]{16,})/i);
  if (!m) return;
  try {
    const buf = Buffer.from(m[1], 'base64');
    const s = buf.toString('utf16le');
    return /[\x20-\x7e]{8,}/.test(s) ? s.replace(/\0/g, '') : buf.toString('utf8');
  } catch {
    return;
  }
}
