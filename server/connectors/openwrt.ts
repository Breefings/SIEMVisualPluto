/**
 * OpenWrt over SSH. OpenWrt keeps its log in a RAM ring buffer (read with `logread`);
 * /var is a tmpfs symlink and usually holds no log files. Network activity comes from:
 *   - logread: firewall drops (zone logging), dnsmasq DNS queries, DHCP, dropbear logins, hostapd Wi-Fi joins
 *   - /proc/net/nf_conntrack: every connection the router is tracking right now (src/dst/ports/bytes)
 *   - /tmp/dhcp.leases: which device has which IP (feeds host attribution)
 *   - /proc/net/dev: per-interface traffic counters
 */
import type { SourceConfig } from '../../shared/sources.ts';
import { iso, MAX_LINES, slug, withSsh, type Collected, type Window } from './util.ts';

const MON: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

/** "Sat Nov  7 10:00:00 2026 daemon.info dnsmasq[1]: msg" → epoch ms (router-local → UTC) + rest. */
function parseLogread(line: string, offsetMin: number) {
  const m = line.match(/^\w{3} (\w{3})\s+(\d{1,2}) (\d{2}):(\d{2}):(\d{2}) (\d{4}) (\S+)\.(\S+) (.*)$/);
  if (!m || MON[m[1]] === undefined) return null;
  const ts = Date.UTC(+m[6], MON[m[1]], +m[2], +m[3], +m[4], +m[5]) - offsetMin * 60_000;
  return { ts, facility: m[7], level: m[8], rest: m[9] };
}

const tzOffset = (z: string) => {
  const m = z.trim().match(/^([+-])(\d{2})(\d{2})$/);
  return m ? (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +m[3]) : 0;
};

export async function testOpenWrt(s: SourceConfig): Promise<string> {
  return withSsh(s, async (ssh) => {
    const r = await ssh.run(`cat /etc/openwrt_release 2>/dev/null | grep DISTRIB_DESCRIPTION; cat /proc/sys/kernel/hostname; logread | wc -l`);
    const [desc, host, n] = r.out.trim().split('\n');
    if (!desc) return `Connected to ${host ?? s.host}, but /etc/openwrt_release is missing (is this OpenWrt?)`;
    return `${desc.split('=')[1]?.replace(/'/g, '') ?? 'OpenWrt'} on ${host} · ${n ?? 0} lines in the log buffer`;
  });
}

