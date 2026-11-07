// Shared types used by the server, the web UI and the Remotion video.

export type Level = 'layman' | 'analyst' | 'senior';

export const LEVELS: { id: Level; label: string; short: string; blurb: string }[] = [
  { id: 'layman', label: 'Layman', short: 'Plain English', blurb: 'No jargon. What happened, why it matters, what to do.' },
  { id: 'analyst', label: 'Entry-level SOC', short: 'Tier-1 analyst', blurb: 'Attack phases, MITRE ATT&CK techniques, affected assets, triage steps.' },
  { id: 'senior', label: 'Senior / IR lead', short: 'Tier-3 / DFIR', blurb: 'Evidence, IOCs, commands, confidence, detection gaps and containment plan.' },
];

export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical';

/** One normalized log line, regardless of which file / format it came from. */
export interface LogRecord {
  id: number;
  ts: number; // epoch ms
  source: string; // file name
  format: string; // csv | jsonl | syslog | access | text ...
  host?: string;
  user?: string;
  process?: string;
  srcIp?: string;
  dstIp?: string;
  action?: string; // event id / action / method
  severity?: Severity;
  message: string;
  raw: string;
}

/** ATT&CK-style kill chain phases, in order. */
export const PHASES = [
  { id: 'recon', label: 'Reconnaissance', plain: 'Scouting' },
  { id: 'initial-access', label: 'Initial Access', plain: 'Getting in' },
  { id: 'execution', label: 'Execution', plain: 'Running malicious code' },
  { id: 'persistence', label: 'Persistence', plain: 'Hiding a way back in' },
  { id: 'privilege-escalation', label: 'Privilege Escalation', plain: 'Grabbing more power' },
  { id: 'defense-evasion', label: 'Defense Evasion', plain: 'Covering tracks' },
  { id: 'credential-access', label: 'Credential Access', plain: 'Stealing passwords' },
  { id: 'discovery', label: 'Discovery', plain: 'Looking around' },
  { id: 'lateral-movement', label: 'Lateral Movement', plain: 'Spreading to other computers' },
  { id: 'collection', label: 'Collection', plain: 'Gathering data' },
  { id: 'command-and-control', label: 'Command & Control', plain: 'Phoning home' },
  { id: 'exfiltration', label: 'Exfiltration', plain: 'Stealing data' },
  { id: 'impact', label: 'Impact', plain: 'Causing damage' },
] as const;
export type PhaseId = (typeof PHASES)[number]['id'];

export interface Narrative {
  title: string;
  text: string;
}

export interface TimelineEvent {
  id: string;
  ts: number;
  endTs?: number;
  phase: PhaseId;
  severity: Severity;
  technique?: { id: string; name: string };
  host?: string;
  /** For lateral movement: where it came from / went to. */
  fromHost?: string;
  toHost?: string;
  user?: string;
  /** Short machine-ish label, e.g. "Encoded PowerShell". */
  label: string;
  /** Is this a headline "chapter" event (shown at every level)? */
  key: boolean;
  confidence: number; // 0..1
  narratives: Record<Level, Narrative>;
  iocs?: string[];
  evidence: number[]; // LogRecord ids
}

export interface Asset {
  id: string; // hostname
  kind: 'workstation' | 'server' | 'domain-controller' | 'database' | 'external' | 'firewall' | 'cloud';
  friendly: string; // "Accounting laptop"
  ip?: string;
  compromisedAt?: number;
}

export interface Scene {
  id: string;
  kind: 'intro' | 'event' | 'summary' | 'actions';
  eventId?: string;
  heading: string;
  narration: string;
  bullets?: string[];
  // Filled in by TTS:
  audio?: string; // url
  durationSec?: number;
}

export interface Story {
  level: Level;
  title: string;
  tldr: string;
  scenes: Scene[];
  recommendations: string[];
}

export interface Incident {
  title: string;
  summary: string;
  severity: Severity;
  startTs: number;
  endTs: number;
  engine: 'claude' | 'heuristic';
  model?: string;
  assets: Asset[];
  users: string[];
  events: TimelineEvent[];
  stories: Record<Level, Story>;
  stats: { records: number; sources: number; flagged: number };
}

export interface SourceFile {
  name: string;
  format: string;
  records: number;
  bytes: number;
}

export type JobState = 'idle' | 'running' | 'done' | 'error';

export interface CaseSummary {
  id: string;
  name: string;
  createdAt: number;
  sources: SourceFile[];
  recordCount: number;
  range: [number, number] | null;
  analysis: { state: JobState; progress: number; message: string; error?: string };
  incident?: Incident;
}

export interface Status {
  claude: boolean;
  model: string;
  tts: { engine: 'piper' | 'none'; voices: string[] };
  render: boolean;
}

export const SEV_ORDER: Severity[] = ['info', 'low', 'medium', 'high', 'critical'];
