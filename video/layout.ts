import type { Asset, Incident, TimelineEvent } from '../shared/types.ts';

export interface NodePos {
  asset: Asset;
  x: number;
  y: number;
}

export const STAGE = { left: 190, right: 740, top: 300, bottom: 760, boundaryX: 840, extX: 985 };

/** Deterministic network-map layout: internal hosts zig-zag left→right in order of compromise, attacker infra on the right. */
export function layoutNodes(inc: Incident): Map<string, NodePos> {
  const internal = inc.assets
    .filter((a) => a.kind !== 'external')
    .sort((a, b) => (a.compromisedAt ?? Infinity) - (b.compromisedAt ?? Infinity) || a.id.localeCompare(b.id))
    .slice(0, 10);
  const external = inc.assets.filter((a) => a.kind === 'external').slice(0, 4);
  const map = new Map<string, NodePos>();
  const n = internal.length;
  const { left, right, top, bottom } = STAGE;
  const midY = (top + bottom) / 2;
  if (n === 1) map.set(internal[0].id, { asset: internal[0], x: (left + right) / 2, y: midY });
  else if (n <= 5) {
    internal.forEach((a, i) => map.set(a.id, { asset: a, x: left + (i * (right - left)) / (n - 1), y: n === 2 ? midY : i % 2 ? bottom - 40 : top + 40 }));
  } else {
    const cols = Math.ceil(n / 2);
    internal.forEach((a, i) => {
      const row = i % 2, col = Math.floor(i / 2);
      map.set(a.id, { asset: a, x: left + (col * (right - left)) / Math.max(1, cols - 1) + (row ? 50 : 0), y: row ? bottom - 20 : top + 20 });
    });
  }
  external.forEach((a, i) => {
    const span = bottom - top;
    map.set(a.id, { asset: a, x: STAGE.extX, y: external.length === 1 ? midY : top + (i * span) / (external.length - 1) });
  });
  return map;
}

/** Which attacker server does this event talk to? */
export function externalFor(e: TimelineEvent, inc: Incident): string | undefined {
  const ext = inc.assets.filter((a) => a.kind === 'external');
  const hit = ext.find((a) => (e.iocs ?? []).some((i) => i.includes(a.id)) || e.label.includes(a.id));
  return (hit ?? ext[0])?.id;
}
