/**
 * Windows event logs over the built-in OpenSSH Server: runs Get-WinEvent through
 * `powershell -EncodedCommand` (no quoting problems, works whether the SSH shell is cmd or PowerShell).
 */
import type { SourceConfig } from '../../shared/sources.ts';
import { jsonl, normalizeWinEvents, slug, winEventScript, withSsh, type Collected, type Window } from './util.ts';

const ps = (script: string) => `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${Buffer.from(script, 'utf16le').toString('base64')}`;

export async function testWindows(s: SourceConfig): Promise<string> {
  return withSsh(s, async (ssh) => {
    const r = await ssh.run(ps(`
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$os = (Get-CimInstance Win32_OperatingSystem).Caption
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$sec = $null -ne (Get-WinEvent -LogName Security -MaxEvents 1 -ErrorAction SilentlyContinue)
$sysmon = $null -ne (Get-WinEvent -ListLog 'Microsoft-Windows-Sysmon/Operational' -ErrorAction SilentlyContinue)
"$env:COMPUTERNAME|$os|$admin|$sec|$sysmon"`));
    const [host, os, admin, sec, sysmon] = r.out.trim().split('|');
    if (!host) throw new Error(r.err.trim().slice(0, 200) || 'PowerShell did not respond');
    return `${os} on ${host} · ${sec === 'True' ? 'Security log readable' : 'Security log NOT readable (needs an administrator account)'}${sysmon === 'True' ? ' · Sysmon installed' : ''}${admin === 'True' ? '' : ' · not elevated'}`;
  });
}

export async function collectWindows(s: SourceConfig, w: Window): Promise<Collected> {
  return withSsh(s, async (ssh) => {
    const r = await ssh.run(ps(winEventScript(w.since)), 80 * 1024 * 1024);
    const rows = normalizeWinEvents(r.out, w) as { host?: string; channel?: string }[];
    if (!rows.length && r.err.trim()) throw new Error(r.err.trim().slice(0, 200));
    const host = rows[0]?.host ?? s.name;
    const byChannel = new Map<string, number>();
    rows.forEach((x) => byChannel.set(x.channel ?? '?', (byChannel.get(x.channel ?? '?') ?? 0) + 1));
    return {
      files: [{ name: `windows-${slug(host)}-events.jsonl`, text: jsonl(rows) }],
      notes: [
        `${rows.length} events from ${host}: ${[...byChannel].map(([c, n]) => `${c.replace(/^Microsoft-Windows-|\/Operational$/g, '')} ${n}`).join(', ') || 'none'}`,
        ...(byChannel.has('Security') ? [] : ['No Security events: the account is probably not an administrator.']),
      ],
    };
  });
}
