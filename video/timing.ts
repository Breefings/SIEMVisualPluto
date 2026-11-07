import type { Incident, Level, Scene } from '../shared/types.ts';

export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;
/** Audio starts this many seconds into each scene (lets the scene animate in first). */
export const LEAD_IN = 0.6;
const TAIL = 0.9;

export interface VideoProps {
  incident: Incident;
  level: Level;
  scenes: Scene[];
  /** Prefix for audio URLs ('' in the browser, 'http://localhost:8000' when rendering). */
  audioBase: string;
  /** Raw evidence log lines per event id (shown in the senior-level terminal). */
  evidence?: Record<string, string[]>;
  [key: string]: unknown;
}

export function sceneFrames(s: Scene): number {
  const min = s.kind === 'intro' ? 6 : 4.5;
  return Math.ceil(Math.max(min, (s.durationSec ?? 5) + LEAD_IN + TAIL) * FPS);
}

export function timeline(scenes: Scene[]) {
  let at = 0;
  return scenes.map((s) => {
    const from = at;
    const dur = sceneFrames(s);
    at += dur;
    return { scene: s, from, dur };
  });
}

export const totalFrames = (scenes: Scene[]) => Math.max(FPS, scenes.reduce((a, s) => a + sceneFrames(s), 0));
