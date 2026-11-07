/**
 * SeenVisualizer API + static web server on http://localhost:8000
 */
import express from 'express';
import multer from 'multer';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Level, Status } from '../shared/types.ts';
import { analyzeWithClaude, claudeAvailable, MODEL } from './analysis/claude.ts';
import { analyzeHeuristic } from './analysis/heuristic.ts';
import { DATA, PORT, SAMPLES, WEB_DIST, listVoices } from './paths.ts';
import { getRenderJob, startRender } from './render.ts';
import { createCase, deleteCase, getCase, listCases, loadAll, save, summary, type Case } from './store.ts';
import { narrateScenes, ttsAvailable } from './tts.ts';

try {
  process.loadEnvFile();
} catch {
  /* no .env */
}

loadAll();
const app = express();
app.use(express.json({ limit: '5mb' }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024, files: 50 } });
const LEVELS: Level[] = ['layman', 'analyst', 'senior'];
const isLevel = (l: string): l is Level => (LEVELS as string[]).includes(l);

// ---------------------------------------------------------------------------
app.get('/api/status', (_req, res) => {
  const s: Status = { claude: claudeAvailable(), model: MODEL, tts: { engine: ttsAvailable() ? 'piper' : 'none', voices: listVoices() }, render: true };
  res.json(s);
});

app.get('/api/samples', (_req, res) => {
  if (!existsSync(SAMPLES)) return res.json([]);
  res.json(
    readdirSync(SAMPLES)
      .filter((d) => statSync(join(SAMPLES, d)).isDirectory())
      .map((d) => ({ id: d, files: readdirSync(join(SAMPLES, d)).map((f) => ({ name: f, bytes: statSync(join(SAMPLES, d, f)).size })) })),
  );
});

app.get('/api/integrations', (_req, res) => {
  res.json([
    { id: 'docker', name: 'Docker', desc: 'Stream container stdout/stderr via the Docker Engine API', status: 'planned' },
    { id: 'kubernetes', name: 'Kubernetes', desc: 'Pod logs + audit logs from the API server', status: 'planned' },
    { id: 'prometheus', name: 'Prometheus / Loki', desc: 'Alerts and log streams via LogQL', status: 'planned' },
    { id: 'outlook', name: 'Outlook / M365', desc: 'Message trace + unified audit log', status: 'planned' },
    { id: 'syslog', name: 'Syslog receiver', desc: 'Listen on UDP/TCP 514 for live events', status: 'planned' },
    { id: 'cloudtrail', name: 'AWS CloudTrail', desc: 'Management + data events from S3', status: 'planned' },
    { id: 'splunk', name: 'Splunk / Elastic', desc: 'Pull saved searches over REST', status: 'planned' },
    { id: 'windows', name: 'Windows Event Forwarding', desc: 'Security, Sysmon and PowerShell channels', status: 'planned' },
  ]);
});

app.get('/api/cases', (_req, res) => res.json(listCases().map(summary)));

app.post('/api/cases', upload.array('files'), (req, res) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (!files.length) return res.status(400).json({ error: 'No files uploaded' });
  const c = createCase(
    String(req.body?.name || files.map((f) => f.originalname).join(', ')).slice(0, 80),
    files.map((f) => ({ name: f.originalname, text: f.buffer.toString('utf8'), bytes: f.size })),
  );
  if (!c.recordCount) return res.status(422).json({ error: 'Could not find any timestamped log records in those files.', case: summary(c) });
  runAnalysis(c, String(req.body?.engine || 'auto'));
  res.json(summary(c));
});

app.post('/api/cases/sample/:name', (req, res) => {
  const dir = join(SAMPLES, req.params.name.replace(/[^\w-]/g, ''));
  if (!existsSync(dir)) return res.status(404).json({ error: 'No such sample' });
  const files = readdirSync(dir).map((f) => ({ name: f, text: readFileSync(join(dir, f), 'utf8'), bytes: statSync(join(dir, f)).size }));
  const c = createCase(`Sample: ${req.params.name}`, files);
  runAnalysis(c, String(req.body?.engine || 'auto'));
  res.json(summary(c));
});

const withCase = (req: express.Request, res: express.Response): Case | undefined => {
  const c = getCase(String(req.params.id));
  if (!c) res.status(404).json({ error: 'Case not found' });
  return c;
};

app.get('/api/cases/:id', (req, res) => {
  const c = withCase(req, res);
  if (c) res.json(summary(c));
});

app.delete('/api/cases/:id', (req, res) => {
  deleteCase(req.params.id);
  res.json({ ok: true });
});

app.post('/api/cases/:id/analyze', (req, res) => {
  const c = withCase(req, res);
  if (!c) return;
  runAnalysis(c, String(req.body?.engine || 'auto'));
  res.json(summary(c));
});

/** Raw records, filtered by time window / ids / text. */
app.get('/api/cases/:id/records', (req, res) => {
  const c = withCase(req, res);
  if (!c) return;
  const from = Number(req.query.from ?? -Infinity);
  const to = Number(req.query.to ?? Infinity);
  const q = String(req.query.q ?? '').toLowerCase();
  const host = String(req.query.host ?? '');
  const ids = req.query.ids ? new Set(String(req.query.ids).split(',').map(Number)) : null;
  const limit = Math.min(2000, Number(req.query.limit ?? 300));
  let rs = c.records.filter((r) => r.ts >= from && r.ts <= to);
  if (ids) rs = rs.filter((r) => ids.has(r.id));
  if (host) rs = rs.filter((r) => r.host === host);
  if (q) rs = rs.filter((r) => r.raw.toLowerCase().includes(q));
  res.json({ total: rs.length, records: rs.slice(0, limit) });
});

