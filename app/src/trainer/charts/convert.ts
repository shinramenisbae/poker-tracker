import type { HandClass, Strategy } from '../types';
import type { ChartTable } from './types-data';
import { expandNotation } from '../ranges';

/**
 * Resolve a hand's strategy from a sparse chart table: entries carry only
 * non-fold action mass; fold is the implied remainder. Unlisted hand => fold.
 */
export function tableStrategy(table: ChartTable | undefined, hand: HandClass): Strategy {
  const entry = table?.[hand];
  if (!entry) return { fold: 1 };
  const s: Strategy = { ...entry };
  const listed = Object.values(s).reduce((a, b) => a + (b ?? 0), 0);
  const fold = 1 - listed;
  if (fold > 1e-9) s.fold = fold;
  return s;
}

/** Convert a push/fold notation string into a per-hand strategy resolver. */
export function notationStrategy(jamNotation: string, hand: HandClass): Strategy {
  const jamSet = expandNotation(jamNotation);
  return jamSet.has(hand) ? { allin: 1 } : { fold: 1 };
}
