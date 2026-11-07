import type { Asset, Level, PhaseId, Severity } from './types.ts';

export const PHASE_COLOR: Record<PhaseId, string> = {
  recon: '#60a5fa',
  'initial-access': '#fbbf24',
  execution: '#ef4444',
  persistence: '#c084fc',
  'privilege-escalation': '#fb923c',
  'defense-evasion': '#94a3b8',
  'credential-access': '#a3e635',
  discovery: '#38bdf8',
  'lateral-movement': '#ff3b6b',
  collection: '#2dd4bf',
  'command-and-control': '#e879f9',
  exfiltration: '#ff8a4c',
  impact: '#f43f5e',
};

export const PHASE_ICON: Record<PhaseId, IconName> = {
  recon: 'search',
  'initial-access': 'mail',
  execution: 'bug',
  persistence: 'lock',
  'privilege-escalation': 'crown',
  'defense-evasion': 'eraser',
  'credential-access': 'key',
  discovery: 'radar',
  'lateral-movement': 'share',
  collection: 'archive',
  'command-and-control': 'signal',
  exfiltration: 'upload',
  impact: 'cpu',
};

export const SEV_COLOR: Record<Severity, string> = {
  info: '#64748b',
  low: '#38bdf8',
  medium: '#fbbf24',
  high: '#fb923c',
  critical: '#ef4444',
};

export const ASSET_ICON: Record<Asset['kind'], IconName> = {
  workstation: 'laptop',
  server: 'server',
  'domain-controller': 'building',
  database: 'database',
  external: 'skull',
  firewall: 'shield',
  cloud: 'cloud',
};

export const LEVEL_ACCENT: Record<Level, string> = {
  layman: '#7dd3fc',
  analyst: '#a78bfa',
  senior: '#4ade80',
};

export type IconName =
  | 'laptop' | 'server' | 'database' | 'building' | 'skull' | 'mail' | 'key' | 'lock' | 'bug' | 'search' | 'file'
  | 'eraser' | 'crown' | 'cpu' | 'archive' | 'signal' | 'shield' | 'check' | 'globe' | 'alert' | 'clock' | 'upload'
  | 'share' | 'radar' | 'cloud' | 'play' | 'film' | 'layers' | 'plug' | 'zoom-in' | 'zoom-out' | 'maximize' | 'terminal'
  | 'user' | 'download' | 'sparkles' | 'x' | 'chevron-right' | 'chevron-left' | 'pause' | 'list' | 'trash';

