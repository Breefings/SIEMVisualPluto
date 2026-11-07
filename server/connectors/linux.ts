/**
 * Linux and Proxmox VE over SSH. Instead of copying /var (on Proxmox /var/lib holds VM disks),
 * run targeted reads: the systemd journal for the time window, classic log files as a fallback,
 * Proxmox's own task/cluster/firewall logs, and a snapshot of open connections.
 */
import type { SourceConfig } from '../../shared/sources.ts';
import { iso, journalCmd, journalToText, jsonl, MAX_LINES, slug, SS_CMD, ssToText, sudo, withSsh, type Collected, type Ssh, type Window } from './util.ts';

const CLASSIC = ['/var/log/auth.log', '/var/log/secure', '/var/log/syslog', '/var/log/messages'];

async function journalOrFiles(s: SourceConfig, ssh: Ssh, w: Window, host: string, prefix: string) {
  const files: Collected['files'] = [];
  const notes: string[] = [];
  const j = await ssh.run(journalCmd(s, w), 60 * 1024 * 1024);
  const { text, lines } = journalToText(j.out, host);
  if (lines) {
    files.push({ name: `${prefix}-journal.log`, text });
    if (/No journal files were opened due to insufficient permissions|not seeing messages from other users/i.test(j.err))
      notes.push('Journal access is limited for this account; only its own entries were readable. Tick sudo or use root.');
  } else {
    // no systemd / no permission: fall back to classic files
    for (const f of CLASSIC) {
      const r = await ssh.run(sudo(s, `tail -n ${MAX_LINES} ${f} 2>/dev/null`));
      if (r.out.trim()) files.push({ name: `${prefix}-${f.split('/').pop()}`, text: r.out });
    }
    notes.push(files.length ? 'No readable journal; collected classic /var/log files instead.' : `Could not read the journal or /var/log (${j.err.trim().slice(0, 160) || 'permission denied'}).`);
  }
  const ss = await ssh.run(sudo(s, `sh -c '${SS_CMD}'`));
  const conns = ssToText(ss.out, host, Date.now());
  if (conns.length) files.push({ name: `${prefix}-connections.log`, text: conns.join('\n') });
  return { files, notes, journalLines: lines, conns: conns.length };
}

export async function testLinux(s: SourceConfig): Promise<string> {
  return withSsh(s, async (ssh) => {
    const r = await ssh.run(`hostname; . /etc/os-release 2>/dev/null && echo "$PRETTY_NAME"; ${s.sudo ? 'sudo -n ' : ''}journalctl -n 1 --no-pager -q >/dev/null 2>&1 && echo journal-ok`);
    const [host, os, j] = r.out.trim().split('\n');
    return `${os || 'Linux'} on ${host}${j === 'journal-ok' ? ' · journal readable' : ' · journal not readable (will fall back to /var/log)'}`;
  });
}

export async function collectLinux(s: SourceConfig, w: Window): Promise<Collected> {
  return withSsh(s, async (ssh) => {
    const host = (await ssh.run('hostname')).out.trim() || s.name;
    const r = await journalOrFiles(s, ssh, w, host, `linux-${slug(host)}`);
    return { files: r.files, notes: [`${r.journalLines} journal lines, ${r.conns} open connections on ${host}`, ...r.notes] };
  });
}

// ---------------------------------------------------------------------------
// Proxmox VE
// ---------------------------------------------------------------------------
/** UPID:node:pid:pstart:starttime:type:id:user: endtime status */
function parseTasks(text: string, w: Window) {
  const rows: object[] = [];
  for (const l of text.split('\n')) {
    const m = l.match(/^UPID:([^:]+):[0-9A-F]+:[0-9A-F]+:([0-9A-F]+):([^:]*):([^:]*):([^:]*):\s*(?:([0-9A-F]+)\s+(.*))?$/i);
    if (!m) continue;
    const [, node, start, type, id, user, end, status] = m;
    const ts = parseInt(start, 16) * 1000;
    if (ts < w.since || ts > w.until) continue;
    const dur = end ? Math.max(0, parseInt(end, 16) - parseInt(start, 16)) : null;
    rows.push({
      timestamp: iso(ts), host: node, process: 'pve-task', user, action: type,
      level: status && status !== 'OK' ? 'warning' : 'info',
      message: `Proxmox task ${type}${id ? ` on ${id}` : ''} by ${user}: ${status ?? 'running'}${dur != null ? ` (${dur}s)` : ''}`,
    });
  }
  return rows;
}

