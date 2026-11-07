# Test logs: home-lab web outage (5 Nov 2026)

These are synthetic logs for the test lab: an OpenWrt router on a Raspberry Pi 4, a Proxmox host, an Ubuntu Server 24.04 VM running nginx in Docker, and three Ubuntu Desktop 24.04 VMs. All times are UTC. Drag all six CSV files into **Import** together, so they land on one timeline.

| File | Machine | Rows | What it contains |
|---|---|---|---|
| `router_openwrt.csv` | gw-openwrt (192.168.1.1) | 1,195 | DHCP leases, DNS queries, port-forward traffic to the web server, dropped internet scans, hourly WAN counters, WAN outage, admin SSH login |
| `proxmox_pve.csv` | pve-01 (192.168.1.2) | 24 | Nightly backups, VM start/shutdown, web-UI login, snapshot and disk resize of the server VM |
| `ubuntu_server_syslog.csv` | ubuntu-srv (192.168.1.10) | 84 | cron, updates, disk-usage warnings, Docker errors and restarts, admin SSH session and every sudo command |
| `nginx_docker_web.csv` | `web` container on ubuntu-srv | 5,990 | Every web request (client IP, page, status, size, browser) and nginx error lines |
| `desktop_vms_syslog.csv` | desktop-1/2/3 (192.168.1.21–23) | 35 | Boot, logins (alice, bob, carol), the site failing and recovering in Firefox, WAN loss |
| `hardware_metrics.csv` | all five machines | 4,590 | Per-minute CPU, RAM, disk %, disk read/write, network in/out, top process |

## What happened

| Time (UTC) | Event |
|---|---|
| 01:00–01:50 | Proxmox backs up all four VMs successfully. |
| 06:12 | The server installs security updates (openssl, tzdata). |
| 08:05–08:40 | The three desktop VMs start; alice, bob and carol log in. |
| 09:30 | The server's disk is at 71% and starts climbing. Docker keeps the nginx container's log in one file with no size limit. |
| 10:00 | A sale launches. Internet traffic through the router's port-forward jumps about 30×, and server CPU reaches 55–95%. |
| 10:20–12:05 | Disk warnings at 80%, 85%, 90%, 95% and 98%. nginx warns it is running out of connections. |
| 11:40 | About 1 in 5 requests start failing with 503. |
| 11:55 | nginx can't write files: "No space left on device". |
| 12:12 | The disk is full. The nginx container crashes, and Docker restarts it every 4 minutes, failing each time. The site is down, and the router logs refused connections. |
| 12:14–12:22 | Desktop users see "connection refused" in Firefox. |
| 12:24 | The admin (sysadmin) SSHs into the server from desktop-1 and investigates: `docker ps`, `docker logs`, `df`, `du`. |
| 12:31 | Root cause found: a 17.2 GB container log file. |
| 12:35–12:44 | The admin checks the VM in Proxmox and snapshots it before cleaning up. |
| 12:38–12:48 | The log is truncated, old images are pruned, and disk usage drops to 58%. |
| 12:49 | nginx starts again, and the site is back after 37 minutes down. |
| 13:01–13:05 | Container log rotation is set (50 MB × 5 files), and Docker restarts. |
| 13:30 | The server's disk is grown from 60 GB to 80 GB in Proxmox. |
| 14:02–14:09 | The ISP link drops for 7 minutes. Every machine loses internet; the LAN keeps working. |
| 17:30–18:02 | Users log out, and the desktop VMs shut down. |

This is an operational incident, not an attack. The offline rule engine looks for attacker behaviour, so it will mostly report no malicious activity. With Claude enabled, the analysis also covers the outage itself. For attack scenarios, drag in the files from `samples/operation-nightfall` or `samples/ssh-cryptominer` instead.