/** Lucide-style 24x24 stroke icons (ISC-licensed shapes, simplified). */
export const ICON_PATHS: Record<IconName, string> = {
  laptop: 'M4 5h16a1 1 0 0 1 1 1v10H3V6a1 1 0 0 1 1-1zM1 19h22',
  server: 'M3 3h18v7H3zM3 14h18v7H3zM7 6.5h.01M7 17.5h.01',
  database: 'M3 5a9 3 0 1 0 18 0a9 3 0 1 0-18 0M3 5v14a9 3 0 0 0 18 0V5M3 12a9 3 0 0 0 18 0',
  building: 'M5 2h14v20H5zM9 22v-4h6v4M9 6h.01M12 6h.01M15 6h.01M9 10h.01M12 10h.01M15 10h.01M9 14h.01M12 14h.01M15 14h.01',
  skull: 'M9 12h.01M15 12h.01M8 20v2h8v-2M12.5 17l-.5-1-.5 1zM16 20a2 2 0 0 0 1.56-3.25 8 8 0 1 0-11.12 0A2 2 0 0 0 8 20',
  mail: 'M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM22 7l-10 6L2 7',
  key: 'M2 15.5a5.5 5.5 0 1 0 11 0a5.5 5.5 0 1 0-11 0M21 2l-9.6 9.6M15.5 7.5l3 3L22 7l-3-3',
  lock: 'M4 11h16v11H4zM7 11V7a5 5 0 0 1 10 0v4',
  bug: 'M8 2l1.9 1.9M16 2l-1.9 1.9M9 7.1v-1a3 3 0 1 1 6 0v1M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6zM12 20v-9M6.5 9C4.6 8.8 3 7.1 3 5M6 13H2M3 21c0-2.1 1.7-3.9 3.8-4M21 5c0 2.1-1.6 3.8-3.5 4M22 13h-4M17.2 17c2.1.1 3.8 1.9 3.8 4',
  search: 'M3 11a8 8 0 1 0 16 0a8 8 0 1 0-16 0M21 21l-4.3-4.3',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6',
  eraser: 'M7 21l-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21zM22 21H7M5 11l9 9',
  crown: 'M2 4l3 12h14l3-12-6 7-4-7-4 7zM5 20h14',
  cpu: 'M4 4h16v16H4zM9 9h6v6H9zM15 2v2M15 20v2M2 15h2M2 9h2M20 15h2M20 9h2M9 2v2M9 20v2',
  archive: 'M2 3h20v5H2zM4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4',
  signal: 'M2 20h.01M7 20v-4M12 20v-8M17 20V8M22 4v16',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  check: 'M20 6L9 17l-5-5',
  globe: 'M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0M12 2a14.5 14.5 0 0 0 0 20a14.5 14.5 0 0 0 0-20M2 12h20',
  alert: 'M21.7 18l-8-14a2 2 0 0 0-3.5 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3zM12 9v4M12 17h.01',
  clock: 'M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0M12 6v6l4 2',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  share: 'M15 5a3 3 0 1 0 6 0a3 3 0 1 0-6 0M3 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0M15 19a3 3 0 1 0 6 0a3 3 0 1 0-6 0M8.6 13.5l6.8 4M15.4 6.5l-6.8 4',
  radar: 'M19.07 4.93A10 10 0 0 0 6.99 3.34M4 6h.01M2.29 9.62A10 10 0 1 0 21.31 8.35M16.24 7.76A6 6 0 1 0 8.23 16.67M12 18h.01M17.99 11.66A6 6 0 0 1 15.77 16.67M10 12a2 2 0 1 0 4 0a2 2 0 1 0-4 0M13.41 10.59l5.66-5.66',
  cloud: 'M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9z',
  play: 'M6 3l14 9-14 9z',
  pause: 'M6 4h4v16H6zM14 4h4v16h-4z',
  film: 'M3 3h18v18H3zM7 3v18M17 3v18M3 7.5h4M3 12h18M3 16.5h4M17 7.5h4M17 16.5h4',
  layers: 'M12 2L2 7l10 5 10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  plug: 'M12 22v-5M9 8V2M15 8V2M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8z',
  'zoom-in': 'M3 11a8 8 0 1 0 16 0a8 8 0 1 0-16 0M21 21l-4.3-4.3M11 8v6M8 11h6',
  'zoom-out': 'M3 11a8 8 0 1 0 16 0a8 8 0 1 0-16 0M21 21l-4.3-4.3M8 11h6',
  maximize: 'M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3',
  terminal: 'M4 17l6-6-6-6M12 19h8',
  user: 'M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2M8 7a4 4 0 1 0 8 0a4 4 0 1 0-8 0',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  sparkles: 'M9.9 15.5A2 2 0 0 0 8.5 14.1L2.4 12.5a.5.5 0 0 1 0-1l6.1-1.6A2 2 0 0 0 9.9 8.5l1.6-6.1a.5.5 0 0 1 1 0l1.6 6.1a2 2 0 0 0 1.4 1.4l6.1 1.6a.5.5 0 0 1 0 1l-6.1 1.6a2 2 0 0 0-1.4 1.4l-1.6 6.1a.5.5 0 0 1-1 0zM20 3v4M22 5h-4',
  x: 'M18 6L6 18M6 6l12 12',
  'chevron-right': 'M9 18l6-6-6-6',
  'chevron-left': 'M15 18l-6-6 6-6',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  trash: 'M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
};

export const fmtClock = (ts: number) =>
  new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
export const fmtClockSec = (ts: number) =>
  new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', timeZone: 'UTC' });
export const fmtDate = (ts: number) =>
  new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
