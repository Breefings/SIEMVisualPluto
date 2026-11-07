/** Source registry: persisted configs (data/sources.json, local only), connection tests and collection. */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { KINDS, type PublicSource, type SourceConfig, type SourceKind, type SourceReport } from '../../shared/sources.ts';
import { DATA } from '../paths.ts';
import { collectAgent, testAgent } from './agent.ts';
import { collectDocker, testDocker } from './docker.ts';
import { collectKubernetes, testKubernetes } from './kubernetes.ts';
import { collectLinux, collectProxmox, testLinux, testProxmox } from './linux.ts';
import { collectOpenWrt, enableOpenWrtLogging, testOpenWrt } from './openwrt.ts';
import type { Collected, Window } from './util.ts';
import { collectWindows, testWindows } from './windows.ts';

export { enableOpenWrtLogging };

const DRIVERS: Record<SourceKind, { test: (s: SourceConfig) => Promise<string>; collect: (s: SourceConfig, w: Window) => Promise<Collected> }> = {
  docker: { test: testDocker, collect: collectDocker },
  kubernetes: { test: testKubernetes, collect: collectKubernetes },
  openwrt: { test: testOpenWrt, collect: collectOpenWrt },
  proxmox: { test: testProxmox, collect: collectProxmox },
  linux: { test: testLinux, collect: collectLinux },
  windows: { test: testWindows, collect: collectWindows },
  agent: { test: testAgent, collect: collectAgent },
};

const FILE = join(DATA, 'sources.json');
let sources: SourceConfig[] = [];
try {
  if (existsSync(FILE)) sources = JSON.parse(readFileSync(FILE, 'utf8'));
} catch {
  sources = [];
}
const persist = () => {
  mkdirSync(DATA, { recursive: true });
  writeFileSync(FILE, JSON.stringify(sources, null, 2), { mode: 0o600 });
};

export function toPublic(s: SourceConfig): PublicSource {
  const { password, privateKey, token, ...rest } = s;
  return { ...rest, hasPassword: !!password, hasKey: !!privateKey, hasToken: !!token };
}
export const listSources = () => sources.map(toPublic);
export const getSource = (id: string) => sources.find((s) => s.id === id);

/** Create or update. Blank secret fields keep the stored value; `clear: ['password']` removes one. */
export function upsertSource(input: Partial<SourceConfig> & { clear?: string[] }, id?: string): SourceConfig {
  const kind = input.kind ?? getSource(id ?? '')?.kind;
  if (!kind || !KINDS.some((k) => k.kind === kind)) throw new Error('Unknown source type');
  const host = String(input.host ?? getSource(id ?? '')?.host ?? '').trim();
  if (!host || !/^[\w.:\-[\]]+$/.test(host)) throw new Error('Enter an IP address or hostname');
  const port = input.port ? Number(input.port) : undefined;
  if (port != null && !(port > 0 && port < 65536)) throw new Error('Port must be 1-65535');
  const prev = id ? getSource(id) : undefined;
  if (id && !prev) throw new Error('No such source');
  const next: SourceConfig = {
    ...(prev ?? { id: randomBytes(5).toString('hex'), enabled: true }),
    kind,
    name: String(input.name ?? prev?.name ?? '').trim().slice(0, 60) || `${KINDS.find((k) => k.kind === kind)!.label} ${host}`,
    host,
    port,
    via: input.via ?? prev?.via,
    tls: input.tls ?? prev?.tls,
    insecure: input.insecure ?? prev?.insecure,
    sudo: input.sudo ?? prev?.sudo,
    username: input.username !== undefined ? String(input.username).trim() || undefined : prev?.username,
    enabled: input.enabled ?? prev?.enabled ?? true,
  } as SourceConfig;
  for (const k of ['password', 'privateKey', 'token'] as const) {
    const v = input[k];
    next[k] = input.clear?.includes(k) ? undefined : v ? String(v) : prev?.[k];
  }
  if (prev && (prev.host !== next.host || prev.port !== next.port)) delete next.lastTest;
  sources = prev ? sources.map((s) => (s.id === id ? next : s)) : [...sources, next];
  persist();
  return next;
}

export function removeSource(id: string) {
  sources = sources.filter((s) => s.id !== id);
  persist();
}

const withTimeout = <T,>(p: Promise<T>, ms: number, what: string) =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${what} timed out after ${ms / 1000}s`)), ms))]);

export async function testSource(s: SourceConfig) {
  try {
    const detail = await withTimeout(DRIVERS[s.kind].test(s), 30_000, 'Connection test');
    s.lastTest = { ok: true, at: Date.now(), detail };
  } catch (e: any) {
    s.lastTest = { ok: false, at: Date.now(), detail: String(e?.message ?? e) };
  }
  persist();
  return s.lastTest;
}

/** Pull every given source in parallel. A failing source never sinks the others. */
export async function collectSources(list: SourceConfig[], w: Window) {
  const results = await Promise.all(
    list.map(async (s): Promise<{ report: SourceReport; files: Collected['files'] }> => {
      const t0 = Date.now();
      try {
        const c = await withTimeout(DRIVERS[s.kind].collect(s, w), 180_000, 'Collection');
        const files = c.files.filter((f) => f.text.trim());
        return {
          files,
          report: { id: s.id, name: s.name, kind: s.kind, ok: true, files: files.map((f) => ({ name: f.name, lines: f.text.split('\n').length })), notes: c.notes, ms: Date.now() - t0 },
        };
      } catch (e: any) {
        return { files: [], report: { id: s.id, name: s.name, kind: s.kind, ok: false, files: [], notes: [], error: String(e?.message ?? e), ms: Date.now() - t0 } };
      }
    }),
  );
  return { files: results.flatMap((r) => r.files), reports: results.map((r) => r.report) };
}
