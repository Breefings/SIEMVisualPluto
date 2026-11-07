/**
 * Findings -> TimelineEvents (three levels of narrative each) -> Incident with
 * three Stories (scene lists used by the video and the story feed).
 */
import type { Asset, Incident, Level, Narrative, PhaseId, Scene, Severity, Story, TimelineEvent } from '../../shared/types.ts';
import { PHASES, SEV_ORDER } from '../../shared/types.ts';
import { isPrivateIp } from '../parsers.ts';
import type { Det, Finding, Group } from './detect.ts';
import { assetKind, DATE, type Env, fmtBytes, friendly, lowerFriendly, person, plainHost, spokenBytes, T, techHost, TS } from './env.ts';

type N3 = Record<Level, Narrative>;
interface Built {
  phase: PhaseId;
  severity: Severity;
  technique?: { id: string; name: string };
  label: string;
  key: boolean;
  confidence: number;
  n: N3;
  iocs?: string[];
}

const short = (s = '', n = 110) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const exe = (p = '') => p.split(/[\\/]/).pop() ?? p;
const ago = (ms: number) => {
  const m = Math.round(ms / 60000);
  return m < 90 ? `${m} minutes` : `${(m / 60).toFixed(m < 600 ? 1 : 0)} hours`;
};
const list = (a: string[]) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
const rule = (f: Finding, r: string) => f.dets.find((d) => d.rule === r);
const rules = (f: Finding, r: string) => f.dets.filter((d) => d.rule === r);

function domainFor(env: Env, ip?: string): string | undefined {
  if (!ip) return;
  for (const r of env.records) {
    const m = r.message.match(/\bA\s+([a-z0-9.-]+\.[a-z]{2,})\b.*->\s*(\d+\.\d+\.\d+\.\d+)/i);
    if (m && m[2] === ip) return m[1];
  }
}

interface Ctx {
  env: Env;
  firstOf: Set<Group>;
  compromisedCount: number;
}

