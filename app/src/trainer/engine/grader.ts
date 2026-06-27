import type { ActionOption, Bucket, GradeResult, Strategy, Tier, TierColor } from '../types';

export const CORRECT_THRESHOLD = 0.035;

export const TIER_COLOR: Record<Tier, TierColor> = {
  best: 'positive',
  correct: 'primary',
  inaccuracy: 'negative',
  mistake: 'negative',
  blunder: 'negative',
};

/** Aggregate raw strategy into button space using each button's `covers`. */
export function aggregate(actions: ActionOption[], strategy: Strategy): Partial<Record<Bucket, number>> {
  const out: Partial<Record<Bucket, number>> = {};
  for (const a of actions) {
    out[a.bucket] = a.covers.reduce((sum, k) => sum + (strategy[k] ?? 0), 0);
  }
  return out;
}

export function grade(actions: ActionOption[], strategy: Strategy, chosen: Bucket): GradeResult {
  const buttonFreq = aggregate(actions, strategy);
  const entries = Object.entries(buttonFreq) as [Bucket, number][];
  const maxFreq = entries.reduce((m, [, f]) => Math.max(m, f), 0);
  const bestBucket = (entries.find(([, f]) => f === maxFreq)?.[0]) ?? chosen;
  const chosenFreq = buttonFreq[chosen] ?? 0;

  let tier: Tier;
  if (chosenFreq > 0 && chosenFreq === maxFreq) tier = 'best';
  else if (chosenFreq >= CORRECT_THRESHOLD) tier = 'correct';
  else if (chosenFreq > 0) tier = 'inaccuracy';
  else tier = 'mistake';

  return { tier, color: TIER_COLOR[tier], chosen, bestBucket, chosenFreq, buttonFreq };
}