/** "0 5 - 07/Nov/2026:10:00:00 +0000 policy DROP: IN=vmbr0 SRC=..." → ISO text line */
function parsePveFirewall(text: string, host: string, w: Window) {
  const MON: Record<string, string> = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
  return text.split('\n').flatMap((l) => {
    const m = l.match(/(\d{2})\/(\w{3})\/(\d{4}):(\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2}) (.*)$/);
    if (!m || !MON[m[2]]) return [];
    const ts = Date.parse(`${m[3]}-${MON[m[2]]}-${m[1]}T${m[4]}${m[5]}:${m[6]}`);
    if (isNaN(ts) || ts < w.since || ts > w.until) return [];
    return [`${iso(ts)} ${host} pve-firewall: ${m[7].replace(/^policy (\w+):/, 'ACTION=$1')}`];
  });
}

export async function testProxmox(s: SourceConfig): Promise<string> {
  return withSsh(s, async (ssh) => {
    const r = await ssh.run(sudo(s, 'sh -c "hostname; pveversion 2>/dev/null; (qm list 2>/dev/null | tail -n +2 | wc -l); (pct list 2>/dev/null | tail -n +2 | wc -l)"'));
    const [host, ver, vms, cts] = r.out.trim().split('\n');
    if (!ver) return `Connected to ${host}, but pveversion is missing (is this a Proxmox host?)`;
    return `${ver.split('/').slice(0, 2).join(' ')} on ${host} · ${vms?.trim() ?? 0} VMs, ${cts?.trim() ?? 0} containers`;
  });
}

export async function collectProxmox(s: SourceConfig, w: Window): Promise<Collected> {
  return withSsh(s, async (ssh) => {
    const host = (await ssh.run('hostname')).out.trim() || s.name;
    const prefix = `proxmox-${slug(host)}`;
    const base = await journalOrFiles(s, ssh, w, host, prefix);
    const files = [...base.files];

    const tasks = parseTasks((await ssh.run(sudo(s, 'cat /var/log/pve/tasks/index /var/log/pve/tasks/active 2>/dev/null'))).out, w);
    if (tasks.length) files.push({ name: `${prefix}-tasks.jsonl`, text: jsonl(tasks) });

    const cl = await ssh.run(sudo(s, 'pvesh get /cluster/log --max 5000 --output-format json 2>/dev/null'));
    let cluster: object[] = [];
    try {
      cluster = (JSON.parse(cl.out || '[]') as { time: number; node: string; user: string; tag: string; msg: string; pri: number }[])
        .filter((e) => e.time * 1000 >= w.since && e.time * 1000 <= w.until)
        .map((e) => ({ timestamp: iso(e.time * 1000), host: e.node, user: e.user, process: e.tag, level: e.pri <= 3 ? 'err' : 'info', message: e.msg }));
    } catch {
      /* pvesh unavailable */
    }
    if (cluster.length) files.push({ name: `${prefix}-cluster.jsonl`, text: jsonl(cluster) });

    const fw = parsePveFirewall((await ssh.run(sudo(s, `tail -n ${MAX_LINES} /var/log/pve-firewall.log 2>/dev/null`))).out, host, w);
    if (fw.length) files.push({ name: `${prefix}-firewall.log`, text: fw.join('\n') });

    return {
      files,
      notes: [`${base.journalLines} journal lines, ${tasks.length} PVE tasks, ${cluster.length} cluster-log entries, ${fw.length} firewall lines, ${base.conns} open connections`, ...base.notes],
    };
  });
}
