# Test logs (CSV)

These are attack scenarios as SIEM-export CSV files: `_time, host, source, sourcetype, _raw`. This is the shape Splunk and similar tools export. `_raw` is the original log line, so the analysis is identical to the original files in `samples/`.

**To use:** on the **Import** page, drag in every CSV from one folder at the same time. Each scenario is spread across several sources, and the attack only shows up when the sources are combined.

**To save API credits:** pick **Offline rules** before importing to see the free result first, then use **Re-analyze** with Claude when you want the AI version.

To regenerate these files: `npx tsx scripts/samples-to-csv.ts`

## `operation-nightfall-csv/`: phishing → domain-wide compromise → data theft (14 Oct 2026)

Six sources, 1,380 records, with benign activity mixed in: a mail gateway, Windows Security events, Sysmon, the web proxy, the firewall, and DNS/DHCP. The offline engine finds 16 events, severity **critical**.

| Time (UTC) | Phase | What happened |
|---|---|---|
| 08:52 | Initial access | A phishing email with a macro attachment reaches the accounting workstation WS-ACCT-07 |
| 09:03 | Execution | The macro launches encoded PowerShell, which downloads a payload |
| 09:04 | Persistence | A Run key is added |
| 09:04 → | Command & control | Regular beaconing to 185.220.101.47 |
| 10:12 | Discovery | Recon commands (`whoami`, `net group`, …) |
| 11:30 | Discovery | An internal port scan of 36 hosts |
| 13:47 | Credential access | The LSASS memory is dumped (password theft) |
| 14:02 | Lateral movement | PsExec to the HR workstation WS-HR-02 |
| 15:10 | Lateral movement | RDP to the file server FS-01 |
| 15:12 | Collection | Data is staged in an archive |
| 16:04 | Persistence | A backdoor (service, scheduled task and rogue admin account) |
| 16:19 | Exfiltration | 2.4 GB uploaded out |
| 16:45 | Defense evasion | Event logs cleared |

## `ssh-cryptominer-csv/`: SSH brute force → root → cryptominer (21 Oct 2026)

Two sources (`auth` and `syslog`) from the Linux web server web-01, 414 records. The offline engine finds 7 events, severity **critical**.

| Time (UTC) | Phase | What happened |
|---|---|---|
| 02:14 | Credential access | 340 password guesses over SSH from one IP |
| 02:31 | Initial access | A successful login as `deploy` |
| 02:33 | Privilege escalation | A root shell via sudo |
| 02:34 | Execution / impact | A miner is downloaded and run; CPU is pinned |
| 02:35 | Persistence | A cron job, a UID-0 user and an SSH key |
| 02:36 | Defense evasion | Shell history cleared |

## `homelab-outage-2026-11-05/`

This one is an operational outage (disk full), not an attack. Ignore it for security demos.