// ---------------------------------------------------------------------------
// per-group narrative builders
// ---------------------------------------------------------------------------
function build(f: Finding, cx: Ctx): Built {
  const { env } = cx;
  const first = !cx.firstOf.has(f.group);
  const h = f.host;
  const who = person(f.user);
  const t = T(f.ts);
  const ts = TS(f.ts);

  switch (f.group) {
    case 'phish': {
      const c = f.dets[0].ctx;
      const ext = (c.attachment.split('.').pop() ?? '').toLowerCase();
      const kind = /doc/.test(ext) ? 'Word document' : /xls/.test(ext) ? 'Excel spreadsheet' : /ppt/.test(ext) ? 'PowerPoint file' : /zip|rar|iso|img/.test(ext) ? 'compressed file' : 'file';
      const invoice = /invoice|payment|overdue/i.test(c.subject);
      const domain = String(c.from).split('@')[1];
      return {
        phase: 'initial-access', severity: 'medium', key: true, confidence: 0.8,
        technique: { id: 'T1566.001', name: 'Phishing: Spearphishing Attachment' },
        label: 'Phishing email delivered', iocs: [c.from, domain, c.attachment].filter(Boolean),
        n: {
          layman: { title: invoice ? 'A fake invoice email arrives' : 'A booby-trapped email arrives',
            text: `At ${t}, ${who} received an email made to look like ${invoice ? 'an urgent, overdue invoice' : `a message titled "${c.subject}"`}. Attached was a ${kind} with hidden instructions inside, like a letter with a trap in the envelope. The company's email filter let it through.` },
          analyst: { title: `Phishing email with .${ext} attachment`,
            text: `${t} UTC: the mail gateway accepted a message from ${c.from} to ${c.to} (subject "${c.subject}") carrying ${c.attachment}.${c.spf ? ` SPF result: ${c.spf}.` : ''} Verdict was "${c.verdict ?? 'n/a'}", so it reached the inbox. Macro-enabled Office files from outside senders are one of the most common ways attacks begin.` },
          senior: { title: 'Initial vector: spearphishing attachment (T1566.001)',
            text: `${ts}: ${c.from} → ${c.to}, subject "${c.subject}", attachment ${c.attachment}${c.size ? ` (${c.size} B)` : ''}, spf=${c.spf ?? '?'}, verdict=${c.verdict ?? '?'}. The gateway failed open on a macro-enabled document from a sender with a soft-failing SPF record. Pivot on ${domain} across all mailboxes, quarantine copies, detonate the attachment, and block the domain.` },
        },
      };
    }

    case 'exec': {
      const office = rule(f, 'office-spawns-shell');
      const enc = rule(f, 'encoded-powershell');
      const dl = rule(f, 'payload-download');
      const drop = rule(f, 'payload-dropped');
      const bin = rule(f, 'binary-from-user-dir');
      const lin = rule(f, 'linux-dropper');
      const url = dl?.ctx.url ?? lin?.ctx.url;
      const urlHost = url ? safeHost(url) : undefined;
      const image = bin?.ctx.image ?? drop?.ctx.file;
      const masq = bin?.ctx.masquerade;
      const tech = office ? { id: 'T1204.002', name: 'User Execution: Malicious File' } : enc ? { id: 'T1059.001', name: 'Command and Scripting Interpreter: PowerShell' } : lin ? { id: 'T1105', name: 'Ingress Tool Transfer' } : { id: 'T1036.005', name: 'Masquerading: Match Legitimate Name or Location' };
      const chain: string[] = [];
      if (office) chain.push(`${exe(office.ctx.parent)} spawned ${exe(office.ctx.image)} (a document should never launch a command shell)`);
      if (enc) chain.push('PowerShell ran a hidden, base64-encoded command');
      if (url) chain.push(`it downloaded ${short(url, 70)}`);
      if (image) chain.push(`it dropped and ran ${exe(image)} from a user-writable folder`);
      if (lin) chain.push(`a shell command downloaded and ran ${exe(lin.ctx.cmd.match(/-O\s+(\S+)/)?.[1] ?? 'a payload')}`);
      const iocs = [url, urlHost, image, bin?.ctx.hash?.replace(/^SHA256=/, 'sha256:')].filter(Boolean) as string[];
      const layman = first
        ? office
          ? `At ${t}, ${who} opened the attachment. Hidden code inside it quietly reached out to the internet, downloaded a malicious program, and started it on ${plainHost(h)}.${masq ? ' The program was disguised with a name that looks like a normal Windows file, so nothing seemed wrong.' : ''} From this moment, the attacker had a foothold inside the company.`
          : `At ${t}, a malicious program was downloaded and started on ${plainHost(h)}. From this moment, the attacker had a foothold.`
        : `At ${t}, the attacker started their malicious program on ${plainHost(h)} too, putting it under their remote control as well.`;
      return {
        phase: 'execution', severity: 'high', key: first, confidence: office || enc ? 0.95 : 0.8, technique: tech,
        label: first ? 'Malware executed' : `Malware launched on ${h}`, iocs,
        n: {
          layman: { title: first ? `Malicious program starts on the ${lowerFriendly(h)}` : `Malware starts on the ${lowerFriendly(h)}`, text: layman },
          analyst: { title: `Malware execution on ${h}`, text: `${t} UTC on ${techHost(h)}${f.user ? `, user ${f.user}` : ''}: ${chain.join('; then ')}. Mapped to ${tech.id} (${tech.name}).${masq ? ` The file name imitates a Windows system process (T1036.005).` : ''}` },
          senior: { title: `Execution chain on ${h} (${tech.id})`,
            text: [
              office && `Process lineage: ${exe(office.ctx.parent)} → ${exe(office.ctx.image)}.`,
              enc && `Command: ${short(enc.ctx.cmd, 90)}`,
              enc?.ctx.decoded && `Decoded: ${short(enc.ctx.decoded, 140)}`,
              dl && `Stage-2 pulled from ${dl.ctx.url} (${fmtBytes(dl.ctx.bytes)}) with UA "${short(dl.ctx.ua, 40)}".`,
              image && `Payload ${image}${bin?.ctx.hash ? ` [${short(bin.ctx.hash, 30)}]` : ''}.`,
              lin && `Command: ${short(lin.ctx.cmd, 140)}`,
              `Isolate ${h}, capture memory before reboot, submit the binary for reverse engineering${urlHost ? `, block ${urlHost}` : ''}.`,
            ].filter(Boolean).join(' ') },
        },
      };
    }

    case 'autorun': {
      const c = f.dets[0].ctx;
      const name = String(c.key ?? '').split('\\').pop();
      return {
        phase: 'persistence', severity: 'medium', key: false, confidence: 0.85,
        technique: { id: 'T1547.001', name: 'Boot or Logon Autostart: Registry Run Keys' }, label: 'Autostart registry key',
        iocs: [c.key].filter(Boolean),
        n: {
          layman: { title: 'Malware sets itself to restart automatically', text: `At ${t}, the malware told ${plainHost(h)} to start it again every time someone logs in, so simply restarting the computer would not get rid of it.` },
          analyst: { title: `Registry Run key persistence on ${h}`, text: `Run key value "${name}" added at ${t} UTC, pointing to ${short(c.value, 80)}. The name imitates a legitimate updater (T1547.001).` },
          senior: { title: 'HKCU Run key persistence (T1547.001)', text: `${ts}: ${c.key} = ${c.value}. User-scope persistence survives reboot but not profile removal. Delete the value, then sweep the whole fleet for the value name "${name}" and the binary path.` },
        },
      };
    }

    case 'c2': {
      const c = f.dets[0].ctx;
      const dom = domainFor(env, c.dst);
      const every = c.intervalSec >= 600 ? `${Math.round(c.intervalSec / 60)} minutes` : c.intervalSec >= 90 ? `${Math.round(c.intervalSec / 60)} minutes` : `${c.intervalSec} seconds`;
      return {
        phase: 'command-and-control', severity: 'high', key: first, confidence: 0.85,
        technique: { id: 'T1071.001', name: 'Application Layer Protocol: Web Protocols' },
        label: `C2 beacon → ${c.dst}`, iocs: [c.dst, dom].filter(Boolean) as string[],
        n: {
          layman: first
            ? { title: 'The malware "phones home"', text: `Starting at ${t}, ${plainHost(h)} began checking in with the attacker's server on the internet about once every ${every}, like a spy radioing headquarters for orders. It did this ${c.count} times.` }
            : { title: `The ${lowerFriendly(h)} also phones home`, text: `From ${t}, ${plainHost(h)} also started checking in with the attacker's server every ${every}.` },
          analyst: { title: `C2 beaconing ${h} → ${c.dst}:${c.port}`, text: `${c.count} outbound connections from ${c.src} to ${c.dst}${dom ? ` (${dom})` : ''} on port ${c.port}, every ~${c.intervalSec}s (jitter ${c.jitter}%) between ${t} and ${T(f.endTs ?? f.ts)} UTC. Regular, small, periodic traffic is a classic command-and-control beacon.` },
          senior: { title: `Beacon ${c.src} → ${c.dst}:${c.port}/tcp (T1071.001)`, text: `n=${c.count}, mean interval ${c.intervalSec}s, CV ${c.jitter}%, payloads under 2 KB, active ${ago((f.endTs ?? f.ts) - f.ts)}. Infrastructure: ${c.dst}${dom ? ` / ${dom}` : ''}. Block at egress, sinkhole the domain, and hunt for the same destination across proxy and firewall logs to find other implants.` },
        },
      };
    }

    case 'discovery': {
      const cmds = f.dets.map((d) => d.ctx.cmd as string);
      return {
        phase: 'discovery', severity: 'medium', key: false, confidence: 0.7,
        technique: { id: 'T1087.002', name: 'Account Discovery: Domain Account' }, label: `${cmds.length} recon command${cmds.length === 1 ? '' : 's'}`,
        n: {
          layman: { title: 'The attacker looks around', text: `At ${t}, the attacker ran commands on ${plainHost(h)} to learn who the administrators are and where the important servers live, like a burglar studying the building's floor plan.` },
          analyst: { title: `Domain discovery from ${h}`, text: `${cmds.length} reconnaissance commands run by ${f.user ?? 'the implant'} on ${h}: ${cmds.slice(0, 4).map((c) => `"${short(c, 48)}"`).join(', ')}. This is typical hands-on-keyboard reconnaissance after the attacker gets in.` },
          senior: { title: 'Hands-on-keyboard discovery (T1087.002, T1482, T1018)', text: `${cmds.map((c) => short(c, 60)).join(' ; ')}. Executed via cmd.exe under the implant's context. Detection: alert on 'net group "Domain Admins"' and nltest /dclist from non-IT endpoints.` },
        },
      };
    }

    case 'scan': {
      const c = f.dets[0].ctx;
      return {
        phase: 'discovery', severity: 'medium', key: false, confidence: 0.8,
        technique: { id: 'T1046', name: 'Network Service Discovery' }, label: `Port scan (${c.hosts} hosts)`,
        n: {
          layman: { title: 'Checking which doors are unlocked', text: `At ${t}, ${plainHost(h)} rapidly knocked on the network "doors" of ${c.hosts} other machines to find ones it could get into.` },
          analyst: { title: `Internal port scan from ${h}`, text: `${c.probes} connection attempts from ${c.src} to ${c.hosts} internal hosts on ports ${c.ports.join(', ')} within ${ago((f.endTs ?? f.ts) - f.ts)}; ${c.dropped} were blocked by the firewall. The ports (SMB, RDP, RPC, WinRM) point to someone looking for a way to move to other machines.` },
          senior: { title: 'Internal service discovery (T1046)', text: `${c.src} probed ${c.hosts} hosts × ports [${c.ports.join(',')}], ${c.dropped}/${c.probes} dropped. The ports that were allowed show which paths are reachable. Workstation-to-server SMB/RDP should be limited to jump hosts.` },
        },
      };
    }

    case 'creddump': {
      const cmd = f.dets.find((d) => d.ctx.cmd)?.ctx.cmd as string | undefined;
      const file = f.dets.find((d) => d.ctx.file)?.ctx.file as string | undefined;
      const access = rule(f, 'lsass-access')?.ctx.access;
      return {
        phase: 'credential-access', severity: 'critical', key: true, confidence: 0.95,
        technique: { id: 'T1003.001', name: 'OS Credential Dumping: LSASS Memory' }, label: 'LSASS credential dump', iocs: [file].filter(Boolean) as string[],
        n: {
          layman: { title: 'Passwords stolen from memory', text: `At ${t}, the attacker copied the part of ${plainHost(h)}'s memory where Windows keeps login passwords. With those stolen passwords, they could log into other computers as someone else.` },
          analyst: { title: `Credential dumping on ${h}`, text: `${cmd ? `"${short(cmd, 80)}"` : 'A process'} created a full memory dump of lsass.exe${file ? ` at ${file}` : ''}. Treat every credential cached on ${h}, including service accounts, as compromised (T1003.001).` },
          senior: { title: 'LSASS minidump via comsvcs.dll (T1003.001)', text: `${ts}: ${cmd ?? 'LSASS access'}${access ? `; GrantedAccess ${access}` : ''}${file ? `; output ${file}` : ''}. This uses a built-in Windows DLL, so it gets past signature-based antivirus. Reset every account with a session on ${h}, enable LSA protection (RunAsPPL) and Credential Guard, and alert on access to lsass.exe from rundll32.` },
        },
      };
    }

    case 'brute': {
      const c = f.dets[0].ctx;
      return {
        phase: 'credential-access', severity: 'high', key: true, confidence: 0.9,
        technique: { id: 'T1110.001', name: 'Brute Force: Password Guessing' }, label: `Brute force (${c.attempts} attempts)`, iocs: [c.src],
        n: {
          layman: { title: 'Someone tries hundreds of passwords', text: `Starting at ${t}, a computer on the internet tried to log into ${plainHost(h)} ${c.attempts} times in ${c.minutes} minutes, guessing names like ${list(c.users.slice(0, 3).map((u: string) => `"${u}"`))}, like someone trying every key on a giant key ring.` },
          analyst: { title: `Password brute force against ${h}`, text: `${c.attempts} failed logins from ${c.src} across ${c.userCount} usernames (${c.users.slice(0, 6).join(', ')}) over ${c.minutes} min. Internet-exposed SSH with password authentication enabled.` },
          senior: { title: `SSH password spraying from ${c.src} (T1110.001)`, text: `${c.attempts} failures, ${c.userCount} distinct users, ${c.minutes} min window. Disable PasswordAuthentication, enforce keys and MFA, add fail2ban, geo-block, and report ${c.src} to abuse contacts.` },
        },
      };
    }

    case 'validlogin': {
      const c = f.dets[0].ctx;
      return {
        phase: 'initial-access', severity: 'critical', key: true, confidence: 0.9,
        technique: { id: 'T1078', name: 'Valid Accounts' }, label: `Login as ${c.user}`, iocs: [c.src],
        n: {
          layman: { title: 'One of the guesses works', text: `At ${t}, one guess finally worked. The attacker logged in as "${c.user}". The door was open.` },
          analyst: { title: `Successful login after brute force: ${c.user}`, text: `Valid login for ${c.user} from ${c.src} after ${c.after} failed attempts. The account's password was weak or reused, so the attacker now has interactive access.` },
          senior: { title: `Compromised valid account ${c.user} (T1078)`, text: `${ts}: Accepted password for ${c.user} from ${c.src}. Lock the account, kill its sessions, review ~/.bash_history and authorized_keys, and audit sudoers rights.` },
        },
      };
    }

    case 'privesc': {
      return {
        phase: 'privilege-escalation', severity: 'high', key: true, confidence: 0.85,
        technique: { id: 'T1548.003', name: 'Abuse Elevation Control: Sudo' }, label: 'Root shell via sudo',
        n: {
          layman: { title: 'The attacker becomes the boss of the machine', text: `At ${t}, they used ${who}'s permissions to switch to the all-powerful administrator account, called "root". Now they could change anything.` },
          analyst: { title: `Privilege escalation to root on ${h}`, text: `${f.user ?? 'The user'} ran a root shell via sudo. The account has unrestricted sudo rights, which gave the attacker full control.` },
          senior: { title: 'sudo to interactive root shell (T1548.003)', text: `${short(f.dets[0].ctx.cmd, 140)}. Lock sudoers to the specific commands each user needs, require a password with a short timeout, and log every sudo session.` },
        },
      };
    }

    case 'lateral': {
      const c = f.dets[0].ctx;
      const from = f.fromHost, to = f.toHost;
      const svc = /^(svc|service)/i.test(f.user ?? '');
      const tech = c.method === 'RDP' ? { id: 'T1021.001', name: 'Remote Services: RDP' } : c.method === 'PsExec' ? { id: 'T1021.002', name: 'Remote Services: SMB/Admin Shares (PsExec)' } : { id: 'T1021', name: 'Remote Services' };
      const how = c.method === 'RDP' ? ' by remotely taking over its screen and keyboard' : '';
      return {
        phase: 'lateral-movement', severity: 'high', key: true, confidence: 0.9, technique: tech,
        label: `${from} → ${to} (${c.method})`,
        n: {
          layman: { title: `The attack spreads to the ${lowerFriendly(to)}`,
            text: `At ${t}, using a stolen password, the attacker jumped from ${plainHost(from)} to ${plainHost(to)}${how}. That made ${cx.compromisedCount} computers under their control.` },
          analyst: { title: `Lateral movement ${from} → ${to} via ${c.method}`,
            text: c.method === 'PsExec'
              ? `${t} UTC: logon with explicit credentials (event 4648), then a network logon (type 3) as ${f.user} on ${to} and installation of the PSEXESVC service. This is PsExec remote execution using the credentials stolen earlier.${svc ? ` ${f.user} is a service account and should never be used from a workstation.` : ''}`
              : `${t} UTC: ${c.method} logon (type ${c.method === 'RDP' ? 10 : 3}) on ${to} as ${f.user} from ${from}.${svc ? ` A service account opening an interactive desktop session is a red flag.` : ''}` },
          senior: { title: `${c.method} pivot ${from} → ${to} (${tech.id})`,
            text: `${ts}: ${c.method === 'PsExec' ? '4648 → 4624/3 → 7045 PSEXESVC → child process' : `4624 logon type ${c.method === 'RDP' ? 10 : 3}`} as ${f.user}. Disable ${f.user} and reset its password, block SMB and RDP between workstations, and add "deny log on through RDP" for service accounts.` },
        },
      };
    }

    case 'collect': {
      const arch = rule(f, 'archive-staging');
      const cmd = (arch ?? f.dets[0]).ctx.cmd as string;
      const folders = [...cmd.matchAll(/\\(Finance|HR|Payroll|Legal|Clients?|Customers?|Accounting|Contracts)\\?/gi)].map((m) => m[1]);
      const uniq = [...new Set(folders)];
      return {
        phase: 'collection', severity: 'high', key: false, confidence: 0.8,
        technique: { id: 'T1560.001', name: 'Archive Collected Data: Archive via Utility' }, label: 'Data staged in archive',
        iocs: [arch?.ctx.archive].filter(Boolean) as string[],
        n: {
          layman: { title: 'Gathering the valuables', text: `At ${t}, on ${plainHost(h)}, the attacker bundled ${uniq.length ? `the ${list(uniq)} folders` : 'company folders'} into a single ${arch?.ctx.password ? 'password-protected ' : ''}package, like stuffing valuables into a locked bag before leaving.` },
          analyst: { title: `Data staged for exfiltration on ${h}`, text: `The attacker listed the file shares, then compressed ${uniq.length ? list(uniq) : 'shared'} data into ${arch?.ctx.archive ?? 'an archive'}${arch?.ctx.password ? ' with a password (so the content can\'t be inspected in transit)' : ''}.` },
          senior: { title: 'Staging via 7-Zip (T1560.001, T1039)', text: f.dets.map((d) => short(d.ctx.cmd, 110)).join(' ; ') + `. Recover the archive from ${h} if it is still there. The password is in the command line, so the contents can be listed to scope the breach.` },
        },
      };
    }

    case 'backdoor': {
      const svc = rule(f, 'malicious-service');
      const task = rule(f, 'scheduled-task');
      const acct = rule(f, 'account-created');
      const grp = rule(f, 'admin-group-add');
      const cron = rule(f, 'cron');
      const key = rule(f, 'ssh-key');
      const plain: string[] = [];
      const tech: string[] = [];
      if (svc) { plain.push(`a fake "${svc.ctx.name}" program that starts by itself`); tech.push(`service ${svc.ctx.name} → ${svc.ctx.file} (auto-start, T1543.003)`); }
      if (task) { plain.push('a scheduled task that keeps re-launching it'); tech.push(`scheduled task ${task.ctx.task ?? ''} (T1053.005)`); }
      if (cron) { plain.push('a timer that restarts the malware every few minutes'); tech.push('root crontab entry (T1053.003)'); }
      if (acct) { plain.push(`a brand-new ${grp || acct.ctx.uid0 ? 'administrator ' : ''}account called "${acct.ctx.account}"`); tech.push(`account ${acct.ctx.account}${grp ? ' added to Administrators' : ''}${acct.ctx.uid0 ? ' with UID 0' : ''} (T1136.001)`); }
      if (key) { plain.push('their own login key'); tech.push('attacker SSH key appended to authorized_keys (T1098.004)'); }
      const primary = svc ? { id: 'T1543.003', name: 'Create or Modify System Process: Windows Service' } : task ? { id: 'T1053.005', name: 'Scheduled Task' } : cron ? { id: 'T1053.003', name: 'Scheduled Task/Job: Cron' } : { id: 'T1136.001', name: 'Create Account: Local Account' };
      return {
        phase: 'persistence', severity: 'critical', key: true, confidence: 0.92, technique: primary,
        label: 'Backdoor installed', iocs: [svc?.ctx.file, svc?.ctx.name, acct?.ctx.account].filter(Boolean) as string[],
        n: {
          layman: { title: 'A hidden back door is installed', text: `At ${t}, the attacker installed a hidden back door on ${plainHost(h)}: ${list(plain)}. Even if someone removed the original malware, this would let them walk right back in.` },
          analyst: { title: `Persistence established on ${h}`, text: `Within ${ago((f.endTs ?? f.ts) - f.ts + 60000)}, ${tech.length} persistence mechanisms were created on ${h}: ${tech.join('; ')}. All of them must be removed during eradication.` },
          senior: { title: `Layered persistence on ${h} (${primary.id})`, text: `${tech.join(' | ')}. Several overlapping mechanisms mean the attacker planned to stay long-term. Rebuild the host instead of cleaning it, and hunt across the domain for the same service name, task path and account.` },
        },
      };
    }

    case 'exfil': {
      const egress = rule(f, 'large-egress');
      const up = rule(f, 'upload-tool');
      const big = rule(f, 'large-upload');
      const bytes = Math.max(egress?.ctx.bytes ?? 0, big?.ctx.bytes ?? 0);
      const dst = egress?.ctx.dst;
      const url = up?.ctx.url ?? big?.ctx.url;
      const dur = egress?.ctx.duration ? Number(egress.ctx.duration) : undefined;
      return {
        phase: 'exfiltration', severity: 'critical', key: true, confidence: 0.93,
        technique: { id: 'T1041', name: 'Exfiltration Over C2 Channel' }, label: `${fmtBytes(bytes)} exfiltrated`,
        iocs: [dst, url].filter(Boolean) as string[],
        n: {
          layman: { title: 'Company data is stolen', text: `At ${t}, the attacker sent ${spokenBytes(bytes)} of company files from ${plainHost(h)} to their own server on the internet. That is roughly the size of hundreds of thousands of documents.` },
          analyst: { title: `Exfiltration: ${fmtBytes(bytes)} to ${dst ?? 'external host'}`, text: `${fmtBytes(bytes)} uploaded from ${h} to ${dst ?? 'an external IP'}${url ? ` (${short(url, 60)})` : ''}${dur ? ` over ${Math.round(dur / 60)} minutes` : ''}. The destination is the same infrastructure used for command and control, so this is the same attacker.` },
          senior: { title: `Exfil over HTTPS (T1041/T1048.002)`, text: `${up ? short(up.ctx.cmd, 100) + '; ' : ''}firewall egress ${fmtBytes(bytes)} to ${dst}:${egress?.ctx.port ?? 443}${dur ? ` in ${dur}s (~${(bytes / dur / 1e6).toFixed(1)} MB/s)` : ''}. Assume the archived data was taken. Start legal and privacy breach assessment, and add DLP and egress volume alerting for server networks.` },
        },
      };
    }

    case 'cleanup': {
      const cmds = f.dets.map((d) => d.ctx.cmd ?? d.ctx.file ?? d.ctx.msg).filter(Boolean) as string[];
      return {
        phase: 'defense-evasion', severity: 'high', key: true, confidence: 0.9,
        technique: { id: 'T1070.001', name: 'Indicator Removal: Clear Windows Event Logs' }, label: 'Logs cleared',
        n: {
          layman: { title: 'Covering their tracks', text: `At ${t}, the attacker erased the security records on ${plainHost(h)} and deleted their leftover files, like a burglar wiping away fingerprints. Luckily, copies of the logs kept on other systems still told the story.` },
          analyst: { title: `Logs cleared on ${h}`, text: `The security event log was wiped${f.dets.some((d) => d.rule === 'evidence-deleted') ? ' and evidence files were deleted' : ''}. Clearing logs is almost never legitimate. Rely on centrally collected copies and treat ${h} as fully compromised.` },
          senior: { title: 'Indicator removal (T1070.001 / T1070.004)', text: `${cmds.map((c) => short(c, 70)).join(' ; ')}. Event 1102 should page the on-call team immediately. Deleted files may still be recoverable from a disk image. Forward all logs off the host in real time.` },
        },
      };
    }

    case 'miner': {
      const pool = f.dets.find((d) => d.ctx.pool)?.ctx.pool;
      return {
        phase: 'impact', severity: 'high', key: true, confidence: 0.9,
        technique: { id: 'T1496', name: 'Resource Hijacking' }, label: 'Cryptominer running', iocs: [pool].filter(Boolean) as string[],
        n: {
          layman: { title: 'The server is put to work mining cryptocurrency', text: `From ${t}, a hidden program used nearly all of ${plainHost(h)}'s processing power to mine cryptocurrency for the attacker, which slows everything down and runs up the bill.` },
          analyst: { title: `Cryptominer on ${h}`, text: `CPU pinned at about 100% by a miner process${pool ? ` connected to ${pool}` : ''}. This is resource hijacking (T1496). The host is fully compromised.` },
          senior: { title: 'XMR miner deployment (T1496)', text: `${f.dets.slice(0, 2).map((d) => short(d.ctx.msg, 90)).join(' ; ')}. Kill the process, remove the cron entry and binary, block the pool at egress, and rebuild the host.` },
        },
      };
    }

    case 'webattack': {
      const c = f.dets[0].ctx;
      return {
        phase: 'initial-access', severity: 'high', key: true, confidence: 0.75,
        technique: { id: 'T1190', name: 'Exploit Public-Facing Application' }, label: 'Web exploit attempts', iocs: [c.src],
        n: {
          layman: { title: 'Attacker pokes at the website', text: `At ${t}, someone sent the website specially crafted requests designed to trick it into revealing data or running commands.` },
          analyst: { title: 'Web application attack', text: `${f.dets.length} malicious requests from ${c.src}, e.g. "${short(c.request, 80)}". Check whether any of them got a 200 response.` },
          senior: { title: 'Exploit attempts against web tier (T1190)', text: `${f.dets.slice(0, 3).map((d) => short(d.ctx.request, 70)).join(' ; ')}. Correlate with app and WAF logs, then patch, add a virtual patch in the WAF, and block the source.` },
        },
      };
    }
  }
}

