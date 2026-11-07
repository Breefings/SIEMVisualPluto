/**
 * Rule-based detection + correlation. Produces "findings": groups of related
 * detections (same tactic, same host, close in time) that become timeline events.
 */
import type { LogRecord } from '../../shared/types.ts';
import { isPrivateIp } from '../parsers.ts';
import { decodePsEncoded, type Env } from './env.ts';

export type Group =
  | 'phish' | 'webattack' | 'brute' | 'validlogin' | 'exec' | 'autorun' | 'backdoor' | 'privesc'
  | 'c2' | 'discovery' | 'scan' | 'creddump' | 'lateral' | 'collect' | 'exfil' | 'cleanup' | 'miner';

export interface Det {
  group: Group;
  rule: string;
  ts: number;
  endTs?: number;
  host?: string;
  fromHost?: string;
  toHost?: string;
  user?: string;
  ids: number[];
  ctx: Record<string, any>;
}

export interface Finding {
  group: Group;
  ts: number;
  endTs?: number;
  host?: string;
  fromHost?: string;
  toHost?: string;
  user?: string;
  dets: Det[];
  ids: number[];
}

const OFFICE = /\\(winword|excel|powerpnt|outlook|onenote)\.exe/i;
const SHELL = /\\(powershell|pwsh|cmd|wscript|cscript|mshta|rundll32|regsvr32)\.exe/i;
const USER_DIRS = /\\(appdata|programdata|temp|users\\public|windows\\temp)\\|^\/tmp\/|^\/dev\/shm\//i;
const ALLOW_BIN = /onedrive|microsoft\\teams|google\\chrome|zoom|slack|dropbox|spotify|veeam/i;
const DOWNLOADER_UA = /powershell|curl|wget|certutil|bitsadmin|python-requests|go-http-client/i;
const PAYLOAD_EXT = /\.(ps1|exe|bin|dll|hta|vbs|sh|elf|scr|bat)(\?|$)/i;

