// Log-source connector definitions shared by the server and the Connect page.
import type { IconName } from './theme.ts';

export type SourceKind = 'docker' | 'kubernetes' | 'openwrt' | 'proxmox' | 'linux' | 'windows' | 'agent';
export type Via = 'api' | 'ssh';

/** A configured machine to pull logs from. Secrets never leave the server (see PublicSource). */
export interface SourceConfig {
  id: string;
  kind: SourceKind;
  name: string;
  host: string; // IP address or hostname
  port?: number; // blank = the kind's default port
  via?: Via; // docker only: Engine API or `docker` CLI over SSH
  tls?: boolean; // docker API: https (port 2376)
  insecure?: boolean; // accept self-signed TLS certificates (kubernetes, docker tls)
  username?: string;
  password?: string;
  privateKey?: string;
  token?: string; // kubernetes bearer token / agent token
  sudo?: boolean; // prefix collection commands with `sudo -n`
  enabled: boolean;
  lastTest?: { ok: boolean; at: number; detail: string };
}

/** What the browser sees: secrets replaced by flags. */
export type PublicSource = Omit<SourceConfig, 'password' | 'privateKey' | 'token'> & { hasPassword: boolean; hasKey: boolean; hasToken: boolean };

export type Field = 'via' | 'tls' | 'insecure' | 'username' | 'password' | 'privateKey' | 'token' | 'sudo';

export interface KindInfo {
  kind: SourceKind;
  label: string;
  icon: IconName;
  what: string; // what gets collected
  fields: Field[];
  defaultUser?: string;
  setup: string; // one-paragraph setup hint shown in the form
}

export const KINDS: KindInfo[] = [
  {
    kind: 'docker', label: 'Docker', icon: 'layers',
    what: 'Container stdout/stderr and daemon events (create, start, exec, kill).',
    fields: ['via', 'tls', 'insecure', 'username', 'password', 'privateKey', 'sudo'],
    setup: 'Engine API: the daemon must listen on TCP (2375, or 2376 with TLS). Plain 2375 is root access with no password, so only expose it on a trusted network. Safer: choose SSH and SIEMVisual runs the docker CLI on the host.',
  },
  {
    kind: 'kubernetes', label: 'Kubernetes', icon: 'cloud',
    what: 'Pod container logs and cluster events from the API server.',
    fields: ['token', 'insecure'],
    setup: 'Point at the API server (default 6443) with a read-only service-account token: `kubectl create token seen-reader` after binding it to a ClusterRole that can get/list pods, pods/log and events.',
  },
  {
    kind: 'openwrt', label: 'OpenWrt router', icon: 'globe', defaultUser: 'root',
    what: 'System log (logread), firewall drops, DNS queries, DHCP leases, the live connection table and interface traffic counters.',
    fields: ['username', 'password', 'privateKey'],
    setup: 'Uses SSH (dropbear, port 22). OpenWrt keeps logs in a RAM ring buffer, not on disk, so the connector reads `logread` and /proc instead of /var. Use "Enable traffic logging" once to turn on DNS-query and firewall logging.',
  },
  {
    kind: 'proxmox', label: 'Proxmox VE', icon: 'server', defaultUser: 'root',
    what: 'Host journal (logins, pveproxy, pvedaemon, qemu), the PVE task log (VM start/stop/backup/migrate), the cluster log, the PVE firewall log and open connections.',
    fields: ['username', 'password', 'privateKey', 'sudo'],
    setup: 'Uses SSH (port 22). Reads targeted logs rather than copying /var: on Proxmox /var/lib holds VM disks that can be hundreds of GB.',
  },
  {
    kind: 'linux', label: 'Linux host', icon: 'terminal',
    what: 'systemd journal (sshd, sudo, cron, kernel, services), or auth.log/syslog on older systems, plus open connections.',
    fields: ['username', 'password', 'privateKey', 'sudo'],
    setup: 'Uses SSH (port 22). The account needs to read the journal: root, or a user in the `systemd-journal`/`adm` group, or tick sudo (requires passwordless sudo for journalctl).',
  },
  {
    kind: 'windows', label: 'Windows host', icon: 'laptop',
    what: 'Event logs: Security, System, Application, Sysmon, PowerShell, Defender and RDP sessions.',
    fields: ['username', 'password', 'privateKey'],
    setup: 'Uses the built-in OpenSSH Server (Settings → Optional features → OpenSSH Server, then `Start-Service sshd`). The account must be an administrator to read the Security log. No SSH? Install the SIEMVisual agent instead; it serves the same event logs.',
  },
  {
    kind: 'agent', label: 'SIEMVisual agent', icon: 'cpu',
    what: 'Hardware utilization history (CPU, RAM, GPU, disk usage, disk read/write, network) plus the host\'s own event logs.',
    fields: ['token'],
    setup: 'Run the agent on the machine (`node seen-agent.mjs`). It samples every 5 s, keeps 72 h of history, and prints its access token on first start. Download it from the button below.',
  },
];

export const kindInfo = (k: SourceKind) => KINDS.find((x) => x.kind === k)!;

export function defaultPort(s: Pick<SourceConfig, 'kind' | 'via' | 'tls'>): number {
  switch (s.kind) {
    case 'docker': return s.via === 'ssh' ? 22 : s.tls ? 2376 : 2375;
    case 'kubernetes': return 6443;
    case 'agent': return 9870;
    default: return 22;
  }
}

export interface SourceReport {
  id: string;
  name: string;
  kind: SourceKind;
  ok: boolean;
  files: { name: string; lines: number }[];
  notes: string[];
  error?: string;
  ms: number;
}
