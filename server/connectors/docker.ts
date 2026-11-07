/**
 * Docker: container logs + daemon events, either straight from the Engine API
 * (tcp 2375 / tls 2376) or by running the docker CLI over SSH.
 */
import type { SourceConfig } from '../../shared/sources.ts';
import { httpGet, httpJson, iso, jsonl, MAX_LINES, portOf, shellQuote, slug, stampedLines, sudo, withSsh, type Collected, type Window } from './util.ts';

const MAX_CONTAINERS = 60;

interface ApiContainer { Id: string; Names: string[]; Image: string; State: string; Status: string }
interface DockerEvent { Type?: string; Action?: string; status?: string; id?: string; from?: string; time?: number; timeNano?: number; Actor?: { ID?: string; Attributes?: Record<string, string> } }

/** Non-TTY containers return logs multiplexed in 8-byte framed chunks; TTY containers return plain text. */
function demux(buf: Buffer): string {
  if (buf.length < 8 || buf[0] > 2 || buf[1] || buf[2] || buf[3]) return buf.toString('utf8');
  const parts: Buffer[] = [];
  let i = 0;
  while (i + 8 <= buf.length) {
    const len = buf.readUInt32BE(i + 4);
    parts.push(buf.subarray(i + 8, i + 8 + len));
    i += 8 + len;
  }
  return Buffer.concat(parts).toString('utf8');
}

function eventRow(e: DockerEvent, machine: string) {
  const ms = e.timeNano ? Math.floor(e.timeNano / 1e6) : (e.time ?? 0) * 1000;
  const a = e.Actor?.Attributes ?? {};
  const name = a.name ?? e.from ?? e.Actor?.ID?.slice(0, 12) ?? '';
  const action = e.Action ?? e.status ?? '';
  const detail = a.execID ? ` exec ${a.execID.slice(0, 12)}` : '';
  return {
    timestamp: iso(ms),
    host: e.Type === 'container' && name ? name : machine,
    process: 'dockerd',
    action: `${e.Type ?? 'docker'}.${action.split(':')[0]}`,
    message: `docker ${e.Type ?? ''} ${action} ${name}${a.image ? ` (image ${a.image})` : ''}${detail} on ${machine}`.replace(/\s+/g, ' ').trim(),
    docker_host: machine,
    container_image: a.image,
  };
}

export async function testDocker(s: SourceConfig): Promise<string> {
  if (s.via === 'ssh') {
    return withSsh(s, async (ssh) => {
      const r = await ssh.run(sudo(s, "docker version --format '{{.Server.Version}}'"));
      if (r.code !== 0) throw new Error(r.err.trim() || 'docker CLI not available for this user (try ticking sudo or add the user to the docker group)');
      const n = await ssh.run(sudo(s, 'docker ps -aq | wc -l'));
      return `Docker ${r.out.trim()} via SSH · ${n.out.trim()} containers`;
    });
  }
  const o = { https: !!s.tls, insecure: s.insecure };
  const v = await httpJson<{ Version: string; Os: string }>(s.host, portOf(s), '/version', o);
  const info = await httpJson<{ Name: string; Containers: number; ContainersRunning: number }>(s.host, portOf(s), '/info', o);
  return `Docker ${v.Version} on ${info.Name} · ${info.Containers} containers (${info.ContainersRunning} running)`;
}

export async function collectDocker(s: SourceConfig, w: Window): Promise<Collected> {
  return s.via === 'ssh' ? viaSsh(s, w) : viaApi(s, w);
}

async function viaApi(s: SourceConfig, w: Window): Promise<Collected> {
  const o = { https: !!s.tls, insecure: s.insecure };
  const port = portOf(s);
  const info = await httpJson<{ Name: string }>(s.host, port, '/info', o);
  const machine = info.Name || s.name;
  const since = Math.floor(w.since / 1000);
  const until = Math.ceil(w.until / 1000);
  const notes: string[] = [];

  const all = await httpJson<ApiContainer[]>(s.host, port, '/containers/json?all=1', o);
  const cs = all.slice(0, MAX_CONTAINERS);
  if (all.length > cs.length) notes.push(`${all.length} containers found; collected the first ${MAX_CONTAINERS}.`);

  const rows: object[] = [];
  for (const c of cs) {
    const name = c.Names[0]?.replace(/^\//, '') || c.Id.slice(0, 12);
    const r = await httpGet(s.host, port, `/containers/${c.Id}/logs?stdout=1&stderr=1&timestamps=1&since=${since}&until=${until}&tail=${MAX_LINES}`, { ...o, maxBytes: 8 * 1024 * 1024 });
    if (r.status >= 400) {
      notes.push(`${name}: HTTP ${r.status}`);
      continue;
    }
    rows.push(...stampedLines(demux(r.body), { host: name, process: name, container_image: c.Image, docker_host: machine }, w));
  }

  // daemon events: bounded by `until` so the stream ends
  const ev = await httpGet(s.host, port, `/events?since=${since}&until=${until}`, { ...o, timeoutMs: 20_000 });
  const events = ev.body.toString('utf8').split('\n').filter(Boolean).flatMap((l) => {
    try { return [eventRow(JSON.parse(l), machine)]; } catch { return []; }
  });

  return {
    files: [
      { name: `docker-${slug(machine)}-containers.jsonl`, text: jsonl(rows.slice(-MAX_LINES * 2)) },
      { name: `docker-${slug(machine)}-events.jsonl`, text: jsonl(events) },
    ],
    notes: [`${cs.length} containers on ${machine}`, ...notes],
  };
}

async function viaSsh(s: SourceConfig, w: Window): Promise<Collected> {
  return withSsh(s, async (ssh) => {
    const since = Math.floor(w.since / 1000);
    const until = Math.ceil(w.until / 1000);
    const machine = (await ssh.run('hostname')).out.trim() || s.name;
    const ps = await ssh.run(sudo(s, "docker ps -a --format '{{.ID}} {{.Names}} {{.Image}}'"));
    if (ps.code !== 0) throw new Error(ps.err.trim() || 'docker ps failed');
    const cs = ps.out.trim().split('\n').filter(Boolean).slice(0, MAX_CONTAINERS).map((l) => {
      const [id, name, image] = l.split(' ');
      return { id, name, image };
    });
    const rows: object[] = [];
    for (const c of cs) {
      const r = await ssh.run(sudo(s, `docker logs --timestamps --since ${since} --until ${until} --tail ${MAX_LINES} ${shellQuote(c.id)} 2>&1`), 8 * 1024 * 1024);
      rows.push(...stampedLines(r.out, { host: c.name, process: c.name, container_image: c.image, docker_host: machine }, w));
    }
    const ev = await ssh.run(sudo(s, `docker events --since ${since} --until ${until} --format '{{json .}}'`));
    const events = ev.out.split('\n').filter(Boolean).flatMap((l) => {
      try { return [eventRow(JSON.parse(l), machine)]; } catch { return []; }
    });
    return {
      files: [
        { name: `docker-${slug(machine)}-containers.jsonl`, text: jsonl(rows.slice(-MAX_LINES * 2)) },
        { name: `docker-${slug(machine)}-events.jsonl`, text: jsonl(events) },
      ],
      notes: [`${cs.length} containers on ${machine} (via SSH)`],
    };
  });
}