export async function collectOpenWrt(s: SourceConfig, w: Window): Promise<Collected> {
  return withSsh(s, async (ssh) => {
    const host = (await ssh.run('cat /proc/sys/kernel/hostname')).out.trim() || s.name;
    const off = tzOffset((await ssh.run('date +%z')).out);
    const now = Date.now();
    const notes: string[] = [];
    const H = host.replace(/\s+/g, '-');

    // 1) system log ring buffer (+ the persistent log file if one is configured)
    const lr = await ssh.run('logread 2>/dev/null; f=$(uci -q get system.@system[0].log_file); [ -n "$f" ] && [ -r "$f" ] && cat "$f"');
    const seen = new Set<string>();
    const sys: string[] = [];
    for (const l of lr.out.split('\n')) {
      const p = parseLogread(l, off);
      if (!p || p.ts < w.since || p.ts > w.until || seen.has(l)) continue;
      seen.add(l);
      const lvl = /err|crit|alert|emerg/.test(p.level) ? ' level=err' : '';
      sys.push(`${iso(p.ts)} ${H} ${p.rest.replace(/^kernel: \[\s*[\d.]+\]\s*/, 'kernel: ')}${lvl}`);
    }
    if (!sys.length) notes.push('The log buffer had no lines in this window (the default 64 KB buffer only holds a few hours; "Enable traffic logging" enlarges it).');
    if (!/query\[/.test(lr.out)) notes.push('No DNS queries in the log: dnsmasq query logging is off.');
    if (!/(drop|reject)\s+\w+\s+(in|out|forward)|DROP|REJECT/.test(lr.out)) notes.push('No firewall log lines: zone logging is off.');

    // 2) live connection table
    const ct = await ssh.run('cat /proc/net/nf_conntrack 2>/dev/null || conntrack -L -o extended 2>/dev/null', 30 * 1024 * 1024);
    const conns: string[] = [];
    for (const l of ct.out.split('\n')) {
      const proto = l.match(/^\S+\s+\d+\s+(tcp|udp|icmp)\s/)?.[1];
      if (!proto) continue;
      const src = l.match(/src=(\S+)/)?.[1];
      const dst = l.match(/dst=(\S+)/)?.[1];
      if (!src || !dst || /^127\.|^::1$/.test(src)) continue;
      const sport = l.match(/sport=(\d+)/)?.[1] ?? '';
      const dport = l.match(/dport=(\d+)/)?.[1] ?? '';
      const bytes = [...l.matchAll(/bytes=(\d+)/g)].reduce((a, m) => a + Number(m[1]), 0);
      const state = l.match(/\s(ESTABLISHED|SYN_SENT|SYN_RECV|FIN_WAIT|TIME_WAIT|CLOSE_WAIT|LAST_ACK|CLOSE)\s/)?.[1] ?? (/UNREPLIED/.test(l) ? 'UNREPLIED' : 'ACTIVE');
      conns.push(`${iso(now)} ${H} kernel: ACTION=ALLOW SRC=${src} DST=${dst} PROTO=${proto.toUpperCase()} SPT=${sport} DPT=${dport}${bytes ? ` BYTES=${bytes}` : ''} STATE=${state} NOTE=conntrack`);
      if (conns.length >= MAX_LINES) break;
    }
    if (conns.length && !/bytes=/.test(ct.out)) notes.push('Connection byte counts are off (net.netfilter.nf_conntrack_acct=0).');

    // 3) DHCP leases → "lease <ip> to <name>" lets the analysis name devices by IP
    const leases = (await ssh.run('cat /tmp/dhcp.leases 2>/dev/null')).out.split('\n').flatMap((l) => {
      const [, mac, ip, name] = l.trim().split(/\s+/);
      return ip ? [`${iso(now)} ${H} dnsmasq-dhcp: DHCP lease ${ip} to ${name && name !== '*' ? name : `device-${mac?.replace(/:/g, '').slice(-6)}`} mac=${mac}`] : [];
    });

    // 4) interface counters
    const ifs = (await ssh.run('cat /proc/net/dev')).out.split('\n').flatMap((l) => {
      const m = l.match(/^\s*([\w.@-]+):\s*(\d+)\s+(\d+)\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+(\d+)\s+(\d+)/);
      return m && m[1] !== 'lo' ? [`${iso(now)} ${H} netifd: interface ${m[1]} rx_bytes=${m[2]} rx_packets=${m[3]} tx_bytes=${m[4]} tx_packets=${m[5]}`] : [];
    });

    const file = `openwrt-${slug(host)}`;
    return {
      files: [
        { name: `${file}-syslog.log`, text: sys.slice(-MAX_LINES).join('\n') },
        { name: `${file}-conntrack.log`, text: conns.join('\n') },
        { name: `${file}-network.log`, text: [...leases, ...ifs].join('\n') },
      ],
      notes: [`${sys.length} log lines, ${conns.length} tracked connections, ${leases.length} DHCP leases`, ...notes],
    };
  });
}

/**
 * One-time, opt-in router change so network activity actually gets logged:
 * bigger log buffer, DNS query logging, WAN-zone firewall logging and per-connection byte counters.
 */
export async function enableOpenWrtLogging(s: SourceConfig): Promise<string> {
  const script = [
    "uci set system.@system[0].log_size='2048'",
    "uci set dhcp.@dnsmasq[0].logqueries='1'",
    "for z in $(uci show firewall | grep \"\\.name='wan'\" | cut -d. -f2); do uci set firewall.$z.log='1'; done",
    'uci commit system; uci commit dhcp; uci commit firewall',
    '/etc/init.d/log restart; /etc/init.d/dnsmasq restart; /etc/init.d/firewall restart',
    'sysctl -w net.netfilter.nf_conntrack_acct=1 >/dev/null 2>&1',
    "grep -q nf_conntrack_acct /etc/sysctl.conf || echo 'net.netfilter.nf_conntrack_acct=1' >> /etc/sysctl.conf",
    'echo done',
  ].join('; ');
  return withSsh(s, async (ssh) => {
    const r = await ssh.run(script);
    if (!/done/.test(r.out)) throw new Error(r.err.trim() || 'the router did not accept the changes');
    return 'Enabled: 2 MB log buffer, DNS query logging, WAN firewall logging and connection byte counters.';
  });
}