function safeHost(u: string) {
  try { return new URL(u).hostname; } catch { return undefined; }
}

// ---------------------------------------------------------------------------
// assemble incident
// ---------------------------------------------------------------------------
export function buildIncident(env: Env, findings: Finding[], sources: number): Incident {
  const firstOf = new Set<Group>();
  const compromised = new Map<string, number>();
  const events: TimelineEvent[] = [];

  findings.forEach((f, i) => {
    for (const hh of [f.host, f.toHost]) {
      if (hh && ['exec', 'lateral', 'c2', 'creddump', 'validlogin', 'miner', 'backdoor', 'privesc'].includes(f.group) && !compromised.has(hh) && !(f.group === 'lateral' && hh === f.fromHost))
        compromised.set(hh, f.ts);
    }
    if (f.fromHost && !compromised.has(f.fromHost)) compromised.set(f.fromHost, f.ts);
    const b = build(f, { env, firstOf, compromisedCount: compromised.size });
    firstOf.add(f.group);
    events.push({
      id: `e${i + 1}`, ts: f.ts, endTs: f.endTs, phase: b.phase, severity: b.severity, technique: b.technique,
      host: f.host, fromHost: f.fromHost, toHost: f.toHost, user: f.user, label: b.label, key: b.key,
      confidence: b.confidence, narratives: b.n, iocs: b.iocs, evidence: [...new Set(f.ids)].slice(0, 25),
    });
  });

  // assets
  const assetIds = new Set<string>();
  for (const e of events) [e.host, e.fromHost, e.toHost].forEach((h) => h && assetIds.add(h));
  const externals = new Set<string>();
  for (const f of findings) for (const d of f.dets) {
    const ip = d.ctx.dst ?? (d.group === 'brute' || d.group === 'validlogin' || d.group === 'webattack' ? d.ctx.src : undefined);
    if (ip && !isPrivateIp(ip)) externals.add(ip);
  }
  const ipOf = new Map([...env.ipToHost].map(([ip, h]) => [h, ip]));
  const assets: Asset[] = [...assetIds].map((id) => ({ id, kind: assetKind(id), friendly: friendly(id), ip: ipOf.get(id), compromisedAt: compromised.get(id) }));
  for (const ip of externals) {
    const dom = domainFor(env, ip);
    assets.push({ id: ip, kind: 'external', friendly: "Attacker's server", ip, compromisedAt: undefined, ...(dom ? { friendly: `Attacker's server (${dom})` } : {}) });
  }

  const startTs = events.length ? events[0].ts : env.records[0]?.ts ?? 0;
  const endTs = events.length ? Math.max(...events.map((e) => e.endTs ?? e.ts)) : env.records.at(-1)?.ts ?? 0;
  const severity = events.reduce<Severity>((s, e) => (SEV_ORDER.indexOf(e.severity) > SEV_ORDER.indexOf(s) ? e.severity : s), 'info');
  const groups = new Set(findings.map((f) => f.group));
  const exfilBytes = Math.max(0, ...findings.filter((f) => f.group === 'exfil').flatMap((f) => f.dets.map((d) => d.ctx.bytes ?? 0)));
  const hostsHit = [...compromised.keys()];

  const vector = groups.has('phish') ? 'Phishing' : groups.has('brute') ? 'SSH brute force' : groups.has('webattack') ? 'Web exploit' : 'Intrusion';
  const outcomes = [
    groups.has('lateral') && `${hostsHit.length} hosts compromised`,
    groups.has('backdoor') && 'backdoor installed',
    groups.has('exfil') && `${fmtBytes(exfilBytes)} exfiltrated`,
    groups.has('miner') && 'cryptominer deployed',
  ].filter(Boolean) as string[];
  const title = events.length ? `${vector} intrusion${outcomes.length ? `: ${outcomes.join(', ')}` : ''}` : 'No malicious activity detected';

  const inc: Incident = {
    title,
    summary: '',
    severity,
    startTs,
    endTs,
    engine: 'heuristic',
    assets,
    users: [...new Set(events.map((e) => e.user).filter(Boolean))] as string[],
    events,
    stories: {} as Incident['stories'],
    stats: { records: env.records.length, sources, flagged: new Set(events.flatMap((e) => e.evidence)).size },
  };
  const plainVector = groups.has('phish')
    ? (findings.find((f) => f.group === 'phish')?.dets[0].ctx.subject ?? '').match(/invoice|payment/i) ? 'a fake invoice email' : 'a booby-trapped email'
    : groups.has('brute') ? 'a guessed password' : groups.has('webattack') ? 'a website flaw' : 'a break-in';
  const plainOutcome = groups.has('exfil') ? 'stolen company data' : groups.has('miner') ? 'a hijacked server' : groups.has('backdoor') ? 'a hidden back door' : 'a compromised computer';
  inc.summary = events.length
    ? `${vector} on ${DATE(startTs)} led to ${list(outcomes.length ? outcomes : ['a compromised host'])} over ${ago(endTs - startTs)}.`
    : 'The analyzed logs did not match any known attack patterns.';
  inc.stories = {
    layman: buildStory('layman', inc, { plainVector, plainOutcome, groups, exfilBytes, hostsHit }),
    analyst: buildStory('analyst', inc, { plainVector, plainOutcome, groups, exfilBytes, hostsHit }),
    senior: buildStory('senior', inc, { plainVector, plainOutcome, groups, exfilBytes, hostsHit }),
  };
  return inc;
}

