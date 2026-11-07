/** Case storage: in-memory with JSON persistence under data/cases/<id>/. */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { CaseSummary, LogRecord, SourceFile } from '../shared/types.ts';
import { finalizeRecords, parseFile } from './parsers.ts';
import { CASES } from './paths.ts';

export interface Case extends CaseSummary {
  records: LogRecord[];
}

const cases = new Map<string, Case>();

export const caseDir = (id: string) => join(CASES, id);

export function loadAll() {
  mkdirSync(CASES, { recursive: true });
  for (const id of readdirSync(CASES)) {
    try {
      const summary = JSON.parse(readFileSync(join(caseDir(id), 'case.json'), 'utf8')) as CaseSummary;
      const records = JSON.parse(readFileSync(join(caseDir(id), 'records.json'), 'utf8')) as LogRecord[];
      if (summary.analysis.state === 'running') summary.analysis = { state: 'idle', progress: 0, message: 'Interrupted, re-run analysis' };
      cases.set(id, { ...summary, records });
    } catch {
      /* skip broken case */
    }
  }
}

export function save(c: Case, withRecords = false) {
  mkdirSync(caseDir(c.id), { recursive: true });
  const { records, ...summary } = c;
  writeFileSync(join(caseDir(c.id), 'case.json'), JSON.stringify(summary));
  if (withRecords) writeFileSync(join(caseDir(c.id), 'records.json'), JSON.stringify(records));
}

export function createCase(name: string, files: { name: string; text: string; bytes: number }[]): Case {
  const id = `${new Date().toISOString().slice(0, 10)}-${randomBytes(3).toString('hex')}`;
  const sources: SourceFile[] = [];
  const drafts = files.flatMap((f) => {
    const p = parseFile(f.name, f.text);
    sources.push({ name: f.name, format: p.format, records: p.records.length, bytes: f.bytes });
    return p.records;
  });
  const records = finalizeRecords(drafts);
  const c: Case = {
    id,
    name,
    createdAt: Date.now(),
    sources,
    recordCount: records.length,
    range: records.length ? [records[0].ts, records[records.length - 1].ts] : null,
    analysis: { state: 'idle', progress: 0, message: '' },
    records,
  };
  cases.set(id, c);
  save(c, true);
  return c;
}

export const getCase = (id: string) => cases.get(id);
export const listCases = () => [...cases.values()].sort((a, b) => b.createdAt - a.createdAt);
export function deleteCase(id: string) {
  cases.delete(id);
  if (existsSync(caseDir(id))) rmSync(caseDir(id), { recursive: true, force: true });
}

export function summary(c: Case): CaseSummary {
  const { records: _r, ...s } = c;
  return s;
}
