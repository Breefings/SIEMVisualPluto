# SeenVisualizer

**Turn a pile of security logs into a story anyone can follow.**
Built for Pluto Hacks 2026 (AI × Cybersecurity).

During an incident, analysts face thousands of log lines across many tools. The question everyone actually asks is simple: *what happened, in what order, and how bad is it?* SeenVisualizer:

1. **Ingests logs from anywhere** (CSV, TSV, JSON, JSONL, syslog, Apache/Nginx/Squid access logs, key=value firewall logs, free text) and puts them on one UTC clock.
2. **Reconstructs the attack** with an AI pipeline. About 20 MITRE ATT&CK-mapped detection rules plus correlation follow the attacker from host to host. Then **Claude** (`claude-opus-5-5`) confirms, corrects and extends the findings into a structured incident.
3. **Explains it at three levels of abstraction:**
   | Level | Audience | Style |
   |---|---|---|
   | **Layman** | executives, employees, customers | No jargon, analogies, "the accounting laptop", why it matters |
   | **Entry-level SOC** | Tier-1 analyst | Attack phases, ATT&CK technique IDs, hosts/accounts, triage and escalation steps |
   | **Senior / IR lead** | Tier-3, DFIR | Commands, event IDs, decoded payloads, IOCs, confidence, detection gaps, containment plan |
4. **Presents it two ways:**
   - **Interactive timeline.** The same animated timeline as the video, but you drive it: click any checkpoint (or card, or use the arrow keys) and the camera flies there; scroll to zoom, drag to pan, and one button zooms back out to the whole attack. Below it are a story feed, event details with evidence, and a raw-log explorer for whatever window you are looking at.
   - **Narrated motion-graphics video.** Built in code with [Remotion](https://remotion.dev) (React). It is styled like a historical-timeline video: it opens on the whole attack zoomed out, dives into the first event, then flies along the timeline from event to event (zooming out mid-flight, then back in). Each event card has its own animation (a phishing envelope opening, a radar sweep, a key being stolen, an arc jumping between hosts, files streaming out, logs being erased). It also has a fast-forwarding clock, parallax depth, sentence-by-sentence karaoke subtitles, and male voice-over from **[Piper](https://github.com/rhasspy/piper)**, an open-source neural TTS engine that runs locally. Watch it in the browser or export an MP4 (720p by default; set `RENDER_SCALE=1` for 1080p).

```
 logs ──► parsers ──► normalized records ──► rule engine + correlation ──► Claude (structured output)
                                                    │                            │
                                                    └──────► Incident (events × 3 narratives, assets, stories)
                                                                     │
                                       ┌─────────────────────────────┴──────────────────────────┐
                                Interactive timeline (React + d3 scales)        Video (Remotion + Piper TTS)
```

## Quick start (Windows)

```powershell
# one time: downloads portable Node 24, Piper + a male voice (Ryan) into .tools/, installs deps, builds the UI
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1

# optional: enable Claude
copy .env.example .env   # then put your ANTHROPIC_API_KEY in it

# run
powershell -ExecutionPolicy Bypass -File scripts\start.ps1
# open http://localhost:8000
```

If Node is already installed you can just run `npm install`, `npm run build` and `npm start`. TTS needs the Piper binary and voices (run `setup.ps1`, or point `PIPER_PATH` / `PIPER_VOICES` at your own install).  Narration uses Ryan (medium) by default; set `PIPER_VOICE=en_US-ryan-high` for a richer but ~5x slower voice (download it into `.tools/voices`).

Dev mode with hot reload: `npm run dev` (UI on :5173, proxied to the API on :8000).

## Try it

Open **Import logs**, then **Try a sample investigation**:

- **Operation Nightfall.** A fake invoice email arrives at 8:52 AM. Macro malware runs at 9:03, C2 beaconing starts, then recon, an internal port scan, and an LSASS credential dump at 1:47 PM. **2:02 PM:** PsExec to the HR workstation. **3:10 PM:** RDP to the file server. **4:04 PM:** backdoor (service, scheduled task and rogue admin account). **4:19 PM:** 2.4 GB exfiltrated. **4:45 PM:** logs wiped. The evidence is spread across 6 sources (Windows Security CSV, Sysmon JSONL, firewall syslog, proxy log, mail gateway, DHCP/DNS) with benign noise mixed in.
- **SSH brute force → cryptominer.** 340 password guesses, a successful login, a sudo root shell, a miner, cron persistence, a UID-0 user, an SSH key, and `history -c`.

Regenerate them with `npm run samples`. Try the engine from the CLI with `npx tsx scripts/try-engine.ts samples/operation-nightfall layman`.

## AI engine

- **Offline rule engine** (`server/analysis/`): always available, deterministic, no data leaves the machine. It handles phishing attachments, Office→shell spawns, encoded PowerShell (decoded for the senior view), payload downloads, masquerading binaries, Run keys, services, scheduled tasks, cron, rogue accounts, SSH keys, beaconing (interval/jitter analysis), port scans, brute force, login-after-brute-force, LSASS dumping, lateral movement (PsExec/SMB/RDP from already-compromised hosts), staging, exfiltration (volume plus upload tools), log clearing, sudo escalation, cryptomining and web exploits. Findings are correlated by tactic, host and time.
- **Claude** (`server/analysis/claude.ts`): runs when `ANTHROPIC_API_KEY` is set. The logs are compressed into a digest: repetitive lines are collapsed with counts and intervals, and flagged lines are kept verbatim. That digest goes to Claude with the rule engine's findings as hints. Claude returns schema-validated JSON (structured outputs) where every event cites the record IDs that support it. Log content is treated as untrusted data, so prompt-injection attempts hidden in logs are reported as evidence, not followed. Server-side refusal fallbacks are enabled. If the call fails, the app falls back to the offline engine.

## Project layout

```
server/            Express API on :8000 (parsing, analysis, TTS, MP4 rendering)
  parsers.ts       universal log parser
  analysis/        detect.ts (rules) · narrate.ts (3-level narratives) · claude.ts (AI) · env.ts
  tts.ts           Piper narration (male voice, cached)
  render.ts        Remotion server-side MP4 rendering
video/             Remotion composition (timeline camera, event cards, per-phase animations, subtitles)
web/               React UI (import, aggregate, interactive timeline, video player)
shared/            types, theme, icons shared by server, UI and video
samples/           generated demo datasets
scripts/           setup.ps1 · start.ps1 · gen-samples.ts · try-engine.ts
```

## Roadmap

- **Aggregate logs** (button in place): live connectors for Docker, Kubernetes, Prometheus/Loki, Outlook/M365, syslog receiver, CloudTrail, Splunk/Elastic and Windows Event Forwarding. These feed the same `parseFile()` pipeline.
- Multi-incident clustering, case notes and sharing, and STIX export of IOCs.

## Licenses

Piper (MIT) and its voice models (see each model card). Remotion is free for individuals and small teams; check [remotion.dev/license](https://remotion.dev/license) before commercial use.
