import type { Bucket, HandClass, Strategy } from '../types';
import type { Cell, SourceAction } from './source/poker-types';
import { expandNotation } from '../ranges';

const toBucket = (a: SourceAction): Bucket => a; // identity: raise/call/allin/fold/check

export function cellToStrategy(cell: Cell): Strategy {
  if (typeof cell === 'string') {
    return { [toBucket(cell)]: 1 };
  }
  if (Array.isArray(cell)) {
    const f = 1 / cell.length;
    const s: Strategy = {};
    for (const a of cell) s[toBucket(a)] = (s[toBucket(a)] ?? 0) + f;
    return s;
  }
  // WeightedCell: weight (0..100) is the in-range fraction; actions are % among in-range.
  const inRange = Math.max(0, Math.min(100, cell.weight)) / 100;
  const s: Strategy = {};
  let assigned = 0;
  const actionSum = Object.values(cell.actions).reduce((a, b) => a + (b ?? 0), 0) || 1;
  for (const [a, pct] of Object.entries(cell.actions)) {
    const freq = inRange * ((pct ?? 0) / actionSum);
    s[toBucket(a as SourceAction)] = (s[toBucket(a as SourceAction)] ?? 0) + freq;
    assigned += freq;
  }
  const fold = 1 - assigned;
  if (fold > 1e-9) s.fold = (s.fold ?? 0) + fold;
  return s;
}

/** Build a sparse-aware strategy lookup for a chart: unlisted hand => fold. */
export function chartCellStrategy(chart: Record<string, Cell> | undefined, hand: HandClass): Strategy {
  if (!chart) return { fold: 1 };
  const cell = chart[hand];
  if (cell === undefined) return { fold: 1 };
  return cellToStrategy(cell);
}

/** Convert a push/fold notation string into a per-hand strategy resolver. */
export function notationStrategy(jamNotation: string, hand: HandClass): Strategy {
  const jamSet = expandNotation(jamNotation);
  return jamSet.has(hand) ? { allin: 1 } : { fold: 1 };
}
