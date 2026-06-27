// Approximate short-stack open-jam (push) ranges by position and effective stack (bb).
// "GTO-style" starter data — refine against a published Nash chart over time.
// Key: `${Position}-${depth}`. Value: standard range notation of hands to JAM; all else folds.
export const PUSH_FOLD_DEPTHS = [10, 15, 20, 25] as const;
export type PushFoldDepth = (typeof PUSH_FOLD_DEPTHS)[number];

export const pushFold: Record<string, string> = {
  // ---- 10bb (wide) ----
  'UTG-10': '44+, A7s+, A5s, KTs+, QTs+, JTs, ATo+, KJo+',
  'HJ-10':  '33+, A4s+, K9s+, QTs+, JTs, T9s, A9o+, KTo+, QJo',
  'CO-10':  '22+, A2s+, K8s+, Q9s+, J9s+, T9s, 98s, A7o+, K9o+, QTo+, JTo',
  'BTN-10': '22+, A2s+, K5s+, Q8s+, J8s+, T8s+, 97s+, 87s, 76s, A2o+, K8o+, Q9o+, J9o+, T9o',
  'SB-10':  '22+, A2s+, K4s+, Q7s+, J8s+, T8s+, 97s+, 86s+, 76s, A2o+, K7o+, Q9o+, J9o+, T9o',

  // ---- 15bb ----
  'UTG-15': '66+, A9s+, KTs+, QJs, AJo+',
  'HJ-15':  '55+, A7s+, KTs+, QTs+, JTs, ATo+, KQo',
  'CO-15':  '33+, A4s+, K9s+, QTs+, JTs, T9s, A9o+, KJo+, QJo',
  'BTN-15': '22+, A2s+, K7s+, Q9s+, J9s+, T9s, 98s, A7o+, K9o+, QTo+, JTo',
  'SB-15':  '22+, A2s+, K6s+, Q8s+, J8s+, T8s+, 98s, A5o+, K9o+, QTo+, JTo',

  // ---- 20bb ----
  'UTG-20': '77+, AJs+, KQs, AKo',
  'HJ-20':  '66+, ATs+, KJs+, AQo+',
  'CO-20':  '44+, A8s+, KTs+, QJs, AJo+, KQo',
  'BTN-20': '22+, A4s+, K9s+, QTs+, JTs, T9s, A9o+, KJo+, QJo',
  'SB-20':  '22+, A3s+, K8s+, Q9s+, J9s+, T9s, A8o+, KTo+, QJo',

  // ---- 25bb (tight) ----
  'UTG-25': '88+, AQs+, AKo',
  'HJ-25':  '77+, AJs+, KQs, AQo+',
  'CO-25':  '55+, ATs+, KJs+, AJo+',
  'BTN-25': '33+, A7s+, KTs+, QJs, ATo+, KQo',
  'SB-25':  '22+, A5s+, K9s+, QTs+, JTs, A9o+, KJo+',
};

export function pushFoldKey(pos: string, depth: number): string {
  return `${pos}-${depth}`;
}