const txt = (r: LogRecord) => `${r.process ?? ''} ${r.message}`;
const isProcCreate = (r: LogRecord) => /processcreate|^1$|4688/i.test(r.action ?? '') || /command_line|commandline|CommandLine/.test(r.raw);
const parentOf = (r: LogRecord) => r.raw.match(/"parent_image"\s*:\s*"([^"]+)"/)?.[1]?.replace(/\\\\/g, '\\') ?? r.message.match(/parent_image=(\S+)/)?.[1] ?? '';
const imageOf = (r: LogRecord) => (r.process ?? '').replace(/\\\\/g, '\\');
const field = (r: LogRecord, k: string) => {
  const m = r.raw.match(new RegExp(`"${k}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`));
  return m ? m[1].replace(/\\\\/g, '\\').replace(/\\"/g, '"') : undefined;
};
const cmdOf = (r: LogRecord) => field(r, 'command_line') ?? field(r, 'CommandLine') ?? r.message.split(' | ')[0];
const bytesOf = (r: LogRecord) => Number(r.message.match(/BYTES=(\d+)/i)?.[1] ?? r.message.match(/\((\d+) bytes\)/)?.[1] ?? 0);
const dportOf = (r: LogRecord) => Number(r.message.match(/DPT=(\d+)/i)?.[1] ?? r.message.match(/:(\d{2,5})\b/)?.[1] ?? 0);

export function detect(env: Env): Det[] {
  const R = env.records;
  const dets: Det[] = [];
  const host = (r: LogRecord) => r.host ?? env.hostOf(r.srcIp);
  const push = (d: Det) => dets.push(d);

  for (const r of R) {
    const t = txt(r);
    const lower = t.toLowerCase();

    // ---- phishing --------------------------------------------------------
    const att = r.message.match(/attachment=([^\s"]+\.(docm|xlsm|pptm|doc|xls|js|vbs|hta|iso|img|lnk|exe|zip|rar|one|html?))\b/i);
    if (att && /from=/.test(r.message)) {
      const to = r.message.match(/to=<?([^>\s]+)>?/)?.[1] ?? '';
      const from = r.message.match(/from=<?([^>\s]+)>?/)?.[1] ?? '';
      const subject = r.message.match(/subject="([^"]*)"/)?.[1] ?? '';
      const spf = r.message.match(/spf=(\w+)/)?.[1];
      const user = to.split('@')[0];
      const lure = /urgent|overdue|invoice|payment|password|verify|suspend|final notice|docusign|wire/i.test(subject);
      if (/\.(docm|xlsm|pptm|js|vbs|hta|iso|img|lnk|exe|one)$/i.test(att[1]) || lure || /fail/.test(spf ?? '')) {
        push({ group: 'phish', rule: 'phishing-attachment', ts: r.ts, user, host: env.userToHost.get(user.toLowerCase()), ids: [r.id],
          ctx: { from, to, subject, attachment: att[1], spf, size: r.message.match(/size=(\d+)/)?.[1], verdict: r.message.match(/verdict=(\w+)/)?.[1] } });
      }
    }

    // ---- web attacks -----------------------------------------------------
    if (r.format === 'access' && /union(\s|%20|\+)+select|\.\.\/\.\.|%2e%2e%2f|<script|%3cscript|\/etc\/passwd|cmd=|exec\(|' ?or ?'1'='1|sleep\(\d+\)/i.test(r.message)) {
      push({ group: 'webattack', rule: 'web-exploit', ts: r.ts, host: r.host, ids: [r.id], ctx: { src: r.srcIp, request: r.message.slice(0, 200) } });
    }

    // ---- execution ---------------------------------------------------------
    if (isProcCreate(r)) {
      const img = imageOf(r);
      const parent = parentOf(r);
      const cmd = cmdOf(r);
      if (OFFICE.test(parent) && SHELL.test(img)) {
        push({ group: 'exec', rule: 'office-spawns-shell', ts: r.ts, host: host(r), user: r.user, ids: [r.id], ctx: { parent, image: img, cmd } });
      }
      if (/powershell|pwsh/i.test(img + cmd) && /(-enc\b|-encodedcommand|-e\s+[A-Za-z0-9+/=]{20,}|-w(indowstyle)?\s+hidden|downloadstring|iex\s*\(|invoke-expression)/i.test(cmd)) {
        push({ group: 'exec', rule: 'encoded-powershell', ts: r.ts, host: host(r), user: r.user, ids: [r.id], ctx: { cmd, decoded: decodePsEncoded(cmd) } });
      }
      if (USER_DIRS.test(img) && /\.exe$/i.test(img) && !ALLOW_BIN.test(img) && !/7z|7za|rar/i.test(img)) {
        push({ group: 'exec', rule: 'binary-from-user-dir', ts: r.ts, host: host(r), user: r.user, ids: [r.id],
          ctx: { image: img, hash: field(r, 'hashes'), masquerade: /svchost|lsass|csrss|winlogon|services|explorer|update/i.test(img.split('\\').pop() ?? '') } });
      }
      // discovery
      if (/\b(whoami|net1?(\.exe)?\s+(group|user|view|localgroup|share)|nltest|systeminfo|ipconfig\s+\/all|quser|arp\s+-a|nslookup\s+-type=srv|get-aduser|adfind|sharphound|bloodhound)/i.test(cmd)) {
        push({ group: 'discovery', rule: 'recon-commands', ts: r.ts, host: host(r), user: r.user, ids: [r.id], ctx: { cmd } });
      }
      // credential dumping
      if (/lsass/i.test(cmd) && /minidump|procdump|-ma\b|comsvcs/i.test(cmd) || /mimikatz|sekurlsa|lsadump|kerberoast|rubeus/i.test(cmd)) {
        push({ group: 'creddump', rule: 'lsass-dump', ts: r.ts, host: host(r), user: r.user, ids: [r.id], ctx: { cmd } });
      }
      // collection / staging
      if (/\b(7z|7za|rar|winrar)(\.exe)?\s+a\b|compress-archive|\btar\s+-?c\w*z/i.test(cmd)) {
        push({ group: 'collect', rule: 'archive-staging', ts: r.ts, host: host(r), user: r.user, ids: [r.id],
          ctx: { cmd, password: /\s-p\S+/.test(cmd), archive: cmd.match(/(\S+\.(7z|rar|zip|tar\.gz|tgz))/i)?.[1] } });
      }
      if (/\bdir\s+.*\/s\b/i.test(cmd) && /\\\\|share|finance|hr/i.test(cmd)) {
        push({ group: 'collect', rule: 'share-enumeration', ts: r.ts, host: host(r), user: r.user, ids: [r.id], ctx: { cmd } });
      }
      // exfil by tool
      if (/curl(\.exe)?\s.*(-T|--upload-file|-F)\s|rclone\s+(copy|sync)|megacmd|Invoke-RestMethod.*-Method\s+(Put|Post)/i.test(cmd)) {
        push({ group: 'exfil', rule: 'upload-tool', ts: r.ts, host: host(r), user: r.user, ids: [r.id], ctx: { cmd, url: cmd.match(/https?:\/\/\S+/)?.[0] } });
      }
      // log clearing
      if (/wevtutil(\.exe)?\s+cl|clear-eventlog|remove-eventlog/i.test(cmd)) {
        push({ group: 'cleanup', rule: 'clear-logs', ts: r.ts, host: host(r), user: r.user, ids: [r.id], ctx: { cmd } });
      }
    }

    // credential access via process access to lsass
    if (/lsass\.exe/i.test(field(r, 'target_image') ?? '') && /0x1fffff|0x1010|0x1410|0x143a/i.test(r.raw)) {
      push({ group: 'creddump', rule: 'lsass-access', ts: r.ts, host: host(r), user: r.user, ids: [r.id], ctx: { access: field(r, 'granted_access'), image: imageOf(r) } });
    }
    // dropped executable / dump file
    const tf = field(r, 'target_filename');
    if (tf && /filecreate|^11$/i.test(r.action ?? '')) {
      if (USER_DIRS.test(tf) && /\.(exe|dll|ps1|bat|scr)$/i.test(tf)) push({ group: 'exec', rule: 'payload-dropped', ts: r.ts, host: host(r), user: r.user, ids: [r.id], ctx: { file: tf } });
      if (/lsass.*\.dmp$/i.test(tf)) push({ group: 'creddump', rule: 'dump-file', ts: r.ts, host: host(r), user: r.user, ids: [r.id], ctx: { file: tf } });
    }
    if (tf && /filedelete|^23$|^26$/i.test(r.action ?? '') && /\.dmp$|\.7z$|\.log$/i.test(tf)) {
      push({ group: 'cleanup', rule: 'evidence-deleted', ts: r.ts, host: host(r), user: r.user, ids: [r.id], ctx: { file: tf } });
    }

    // ---- downloads (ingress tool transfer) --------------------------------
    if (r.format === 'access' && /^(GET|PUT|POST)$/.test(r.action ?? '')) {
      const ua = r.message.match(/UA="([^"]*)"/)?.[1] ?? '';
      const url = r.message.split(' ')[1] ?? '';
      if (r.action === 'GET' && (DOWNLOADER_UA.test(ua) || PAYLOAD_EXT.test(url)) && !/update\.microsoft|windowsupdate/i.test(url)) {
        push({ group: 'exec', rule: 'payload-download', ts: r.ts, host: env.hostOf(r.srcIp), user: r.user, ids: [r.id], ctx: { url, ua, bytes: bytesOf(r) } });
      }
      if ((r.action === 'PUT' || r.action === 'POST') && bytesOf(r) > 50e6) {
        push({ group: 'exfil', rule: 'large-upload', ts: r.ts, host: env.hostOf(r.srcIp), user: r.user, ids: [r.id], ctx: { url, bytes: bytesOf(r) } });
      }
    }
    if (/\b(wget|curl)\b[^|]*https?:\/\/\S+/i.test(r.message) && /chmod \+x|-O \/tmp|\/dev\/shm|\|\s*(ba)?sh/i.test(r.message)) {
      push({ group: 'exec', rule: 'linux-dropper', ts: r.ts, host: host(r), user: r.user, ids: [r.id], ctx: { cmd: r.message.replace(/^[^:]*: \w+: /, ''), url: r.message.match(/https?:\/\/\S+/)?.[0] } });
    }

    // ---- persistence -------------------------------------------------------
    if (/currentversion\\\\?run/i.test(r.raw) && /registry|^13$/i.test(r.action ?? r.message)) {
      push({ group: 'autorun', rule: 'run-key', ts: r.ts, host: host(r), user: r.user, ids: [r.id], ctx: { key: field(r, 'target_object'), value: field(r, 'details') } });
    }
    if (/\b7045\b/.test(r.action ?? '') || /service was installed/i.test(r.message)) {
      const name = r.message.match(/Service Name:\s*([^.\s]+)/i)?.[1] ?? '';
      const file = r.message.match(/Service File Name:\s*([^\s]+?)\.?(?:\s|$)/i)?.[1] ?? '';
      if (/psexesvc|remcom|paexec/i.test(name)) push({ group: 'lateral', rule: 'psexec-service', ts: r.ts, host: host(r), user: r.user, ids: [r.id], ctx: { name } });
      else if (USER_DIRS.test(file) || /programdata|temp|appdata/i.test(file)) push({ group: 'backdoor', rule: 'malicious-service', ts: r.ts, host: host(r), user: r.user, ids: [r.id], ctx: { name, file } });
    }
    if (/\b4698\b/.test(r.action ?? '') || /schtasks(\.exe)?\s+\/create/i.test(r.message)) {
      push({ group: 'backdoor', rule: 'scheduled-task', ts: r.ts, host: host(r), user: r.user, ids: [r.id],
        ctx: { task: r.message.match(/Task Name:\s*(\S+)/i)?.[1], action: r.message.match(/Action:\s*([^.]+?\.exe[^.]*)/i)?.[1] } });
    }
    if (/crontab/i.test(r.message) && /replace|\|\s*crontab|echo .*\* \*/i.test(r.message)) {
      push({ group: 'backdoor', rule: 'cron', ts: r.ts, host: host(r), user: r.user, ids: [r.id], ctx: { cmd: r.message } });
    }
    if (/\b4720\b/.test(r.action ?? '') || /useradd|new user:|net user \S+ \S+ \/add/i.test(r.message)) {
      push({ group: 'backdoor', rule: 'account-created', ts: r.ts, host: host(r), user: r.user, ids: [r.id],
        ctx: { account: r.message.match(/New Account:\s*(\S+)|name=([^,\s]+)/i)?.slice(1).find(Boolean), uid0: /UID=0\b/.test(r.message) } });
    }
    if (/\b4732\b|\b4728\b/.test(r.action ?? '') || /usermod .*-aG (sudo|wheel)|localgroup administrators .* \/add/i.test(r.message)) {
      push({ group: 'backdoor', rule: 'admin-group-add', ts: r.ts, host: host(r), user: r.user, ids: [r.id], ctx: { member: r.message.match(/Member:\s*(\S+?)\.?\s/i)?.[1] } });
    }
    if (/authorized_keys/i.test(r.message) && />>|echo|tee/i.test(r.message)) {
      push({ group: 'backdoor', rule: 'ssh-key', ts: r.ts, host: host(r), user: r.user, ids: [r.id], ctx: { cmd: r.message } });
    }

    // ---- privilege escalation ---------------------------------------------
    if (/sudo:.*COMMAND=\/(usr\/)?bin\/(ba|z)?sh\b|sudo su\b|sudo -i\b/i.test(r.raw)) {
      push({ group: 'privesc', rule: 'sudo-shell', ts: r.ts, host: host(r), user: r.raw.match(/sudo:\s+(\S+)/)?.[1] ?? r.user, ids: [r.id], ctx: { cmd: r.raw.replace(/^.*?sudo:\s*/, 'sudo: ') } });
    }

    // ---- defense evasion ----------------------------------------------------
    if (/\b1102\b/.test(r.action ?? '') || /audit log was cleared|history -c|rm -f? ?\/var\/log|>\s*\/var\/log|unset histfile/i.test(r.message)) {
      push({ group: 'cleanup', rule: 'log-cleared', ts: r.ts, host: host(r), user: r.user, ids: [r.id], ctx: { msg: r.message } });
    }

    // ---- crypto mining ------------------------------------------------------
    if (/xmrig|kdevtmpfsi|kinsing|stratum\+tcp|supportxmr|nanopool|minexmr|--donate-level|cryptonight/i.test(lower) || (/top_process=/.test(lower) && /cpu_usage=9\d/.test(lower))) {
      push({ group: 'miner', rule: 'cryptominer', ts: r.ts, host: host(r), user: r.user, ids: [r.id], ctx: { msg: r.message, pool: r.message.match(/([\w.-]*pool[\w.-]*:\d+)/i)?.[1] } });
    }
  }

  detectNetwork(env, push);
  detectAuth(env, push);
  detectLateral(env, dets, push);
  return dets.sort((a, b) => a.ts - b.ts);
}

// ---------------------------------------------------------------------------
// network: beaconing, scans, large egress
// ---------------------------------------------------------------------------
const MINING_PORTS = new Set([3333, 4444, 5555, 7777, 14444, 45700]);
/** Firewall logs carry the firewall's hostname; prefer the IP->host map, then a non-network-device host. */
function flowHost(env: Env, src: string, r: LogRecord) {
  const mapped = env.ipToHost.get(src);
  if (mapped) return mapped;
  if (r.host && !/^(fw|firewall|gw|router|asa|pan|fortigate)/i.test(r.host)) return r.host;
  return env.hostOf(src);
}

function detectNetwork(env: Env, push: (d: Det) => void) {
  const flows = new Map<string, LogRecord[]>();
  const scanners = new Map<string, LogRecord[]>();
  for (const r of env.records) {
    if (!r.srcIp || !r.dstIp) continue;
    if (isPrivateIp(r.srcIp) && !isPrivateIp(r.dstIp)) {
      const k = `${r.srcIp}>${r.dstIp}:${dportOf(r)}`;
      (flows.get(k) ?? flows.set(k, []).get(k)!).push(r);
      const b = bytesOf(r);
      if (b > 100e6) {
        push({ group: 'exfil', rule: 'large-egress', ts: r.ts, host: flowHost(env, r.srcIp, r), ids: [r.id],
          ctx: { bytes: b, dst: r.dstIp, port: dportOf(r), duration: r.message.match(/DURATION=(\d+)s/)?.[1] } });
      }
    }
    if (isPrivateIp(r.srcIp) && isPrivateIp(r.dstIp)) (scanners.get(r.srcIp) ?? scanners.set(r.srcIp, []).get(r.srcIp)!).push(r);
  }

  // beaconing: regular, repeated small connections to one external endpoint
  for (const [k, rs] of flows) {
    if (rs.length < 4) continue;
    const gaps = rs.slice(1).map((r, i) => r.ts - rs[i].ts);
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const sd = Math.sqrt(gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / gaps.length);
    const small = rs.filter((r) => bytesOf(r) < 100_000).length / rs.length > 0.8;
    if (mean >= 20_000 && sd / mean < 0.25 && small) {
      const [src, rest] = k.split('>');
      const [dst, port] = rest.split(':');
      const mining = MINING_PORTS.has(+port);
      push({ group: mining ? 'miner' : 'c2', rule: mining ? 'mining-pool-traffic' : 'beaconing', ts: rs[0].ts, endTs: rs[rs.length - 1].ts, host: flowHost(env, src, rs[0]),
        ids: rs.slice(0, 6).map((r) => r.id).concat(rs.slice(-2).map((r) => r.id)),
        ctx: { src, dst, port: +port, count: rs.length, intervalSec: Math.round(mean / 1000), jitter: Math.round((sd / mean) * 100) } });
    }
  }

  // internal port scans: many distinct dst:port in a short window
  for (const [src, rs] of scanners) {
    let i = 0;
    for (let j = 0; j < rs.length; j++) {
      while (rs[j].ts - rs[i].ts > 5 * 60_000) i++;
      const win = rs.slice(i, j + 1);
      const targets = new Set(win.map((r) => `${r.dstIp}:${dportOf(r)}`));
      if (targets.size >= 25) {
        const all = rs.filter((r) => r.ts >= rs[i].ts && r.ts <= rs[i].ts + 15 * 60_000);
        const hosts = new Set(all.map((r) => r.dstIp));
        const ports = [...new Set(all.map((r) => dportOf(r)))].sort((a, b) => a - b);
        push({ group: 'scan', rule: 'port-scan', ts: all[0].ts, endTs: all[all.length - 1].ts, host: flowHost(env, src, all[0]),
          ids: all.slice(0, 8).map((r) => r.id), ctx: { src, probes: all.length, hosts: hosts.size, ports, dropped: all.filter((r) => /DROP|DENY|BLOCK/i.test(r.message)).length } });
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// authentication: brute force + success after brute force
// ---------------------------------------------------------------------------
function detectAuth(env: Env, push: (d: Det) => void) {
  const FAIL = /failed password|failed to log on|authentication failure|invalid user|login failed|4625/i;
  const OK = /accepted (password|publickey)|successfully logged on|login succeeded/i;
  const fails = new Map<string, LogRecord[]>();
  for (const r of env.records) {
    if (FAIL.test(r.message) || r.action === '4625') {
      const k = r.srcIp ?? `${r.host}/${r.user}`;
      (fails.get(k) ?? fails.set(k, []).get(k)!).push(r);
    }
  }
  for (const [src, rs] of fails) {
    if (rs.length < 10) continue;
    const users = [...new Set(rs.map((r) => r.user).filter(Boolean))] as string[];
    push({ group: 'brute', rule: 'brute-force', ts: rs[0].ts, endTs: rs[rs.length - 1].ts, host: rs[0].host, ids: rs.slice(0, 5).map((r) => r.id).concat(rs.slice(-3).map((r) => r.id)),
      ctx: { src, attempts: rs.length, users: users.slice(0, 12), userCount: users.length, minutes: Math.max(1, Math.round((rs[rs.length - 1].ts - rs[0].ts) / 60000)) } });
    const success = env.records.find((r) => r.ts >= rs[0].ts && r.srcIp === rs[0].srcIp && OK.test(r.message));
    if (success) {
      push({ group: 'validlogin', rule: 'login-after-bruteforce', ts: success.ts, host: success.host, user: success.user, ids: [success.id],
        ctx: { src, user: success.user, after: rs.filter((r) => r.ts < success.ts).length } });
    }
  }
}

// ---------------------------------------------------------------------------
// lateral movement: remote logons originating from already-compromised hosts
// ---------------------------------------------------------------------------
function detectLateral(env: Env, dets: Det[], push: (d: Det) => void) {
  const compromised = new Map<string, number>();
  const mark = (h: string | undefined, ts: number) => { if (h && !compromised.has(h)) compromised.set(h, ts); };
  for (const d of dets) if (['exec', 'c2', 'creddump', 'validlogin', 'miner'].includes(d.group)) mark(d.host, d.ts);

  const psexec = dets.filter((d) => d.rule === 'psexec-service');
  const explicit = env.records.filter((r) => r.action === '4648' || /explicit credentials/i.test(r.message));
  const seen = new Set<string>();

  for (const r of env.records) {
    const m = r.message.match(/logon type (\d+)/i);
    const remoteCmd = (r.process ?? '').match(/psexec|wmic|winrs/i) && r.message.match(/\\\\([A-Za-z][\w-]+)|\/node:"?([A-Za-z][\w-]+)/i);
    let from: string | undefined, to: string | undefined;
    let method = '';
    if (m && (m[1] === '3' || m[1] === '10') && r.srcIp && isPrivateIp(r.srcIp) && r.host) {
      from = env.hostOf(r.srcIp);
      to = r.host;
      method = m[1] === '10' ? 'RDP' : 'SMB';
      if (!from || from === to) continue;
      const fromTs = compromised.get(from);
      if (fromTs == null || fromTs > r.ts) continue;
      const usual = env.userToHost.get((r.user ?? '').toLowerCase());
      const svc = psexec.find((p) => p.host === to && Math.abs(p.ts - r.ts) < 120_000);
      const exp = explicit.find((e) => e.host === to && Math.abs(e.ts - r.ts) < 120_000);
      if (method !== 'RDP' && !svc && !exp && usual === from) continue; // normal user accessing a share
      if (svc) method = 'PsExec';
      const k = `${from}>${to}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const ids = [r.id, ...(svc ? svc.ids : []), ...(exp ? [exp.id] : [])];
      const fw = env.records.find((x) => x.srcIp === r.srcIp && env.hostOf(x.dstIp) === to && Math.abs(x.ts - r.ts) < 60_000 && x.id !== r.id);
      if (fw) ids.push(fw.id);
      push({ group: 'lateral', rule: 'remote-logon', ts: r.ts, host: to, fromHost: from, toHost: to, user: r.user, ids, ctx: { method, account: r.user, port: method === 'RDP' ? 3389 : 445 } });
      mark(to, r.ts);
    } else if (remoteCmd) {
      from = r.host;
      to = (remoteCmd[1] ?? remoteCmd[2])?.toUpperCase();
      if (from && to && from !== to) {
        push({ group: 'lateral', rule: 'remote-exec-tool', ts: r.ts, host: to, fromHost: from, toHost: to, user: r.user, ids: [r.id], ctx: { method: 'remote execution', cmd: r.message } });
        mark(to, r.ts);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// correlation: merge related detections into findings
// ---------------------------------------------------------------------------
const WINDOW: Partial<Record<Group, number>> = {
  exec: 10 * 60_000, backdoor: 20 * 60_000, discovery: 60 * 60_000, creddump: 10 * 60_000, collect: 60 * 60_000,
  exfil: 30 * 60_000, cleanup: 30 * 60_000, miner: 6 * 3600_000, phish: 60_000, autorun: 5 * 60_000, privesc: 10 * 60_000,
};

export function correlate(dets: Det[]): Finding[] {
  const out: Finding[] = [];
  for (const d of dets) {
    if (d.rule === 'psexec-service') continue; // folded into lateral evidence
    const w = WINDOW[d.group];
    const prev = w
      ? [...out].reverse().find((f) => f.group === d.group && f.host === d.host && d.ts - (f.endTs ?? f.ts) <= w)
      : undefined;
    if (prev) {
      prev.dets.push(d);
      prev.ids.push(...d.ids);
      prev.endTs = Math.max(prev.endTs ?? prev.ts, d.endTs ?? d.ts);
      prev.user ??= d.user;
    } else {
      out.push({ group: d.group, ts: d.ts, endTs: d.endTs, host: d.host, fromHost: d.fromHost, toHost: d.toHost, user: d.user, dets: [d], ids: [...d.ids] });
    }
  }
  // A dropped-file-only "exec" finding right before a backdoor on the same host is part of that backdoor.
  for (const f of [...out]) {
    if (f.group !== 'exec' || !f.dets.every((d) => d.rule === 'payload-dropped')) continue;
    const bd = out.find((b) => b.group === 'backdoor' && b.host === f.host && b.ts >= f.ts && b.ts - f.ts < 15 * 60_000);
    if (bd) {
      bd.dets.unshift(...f.dets);
      bd.ids.unshift(...f.ids);
      out.splice(out.indexOf(f), 1);
    }
  }
  return out.sort((a, b) => a.ts - b.ts);
}