interface StoryCtx { plainVector: string; plainOutcome: string; groups: Set<Group>; exfilBytes: number; hostsHit: string[] }

/** Which events become video scenes for each audience (the interactive timeline always has all of them). */
export function pickEvents(level: Level, events: TimelineEvent[]): TimelineEvent[] {
  const cap = level === 'layman' ? 9 : level === 'analyst' ? 11 : 12;
  const minSev = level === 'layman' ? 5 : level === 'analyst' ? 3 : 2; // non-key events need at least this severity
  const out = events.filter((e) => e.key || SEV_ORDER.indexOf(e.severity) >= minSev);
  // drop the least severe non-key (then key) events until we fit, keeping chronological order
  while (out.length > cap) {
    const rank = (e: TimelineEvent) => (e.key ? 10 : 0) + SEV_ORDER.indexOf(e.severity);
    const worst = out.reduce((w, e) => (rank(e) < rank(w) || (rank(e) === rank(w) && e.ts > w.ts) ? e : w));
    out.splice(out.indexOf(worst), 1);
  }
  return out;
}

function buildStory(level: Level, inc: Incident, c: StoryCtx): Story {
  const evs = pickEvents(level, inc.events);
  const dur = ago(inc.endTs - inc.startTs);
  const date = DATE(inc.startTs);
  const nHosts = c.hostsHit.length;
  const tactics = new Set(inc.events.map((e) => e.phase)).size;
  const ext = inc.assets.filter((a) => a.kind === 'external').map((a) => a.id);
  const iocCount = new Set(inc.events.flatMap((e) => e.iocs ?? [])).size;

  if (!inc.events.length) {
    return { level, title: 'All clear', tldr: inc.summary, recommendations: ['Keep collecting logs centrally.'],
      scenes: [{ id: 's0', kind: 'intro', heading: 'All clear', narration: 'We analyzed the logs and found no signs of an attack.' }] };
  }

  const outcomesPlain = [
    nHosts > 1 && `took over ${nHosts} computers`,
    c.groups.has('backdoor') && 'planted a hidden back door',
    c.groups.has('exfil') && `stole ${spokenBytes(c.exfilBytes)} of company files`,
    c.groups.has('miner') && 'turned a server into a cryptocurrency mine',
  ].filter(Boolean) as string[];

  const title =
    level === 'layman' ? `How ${c.plainVector} led to ${c.plainOutcome}` :
    level === 'analyst' ? `Incident briefing: ${inc.title}` : `Technical brief: ${inc.title}`;

  const intro: Scene = {
    id: 'intro', kind: 'intro', heading: title,
    narration:
      level === 'layman'
        ? `Here is what happened on ${date}, explained in plain English. In short: an attacker got in through ${c.plainVector}, and over ${dur} they ${list(outcomesPlain.length ? outcomesPlain : ['caused trouble'])}. Let's walk through it, step by step.`
        : level === 'analyst'
          ? `Incident briefing for ${date}. Between ${T(inc.startTs)} and ${T(inc.endTs)} UTC we observed ${inc.events.length} malicious events across ${nHosts} host${nHosts === 1 ? "" : "s"}, covering ${tactics} MITRE ATT&CK tactics. Overall severity is ${inc.severity}. Here is the sequence of events.`
          : `Technical incident brief. Window: ${TS(inc.startTs)} to ${TS(inc.endTs)}. Patient zero: ${c.hostsHit[0] ?? 'unknown'}. ${nHosts} host${nHosts === 1 ? "" : "s"} compromised, ${tactics} tactics, ${iocCount} indicators extracted from ${inc.stats.records.toLocaleString()} log records across ${inc.stats.sources} sources. Confidence is high: findings are corroborated by more than one log source.`,
    bullets:
      level === 'layman' ? outcomesPlain.map((s) => s[0].toUpperCase() + s.slice(1)) :
      [`${inc.events.length} events`, `${nHosts} host${nHosts === 1 ? "" : "s"} compromised`, `${tactics} ATT&CK tactics`, `Severity: ${inc.severity}`],
  };

  const scenes: Scene[] = [intro, ...evs.map((e): Scene => ({ id: `s-${e.id}`, kind: 'event', eventId: e.id, heading: e.narratives[level].title, narration: e.narratives[level].text }))];

  const summary: Scene = {
    id: 'summary', kind: 'summary',
    heading: level === 'layman' ? 'The whole story in one breath' : level === 'analyst' ? 'Impact summary' : 'Assessment',
    narration:
      level === 'layman'
        ? `So, in just ${dur}, ${c.plainVector} turned into a full break-in: the attacker ${list(outcomesPlain.length ? outcomesPlain : ['compromised a computer'])}. The good news is that every step left a trace in the logs, and that is how we pieced this story together.`
        : level === 'analyst'
          ? `Summary: ${nHosts} host${nHosts === 1 ? "" : "s"} compromised (${c.hostsHit.join(', ')}). Dwell time ${dur}. External infrastructure: ${ext.join(', ') || 'none identified'}. ${c.groups.has('exfil') ? `Data exfiltration of ${fmtBytes(c.exfilBytes)} is confirmed. ` : ''}This must be escalated to incident response now.`
          : `Assessment: a human operator worked the keyboard (interactive commands and staged tooling), following the phases ${[...new Set(inc.events.map((e) => PHASES.find((p) => p.id === e.phase)?.label))].join(' → ')}. ${c.groups.has('exfil') ? `Exfiltration of ${fmtBytes(c.exfilBytes)} to the same infrastructure used for C2 suggests a single actor. ` : ''}Assume all credentials touched are burned, and rebuild hosts rather than clean them.`,
    bullets: level === 'layman'
      ? [`${dur} from start to finish`, `${nHosts} computer${nHosts === 1 ? '' : 's'} affected`, c.groups.has('exfil') ? `${fmtBytes(c.exfilBytes)} of data stolen` : 'No data theft detected'].filter(Boolean)
      : [`Dwell time: ${dur}`, `Hosts: ${c.hostsHit.join(', ')}`, `IOCs: ${iocCount}`, ...(c.groups.has('exfil') ? [`Exfil: ${fmtBytes(c.exfilBytes)}`] : [])],
  };

  const recommendations = recommend(level, inc, c);
  const actions: Scene = {
    id: 'actions', kind: 'actions',
    heading: level === 'layman' ? 'What to do now' : level === 'analyst' ? 'Triage & escalation checklist' : 'Containment, eradication & detection plan',
    narration:
      level === 'layman'
        ? `What should happen now? ${recommendations.slice(0, 4).join('. ')}.`
        : level === 'analyst'
          ? `Recommended next steps: ${recommendations.slice(0, 5).join('. ')}.`
          : `Plan: ${recommendations.slice(0, 6).join('. ')}.`,
    bullets: recommendations,
  };

  return { level, title, tldr: inc.summary, scenes: [...scenes, summary, actions], recommendations };
}

