/**
 * Server-side MP4 rendering of the motion-graphics story with Remotion.
 * The same React composition powers the in-browser <Player>.
 */
import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { cpus } from 'node:os';
import type { Level, Scene } from '../shared/types.ts';
import type { VideoProps } from '../video/timing.ts';
import { PORT, ROOT } from './paths.ts';
import { caseDir, type Case } from './store.ts';

export interface RenderJob {
  state: 'running' | 'done' | 'error';
  progress: number;
  message: string;
  url?: string;
  error?: string;
}

const jobs = new Map<string, RenderJob>();
let bundlePromise: Promise<string> | null = null;

async function getBundle(onMsg: (m: string) => void): Promise<string> {
  if (!bundlePromise) {
    bundlePromise = (async () => {
      const { bundle } = await import('@remotion/bundler');
      onMsg('Bundling motion-graphics composition…');
      return bundle({ entryPoint: join(ROOT, 'video', 'index.ts'), onProgress: (p) => onMsg(`Bundling composition… ${p}%`) });
    })().catch((e) => {
      bundlePromise = null;
      throw e;
    });
  }
  return bundlePromise;
}

export const renderKey = (id: string, level: Level) => `${id}:${level}`;
export function getRenderJob(id: string, level: Level): RenderJob | undefined {
  const j = jobs.get(renderKey(id, level));
  if (j) return j;
  const file = join(caseDir(id), 'video', `${level}.mp4`);
  if (existsSync(file)) return { state: 'done', progress: 1, message: 'Ready', url: `/media/cases/${id}/video/${level}.mp4` };
}

export function startRender(c: Case, level: Level, scenes: Scene[], evidence: Record<string, string[]>): RenderJob {
  const key = renderKey(c.id, level);
  const existing = jobs.get(key);
  if (existing?.state === 'running') return existing;
  const job: RenderJob = { state: 'running', progress: 0, message: 'Preparing renderer…' };
  jobs.set(key, job);

  (async () => {
    const { ensureBrowser, renderMedia, selectComposition } = await import('@remotion/renderer');
    job.message = 'Checking headless browser (first run downloads it)…';
    await ensureBrowser();
    const serveUrl = await getBundle((m) => (job.message = m));
    const inputProps: VideoProps = { incident: c.incident!, level, scenes, audioBase: `http://localhost:${PORT}`, evidence };
    const composition = await selectComposition({ serveUrl, id: 'IncidentStory', inputProps });
    const outDir = join(caseDir(c.id), 'video');
    mkdirSync(outDir, { recursive: true });
    job.message = 'Rendering frames…';
    await renderMedia({
      composition,
      serveUrl,
      codec: 'h264',
      x264Preset: 'veryfast',
      // 720p by default (≈2x faster); RENDER_SCALE=1 for full 1080p
      scale: Number(process.env.RENDER_SCALE || 2 / 3),
      concurrency: Math.max(2, cpus().length - 1),
      outputLocation: join(outDir, `${level}.mp4`),
      inputProps,
      onProgress: ({ progress, stitchStage }) => {
        job.progress = progress;
        job.message = stitchStage === 'muxing' ? 'Mixing narration audio…' : `Rendering frames… ${Math.round(progress * 100)}%`;
      },
    });
    job.state = 'done';
    job.progress = 1;
    job.message = 'Ready';
    job.url = `/media/cases/${c.id}/video/${level}.mp4?t=${Date.now()}`;
  })().catch((e) => {
    job.state = 'error';
    job.error = String(e?.message ?? e);
    job.message = 'Render failed';
    console.error('[render]', e);
  });
  return job;
}