/** Log volume histogram for the timeline background. */
app.get('/api/cases/:id/histogram', (req, res) => {
  const c = withCase(req, res);
  if (!c || !c.range) return c && res.json({ from: 0, to: 0, buckets: [], sources: [] });
  const from = Number(req.query.from ?? c.range[0]);
  const to = Number(req.query.to ?? c.range[1] + 1);
  const n = Math.max(10, Math.min(600, Number(req.query.buckets ?? 200)));
  const sources = c.sources.map((s) => s.name);
  const buckets = Array.from({ length: n }, () => new Array(sources.length).fill(0));
  const flagged = new Set(c.incident?.events.flatMap((e) => e.evidence) ?? []);
  const flags = new Array(n).fill(0);
  const w = (to - from) / n;
  for (const r of c.records) {
    if (r.ts < from || r.ts >= to) continue;
    const b = Math.min(n - 1, Math.floor((r.ts - from) / w));
    buckets[b][sources.indexOf(r.source)]++;
    if (flagged.has(r.id)) flags[b]++;
  }
  res.json({ from, to, buckets, flags, sources });
});

/** Generate (cached) TTS narration for a level's story. */
app.post('/api/cases/:id/narrate/:level', async (req, res) => {
  const c = withCase(req, res);
  if (!c) return;
  if (!isLevel(req.params.level) || !c.incident) return res.status(400).json({ error: 'Analysis not ready' });
  try {
    const story = c.incident.stories[req.params.level];
    const scenes = await narrateScenes(c.id, req.params.level, story.scenes);
    story.scenes = scenes;
    save(c);
    res.json({ scenes, tts: ttsAvailable() });
  } catch (e: any) {
    console.error('[tts]', e);
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

app.post('/api/cases/:id/render/:level', async (req, res) => {
  const c = withCase(req, res);
  if (!c) return;
  if (!isLevel(req.params.level) || !c.incident) return res.status(400).json({ error: 'Analysis not ready' });
  const level = req.params.level;
  const scenes = await narrateScenes(c.id, level, c.incident.stories[level].scenes);
  c.incident.stories[level].scenes = scenes;
  save(c);
  const byId = new Map(c.records.map((r) => [r.id, r.raw]));
  const evidence = Object.fromEntries(c.incident.events.map((e) => [e.id, e.evidence.slice(0, 3).map((id) => byId.get(id) ?? '').filter(Boolean)]));
  res.json(startRender(c, level, scenes, evidence));
});

app.get('/api/cases/:id/render/:level', (req, res) => {
  const c = withCase(req, res);
  if (!c || !isLevel(req.params.level)) return;
  res.json(getRenderJob(c.id, req.params.level) ?? { state: 'none' });
});

// ---------------------------------------------------------------------------
app.use('/media', express.static(DATA, { maxAge: '1h' }));
if (existsSync(WEB_DIST)) {
  app.use(express.static(WEB_DIST));
  app.get(/^(?!\/api|\/media).*/, (_req, res) => res.sendFile(join(WEB_DIST, 'index.html')));
} else {
  app.get('/', (_req, res) => res.type('text').send('UI not built yet: run `npm run build` (or `npm run dev` and open http://localhost:5173).'));
}

// ---------------------------------------------------------------------------
function runAnalysis(c: Case, engine: string) {
  if (c.analysis.state === 'running') return;
  c.analysis = { state: 'running', progress: 0.05, message: 'Running detection rules…' };
  const set = (message: string, progress: number) => {
    c.analysis.message = message;
    c.analysis.progress = progress;
  };
  setImmediate(async () => {
    try {
      const heur = analyzeHeuristic(c.records, c.sources.length);
      set(`Rule engine flagged ${heur.dets.length} detections in ${heur.findings.length} findings`, 0.12);
      let incident = heur.incident;
      const useClaude = engine === 'claude' || (engine === 'auto' && claudeAvailable());
      if (useClaude && heur.dets.length + c.records.length > 0) {
        try {
          incident = await analyzeWithClaude(c.records, c.sources.length, heur, set);
        } catch (e: any) {
          console.error('[claude]', e?.message ?? e);
          c.analysis.error = `Claude analysis failed (${String(e?.message ?? e).slice(0, 200)}). Showing offline engine results.`;
          incident = heur.incident;
        }
      }
      c.incident = incident;
      c.analysis = { state: 'done', progress: 1, message: `${incident.events.length} events reconstructed`, error: c.analysis.error };
      save(c);
      // warm the narration cache for all three cuts so the Video tab opens instantly
      (async () => {
        for (const level of LEVELS) {
          if (c.incident !== incident) return; // re-analyzed meanwhile
          incident.stories[level].scenes = await narrateScenes(c.id, level, incident.stories[level].scenes);
          save(c);
        }
      })().catch((e) => console.error('[tts prewarm]', e?.message ?? e));
    } catch (e: any) {
      console.error('[analysis]', e);
      c.analysis = { state: 'error', progress: 0, message: 'Analysis failed', error: String(e?.message ?? e) };
      save(c);
    }
  });
}

app.listen(PORT, () => {
  console.log(`\n  SeenVisualizer  →  http://localhost:${PORT}`);
  console.log(`  AI engine: ${claudeAvailable() ? `Claude (${MODEL})` : 'offline rule engine (set ANTHROPIC_API_KEY to enable Claude)'}`);
  console.log(`  Narration: ${ttsAvailable() ? `Piper TTS (${listVoices().join(', ')})` : 'none (run scripts/setup.ps1)'}\n`);
});
