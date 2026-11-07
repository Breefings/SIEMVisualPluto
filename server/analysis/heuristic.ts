import type { Incident, LogRecord } from '../../shared/types.ts';
import { correlate, detect, type Det, type Finding } from './detect.ts';
import { buildEnv } from './env.ts';
import { buildIncident } from './narrate.ts';

export interface HeuristicResult {
  incident: Incident;
  findings: Finding[];
  dets: Det[];
}

/** Offline detection engine: rules + correlation + templated narratives. */
export function analyzeHeuristic(records: LogRecord[], sources: number): HeuristicResult {
  const env = buildEnv(records);
  const dets = detect(env);
  const findings = correlate(dets);
  return { incident: buildIncident(env, findings, sources), findings, dets };
}
