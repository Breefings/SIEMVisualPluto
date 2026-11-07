# SeenVisualizer agent

`seen-agent.mjs` is a single file with no dependencies. It records hardware utilization on the machine it runs on and hands it to the SeenVisualizer server when the server asks. It also serves that machine's own event logs, so a Windows host doesn't need SSH.

**What it records** every 5 seconds:

- CPU %, plus load average on Linux
- RAM and swap
- GPU utilization and VRAM (NVIDIA through `nvidia-smi`, AMD through sysfs on Linux, or the Windows GPU-engine counters)
- Disk usage per volume
- Disk read/write throughput
- Network rx/tx throughput

Every 30 seconds it also records the top 5 processes by CPU. History is kept for 72 hours, in memory and in daily `samples-YYYY-MM-DD.jsonl` files under `seen-agent-data/`, so it survives restarts.

**What it serves** on port 9870 by default. Every request needs the bearer token:

| Endpoint | Returns |
|---|---|
| `GET /health` | Version, host, sample count, oldest sample |
| `GET /metrics?since=<ms>&until=<ms>` | Raw samples for the window |
| `GET /logs?since=<ms>&until=<ms>` | Windows event logs (Security, System, Application, Sysmon, PowerShell, Defender, RDP) or the systemd journal on Linux |

## Run it

Requires Node.js 18 or later.

```sh
node seen-agent.mjs                 # port 9870, 5 s interval, 72 h history
node seen-agent.mjs --port 9870 --interval 5 --retention 72 --data /var/lib/seen-agent
```

On first start the agent generates an access token, prints it, and saves it to `seen-agent-data/token.txt`. On the Connect page, add a **SeenVisualizer agent** source with the machine's IP address and that token.

Only allow the agent's port from the SeenVisualizer server, for example with a firewall rule. The token protects the endpoints, but the traffic is plain HTTP.

### As a service on Linux (systemd)

```ini
# /etc/systemd/system/seen-agent.service
[Unit]
Description=SeenVisualizer agent
After=network-online.target

[Service]
ExecStart=/usr/bin/node /opt/seen-agent/seen-agent.mjs --data /var/lib/seen-agent
Restart=always
# reading the full journal needs root or the systemd-journal group
User=root

[Install]
WantedBy=multi-user.target
```

`sudo systemctl enable --now seen-agent`

### At startup on Windows

Run this in an elevated PowerShell. SYSTEM can read the Security event log.

```powershell
$a = New-ScheduledTaskAction -Execute "node.exe" -Argument "C:\seen-agent\seen-agent.mjs --data C:\seen-agent\data"
$t = New-ScheduledTaskTrigger -AtStartup
Register-ScheduledTask -TaskName "SeenVisualizer agent" -Action $a -Trigger $t -User "SYSTEM" -RunLevel Highest
Start-ScheduledTask -TaskName "SeenVisualizer agent"
New-NetFirewallRule -DisplayName "SeenVisualizer agent" -Direction Inbound -Protocol TCP -LocalPort 9870 -RemoteAddress <server-ip> -Action Allow
```
