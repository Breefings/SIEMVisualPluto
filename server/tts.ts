/**
 * Narration with Piper (https://github.com/rhasspy/piper): a fast, local,
 * open-source (MIT) neural text-to-speech engine. One male narrator (Ryan) for every level.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, openSync, readSync, closeSync } from 'node:fs';
import { cpus } from 'node:os';
import { join } from 'node:path';
import type { Level, Scene } from '../shared/types.ts';
import { listVoices, piperBinary, voicesDir } from './paths.ts';
import { caseDir } from './store.ts';

// One male narrator for every audience. Ryan (medium) synthesizes a whole story ~5x faster than Ryan (high),
// which takes minutes per level on a laptop CPU; set PIPER_VOICE=en_US-ryan-high to trade speed for quality.
const MALE = ['en_US-ryan-medium', 'en_US-ryan-high', 'en_US-hfc_male-medium', 'en_US-joe-medium', 'en_US-john-medium'];

export function voiceFor(_level: Level): string | null {
  const have = listVoices();
  const want = process.env.PIPER_VOICE;
  if (want && have.includes(want)) return want;
  return MALE.find((v) => have.includes(v)) ?? have[0] ?? null;
}

export function ttsAvailable() {
  return !!piperBinary() && listVoices().length > 0;
}

/** Make text friendlier to a TTS voice. */
export function speakable(s: string): string {
  return s
    .replace(/→|->/g, ' to ')
    .replace(/&/g, ' and ')
    .replace(/…/g, '...')
    .replace(/\bUTC\b/g, 'U T C')
    .replace(/\bC2\b/g, 'C 2')
    .replace(/\bIOCs?\b/g, (m) => (m.endsWith('s') ? 'I O Cs' : 'I O C'))
    .replace(/\bT(\d{4})(?:\.(\d{3}))?\b/g, (_, a, b) => `T ${a}${b ? ` point ${b}` : ''}`)
    .replace(/\bSMB\b/g, 'S M B').replace(/\bRDP\b/g, 'R D P').replace(/\bLSASS\b/gi, 'L sass').replace(/\bEDR\b/g, 'E D R')
    .replace(/\bDFIR\b/g, 'D F I R').replace(/\bSOC\b/g, 'sock').replace(/\bSSH\b/g, 'S S H').replace(/\bMFA\b/g, 'M F A')
    .replace(/[`*_#|<>[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function wavDuration(file: string): number {
  const fd = openSync(file, 'r');
  try {
    const head = Buffer.alloc(4096);
    const n = readSync(fd, head, 0, 4096, 0);
    const byteRate = head.readUInt32LE(28);
    let off = 12;
    while (off + 8 <= n) {
      const id = head.toString('ascii', off, off + 4);
      const size = head.readUInt32LE(off + 4);
      if (id === 'data') return size / byteRate;
      off += 8 + size;
    }
    return 0;
  } finally {
    closeSync(fd);
  }
}

/** Synthesize every scene of a story. Returns scenes with audio url + duration. Cached by text hash. */
export async function narrateScenes(caseId: string, level: Level, scenes: Scene[]): Promise<Scene[]> {
  const bin = piperBinary();
  const voice = voiceFor(level);
  if (!bin || !voice) return scenes.map((s) => ({ ...s, audio: undefined, durationSec: estimate(s.narration) }));

  const dir = join(caseDir(caseId), 'audio', level);
  mkdirSync(dir, { recursive: true });
  const speed = level === 'layman' ? '0.93' : '0.88';
  const jobs = scenes.map((s) => {
    const text = speakable(s.narration);
    const hash = createHash('sha1').update(`${voice}|${speed}|${text}`).digest('hex').slice(0, 12);
    const file = join(dir, `${s.id}-${hash}.wav`);
    return { s, text, file, url: `/media/cases/${caseId}/audio/${level}/${s.id}-${hash}.wav` };
  });
  // One synthesis at a time per case+level: a concurrent caller (background pre-warm vs. the video
  // tab vs. an MP4 render) waits, then re-checks the cache, so nobody reads a half-written WAV.
  const lock = `${caseId}:${level}`;
  while (inflight.has(lock)) await inflight.get(lock)!.catch(() => {});
  const todo = jobs.filter((j) => !existsSync(j.file) || wavDuration(j.file) <= 0);
  if (todo.length) {
    // split across a few Piper processes; each loads the model once and streams many sentences
    const workers = Math.min(todo.length, Math.max(1, Math.min(4, cpus().length >> 1)));
    const chunks = Array.from({ length: workers }, (_, w) => todo.filter((_, i) => i % workers === w));
    const run = Promise.all(chunks.map((chunk) => piper(bin, voice, speed, chunk))).then(() => undefined);
    inflight.set(lock, run);
    try {
      await run;
    } finally {
      inflight.delete(lock);
    }
  }
  return jobs.map((j) => {
    const d = existsSync(j.file) ? wavDuration(j.file) : 0;
    return { ...j.s, audio: d > 0 ? j.url : undefined, durationSec: d > 0 ? d : estimate(j.s.narration) };
  });
}

const estimate = (t: string) => Math.max(3, t.split(/\s+/).length / 2.6);
const inflight = new Map<string, Promise<void>>();

function piper(bin: string, voice: string, speed: string, items: { text: string; file: string }[]) {
  return new Promise<void>((resolve, reject) => {
    const p = spawn(bin, ['--model', join(voicesDir(), `${voice}.onnx`), '--json-input', '--sentence_silence', '0.2', '--length_scale', speed], {
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    let err = '';
    p.stderr.on('data', (d) => (err += d.toString()));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`piper exited ${code}: ${err.slice(-400)}`))));
    for (const j of items) p.stdin.write(JSON.stringify({ text: j.text, output_file: j.file }) + '\n');
    p.stdin.end();
  });
}
