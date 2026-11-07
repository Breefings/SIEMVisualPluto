/**
 * Convert the sample investigations in samples/ into SIEM-export-style CSV files
 * (`_time, host, source, sourcetype, _raw`), the shape Splunk and similar tools export.
 * `_raw` is the untouched original line, so the analysis is identical to the original files.
 *
 *   npx tsx scripts/samples-to-csv.ts            -> test-logs/<sample>-csv/*.csv
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { finalizeRecords, parseFile } from '../server/parsers.ts';

const ROOT = join(import.meta.dirname, '..');
const q = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const SOURCETYPE: Record<string, string> = {
  'dns_dhcp.log': 'dns:dhcp', 'firewall.log': 'firewall:syslog', 'mail_gateway.txt': 'mail:gateway', 'proxy_access.log': 'proxy:access',
  'sysmon.jsonl': 'XmlWinEventLog:Microsoft-Windows-Sysmon/Operational', 'windows_security.csv': 'WinEventLog:Security',
  'auth.log': 'linux:auth', syslog: 'linux:syslog',
};

for (const sample of readdirSync(join(ROOT, 'samples'))) {
  const dir = join(ROOT, 'samples', sample);
  if (!statSync(dir).isDirectory()) continue;
  const out = join(ROOT, 'test-logs', `${sample}-csv`);
  mkdirSync(out, { recursive: true });
  const texts = new Map(readdirSync(dir).map((f) => [f, readFileSync(join(dir, f), 'utf8')] as const));
  // parse all files together so syslog lines (which carry no year) get the year from the other sources
  const all = finalizeRecords([...texts].flatMap(([f, text]) => parseFile(f, text).records));
  for (const [f, text] of texts) {
    const records = all.filter((r) => r.source === f);
    const csvSource = f.toLowerCase().endsWith('.csv');
    const header = csvSource ? text.split(/\r?\n/, 1)[0].split(',') : [];
    const rows = records.map((r) => {
      // a CSV source has no single original line format, so its row is kept as a JSON object
      let raw = r.raw;
      if (csvSource) {
        const cells = splitCsvLine(r.raw);
        raw = JSON.stringify(Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ''])));
      }
      return [new Date(r.ts).toISOString(), r.host ?? '', f, SOURCETYPE[f] ?? 'text', raw].map(q).join(',');
    });
    const name = `${f.replace(/\.[^.]+$/, '')}.csv`;
    writeFileSync(join(out, name), ['_time,host,source,sourcetype,_raw', ...rows].join('\n') + '\n');
    console.log(`${sample}/${name}: ${rows.length} rows`);
  }
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') inQ = false; else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { cells.push(cur); cur = ''; }
    else cur += c;
  }
  cells.push(cur);
  return cells;
}
