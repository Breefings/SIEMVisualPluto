/** Kubernetes: pod logs + cluster events from the API server, authenticated with a bearer token. */
import type { SourceConfig } from '../../shared/sources.ts';
import { httpGet, httpJson, iso, jsonl, MAX_LINES, portOf, stampedLines, type Collected, type Window } from './util.ts';

const MAX_PODS = 80;

interface Pod { metadata: { name: string; namespace: string }; spec: { nodeName?: string; containers: { name: string }[] }; status: { phase?: string } }
interface KEvent {
  metadata: { name: string; namespace: string; creationTimestamp?: string };
  involvedObject?: { kind?: string; name?: string; namespace?: string };
  reason?: string; message?: string; type?: string; count?: number;
  firstTimestamp?: string; lastTimestamp?: string; eventTime?: string;
  source?: { component?: string; host?: string };
}

const opts = (s: SourceConfig) => ({ https: true, insecure: s.insecure ?? true, headers: { Authorization: `Bearer ${s.token ?? ''}`, Accept: 'application/json' } });

export async function testKubernetes(s: SourceConfig): Promise<string> {
  if (!s.token) throw new Error('A service-account token is required');
  const v = await httpJson<{ gitVersion: string }>(s.host, portOf(s), '/version', opts(s));
  const pods = await httpJson<{ items: Pod[] }>(s.host, portOf(s), '/api/v1/pods?limit=500', opts(s));
  const ns = new Set(pods.items.map((p) => p.metadata.namespace));
  return `Kubernetes ${v.gitVersion} · ${pods.items.length} pods in ${ns.size} namespaces`;
}

export async function collectKubernetes(s: SourceConfig, w: Window): Promise<Collected> {
  if (!s.token) throw new Error('A service-account token is required');
  const port = portOf(s);
  const o = opts(s);
  const notes: string[] = [];
  const sinceSeconds = Math.max(1, Math.ceil((Date.now() - w.since) / 1000));
  const cluster = s.name;

  const pods = (await httpJson<{ items: Pod[] }>(s.host, port, '/api/v1/pods?limit=1000', o)).items;
  const picked = pods.filter((p) => p.status.phase !== 'Succeeded').slice(0, MAX_PODS);
  if (pods.length > picked.length) notes.push(`${pods.length} pods; collected ${picked.length}.`);

  const rows: object[] = [];
  const failures: string[] = [];
  await Promise.all(
    picked.flatMap((p) =>
      p.spec.containers.map(async (c) => {
        const path = `/api/v1/namespaces/${encodeURIComponent(p.metadata.namespace)}/pods/${encodeURIComponent(p.metadata.name)}/log?container=${encodeURIComponent(c.name)}&timestamps=true&sinceSeconds=${sinceSeconds}&tailLines=${MAX_LINES}&limitBytes=4000000`;
        try {
          const r = await httpGet(s.host, port, path, { ...o, maxBytes: 4_500_000 });
          if (r.status >= 400) throw new Error(`HTTP ${r.status}`);
          rows.push(...stampedLines(r.body.toString('utf8'), { host: p.metadata.name, namespace: p.metadata.namespace, process: c.name, node: p.spec.nodeName, cluster }, w));
        } catch (e: any) {
          failures.push(`${p.metadata.namespace}/${p.metadata.name}/${c.name}: ${e.message}`);
        }
      }),
    ),
  );
  if (failures.length) notes.push(`${failures.length} container logs could not be read (first: ${failures[0]})`);
  rows.sort((a: any, b: any) => (a.timestamp < b.timestamp ? -1 : 1));

  const evs = (await httpJson<{ items: KEvent[] }>(s.host, port, '/api/v1/events?limit=5000', o)).items;
  const events = evs.flatMap((e) => {
    const t = Date.parse(e.lastTimestamp ?? e.eventTime ?? e.firstTimestamp ?? e.metadata.creationTimestamp ?? '');
    if (isNaN(t) || t < w.since || t > w.until) return [];
    const obj = e.involvedObject ?? {};
    return [{
      timestamp: iso(t),
      host: obj.kind === 'Pod' ? obj.name : (e.source?.host ?? cluster),
      namespace: e.metadata.namespace,
      process: e.source?.component ?? 'kubernetes',
      action: e.reason,
      level: e.type === 'Warning' ? 'warning' : 'info',
      message: `${obj.kind ?? ''} ${obj.namespace ? `${obj.namespace}/` : ''}${obj.name ?? ''}: ${e.reason ?? ''} - ${e.message ?? ''}${(e.count ?? 1) > 1 ? ` (x${e.count})` : ''}`.trim(),
      cluster,
    }];
  });

  return {
    files: [
      { name: `k8s-${cluster}-pods.jsonl`.replace(/[^\w.-]+/g, '_'), text: jsonl(rows.slice(-MAX_LINES * 3)) },
      { name: `k8s-${cluster}-events.jsonl`.replace(/[^\w.-]+/g, '_'), text: jsonl(events) },
    ],
    notes: [`${picked.length} pods, ${events.length} events`, ...notes],
  };
}