function recommend(level: Level, inc: Incident, c: StoryCtx): string[] {
  const g = c.groups;
  const hosts = c.hostsHit;
  const accounts = [...new Set(inc.events.map((e) => e.user).filter(Boolean))] as string[];
  const ext = inc.assets.filter((a) => a.kind === 'external').map((a) => a.id);
  const iocs = [...new Set(inc.events.flatMap((e) => e.iocs ?? []))];
  const bd = inc.events.find((e) => e.label === 'Backdoor installed');
  if (level === 'layman') {
    return [
      `Disconnect the ${hosts.length} affected computer${hosts.length === 1 ? '' : 's'} from the network`,
      'Change the passwords of every affected account, and turn on two-step login',
      g.has('backdoor') ? 'Have IT rebuild the computer with the back door instead of just cleaning it' : 'Have IT wipe and reinstall the affected machines',
      g.has('phish') ? 'Remind everyone never to enable macros or "editing" on unexpected attachments' : g.has('brute') ? 'Turn off password logins to servers from the internet' : 'Keep software up to date',
      g.has('exfil') ? 'Ask the legal team whether customers or staff must be told about the stolen data' : 'Keep an eye out for any further unusual activity',
    ];
  }
  if (level === 'analyst') {
    return [
      `Isolate ${hosts.join(', ')} with EDR network containment`,
      `Disable and reset ${accounts.join(', ') || 'affected accounts'}`,
      ext.length ? `Block ${ext.join(', ')}${iocs.find((i) => /\.[a-z]{2,}$/i.test(i) && !/\.(exe|docm|7z|ps1)$/i.test(i)) ? ` and ${iocs.find((i) => /\.[a-z]{2,}$/i.test(i) && !/\.(exe|docm|7z|ps1)$/i.test(i))}` : ''} at firewall, proxy and DNS` : 'Block attacker infrastructure at the perimeter',
      bd ? `Remove persistence on ${bd.host}: ${(bd.iocs ?? []).join(', ')}` : 'Sweep for persistence (services, tasks, run keys, cron)',
      g.has('phish') ? 'Search all mailboxes for the phishing email and purge it' : 'Review exposed services and authentication settings',
      'Escalate to Tier 3 / incident response with this timeline attached',
    ];
  }
  return [
    `Contain: network-isolate ${hosts.join(', ')}. Preserve memory and disk images before remediation`,
    `Credentials: reset ${accounts.join(', ') || 'all touched accounts'}${g.has('creddump') ? ', plus every account cached on the dumped host. Consider a double krbtgt reset if DC exposure can\'t be ruled out' : ''}`,
    ext.length ? `Infrastructure: block and sinkhole ${ext.join(', ')}. Retro-hunt 90 days of proxy, DNS and firewall data for these indicators` : 'Retro-hunt extracted IOCs across 90 days of telemetry',
    g.has('backdoor') ? `Eradicate: rebuild ${bd?.host ?? 'affected hosts'} from a known-good image. Hunt the domain for the same service, task and account names` : 'Eradicate: rebuild compromised hosts from known-good images',
    g.has('phish') ? 'Detection gap: a macro-enabled attachment was delivered with verdict=clean. Block .docm/.xlsm from external senders and enforce attachment sandboxing' : g.has('brute') ? 'Detection gap: no alert fired on the brute force. Add thresholds for failed auth and disable SSH password auth' : 'Close the initial-access gap',
    g.has('lateral') ? 'Hardening: block workstation-to-workstation SMB and RDP, deny interactive and RDP logon for service accounts, enable LSA protection and Credential Guard' : 'Hardening: least-privilege sudo, MFA on all remote access',
    'Detections to add: event 1102 (log cleared), 7045 with a binary in a user-writable path, LSASS access from rundll32, periodic beaconing analytics',
    ...(g.has('exfil') ? ['Legal and privacy: scope the exfiltrated archive contents and assess notification obligations'] : []),
  ];
}
