import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DATA = process.env.SEEN_DATA_DIR || join(ROOT, 'data');
export const CASES = join(DATA, 'cases');
export const SAMPLES = join(ROOT, 'samples');
export const WEB_DIST = join(ROOT, 'dist', 'web');
export const TOOLS = join(ROOT, '.tools');
export const PORT = Number(process.env.PORT || 8000);

export function piperBinary(): string | null {
  if (process.env.PIPER_PATH && existsSync(process.env.PIPER_PATH)) return process.env.PIPER_PATH;
  for (const p of [join(TOOLS, 'piper', 'piper.exe'), join(TOOLS, 'piper', 'piper')]) if (existsSync(p)) return p;
  return null;
}

export function voicesDir(): string {
  return process.env.PIPER_VOICES || join(TOOLS, 'voices');
}

export function listVoices(): string[] {
  const d = voicesDir();
  return existsSync(d) ? readdirSync(d).filter((f) => f.endsWith('.onnx')).map((f) => f.replace(/\.onnx$/, '')) : [];
}
