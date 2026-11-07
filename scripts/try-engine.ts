/** Dev helper: run the offline engine on a sample folder and print the timeline.
 *    npx tsx scripts/try-engine.ts samples/operation-nightfall [layman|analyst|senior]
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { finalizeRecords, parseFile } from '../server/parsers.ts';
import { analyzeHeuristic } from '../server/analysis/heuristic.ts';
import type { Level } from '../shared/types.ts';

const dir = process.argv[2] ?? 'samples/operation-nightfall';
const level = (process.argv[3] ?? 'analyst') as Level;
const drafts = readdirSync(dir).flatMap((f) => {
  const p = parseFile(f, readFileSync(join(dir, f), 'utf8'));
  console.log(`${f.padEnd(24)} ${p.format.padEnd(8)} ${p.records.length}`);
  return p.records;
});
const records = finalizeRecords(drafts);
const { incident } = analyzeHeuristic(records, readdirSync(dir).length);
console.log('\n' + incident.title, '|', incident.severity, '|', incident.summary);
console.log('assets:', incident.assets.map((a) => `${a.id}(${a.kind}${a.compromisedAt ? '*' : ''})`).join(' '));
for (const e of incident.events) {
  const n = e.narratives[level];
  console.log(`\n${new Date(e.ts).toISOString().slice(11, 19)} ${e.key ? '★' : ' '} [${e.phase}] ${e.technique?.id ?? ''} ${e.host ?? ''}${e.fromHost ? ` ${e.fromHost}->${e.toHost}` : ''} :: ${e.label}`);
  console.log(`   ${n.title}\n   ${n.text}`);
}
const s = incident.stories[level];
console.log(`\n=== ${s.title} (${s.scenes.length} scenes)`);
for (const sc of s.scenes.filter((x) => x.kind !== 'event')) console.log(`-- ${sc.heading}: ${sc.narration}`);
