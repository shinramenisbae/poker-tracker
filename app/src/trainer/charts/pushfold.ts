// Short-stack open-jam (push) ranges by position and effective stack (bb), no ante.
// Converted from a1r93/push-or-fold (MIT) — a digitization of Jennifear's MTT
// push/fold chart — ante0 tables, rows 5/10/15/20bb. See source/NOTICE.md.
// The conversion was verified class-for-class against the source semantics
// (all 169 hand classes per range).
// Key: `${Position}-${depth}`. Value: standard range notation of hands to JAM; all else folds.
export const PUSH_FOLD_DEPTHS = [5, 10, 15, 20] as const;
export type PushFoldDepth = (typeof PUSH_FOLD_DEPTHS)[number];

export const pushFold: Record<string, string> = {
  // ---- 5bb (widest) ----
  'UTG-5': '22+, A2s+, A4o+, K7s+, KTo+, Q9s+, QJo, J9s+, T8s+, 98s',
  'HJ-5': '22+, A2s+, A2o+, K6s+, K9o+, Q9s+, QTo+, J9s+, T8s+, 98s',
  'CO-5': '22+, A2s+, A2o+, K3s+, K9o+, Q8s+, QTo+, J8s+, JTo, T8s+, 98s, 87s',
  'BTN-5': '22+, A2s+, A2o+, K2s+, K5o+, Q6s+, Q9o+, J8s+, JTo, T8s+, 97s+, 87s, 76s',
  'SB-5': '22+, J2s+, J2o+, Q2s+, Q2o+, K2s+, K2o+, A2s+, A2o+, T2s+, T5o+, 93s+, 96o+, 84s+, 86o+, 74s+, 76o, 64s+, 53s+',

  // ---- 10bb ----
  'UTG-10': '22+, A8s+, A5s, A4s, ATo+, K9s+, KQo, Q9s+, J9s+, T9s',
  'HJ-10': '22+, A7s+, A5s, A4s, A3s, ATo+, K8s+, KJo+, Q8s+, QJo, J8s+, T8s+, 98s',
  'CO-10': '22+, A2s+, A7o+, A5o, K7s+, KTo+, Q8s+, QTo+, J8s+, JTo, T8s+, 98s, 87s',
  'BTN-10': '22+, A2s+, A2o+, K6s+, KTo+, Q8s+, QTo+, J8s+, JTo, T8s+, 97s+, 87s, 76s',
  'SB-10': '22+, K2s+, K2o+, A2s+, A2o+, Q2s+, Q7o+, J3s+, J8o+, T5s+, T8o+, 95s+, 97o+, 85s+, 87o, 74s+, 64s+, 53s+',

  // ---- 15bb ----
  'UTG-15': '88+, A8s+, A5s, A4s, A3s, AJo+, KTs+, KQo, QTs+, JTs',
  'HJ-15': '22+, A9s+, A5s, ATo+, K9s+, KQo, Q9s+, J9s+, T9s',
  'CO-15': '22+, A7s+, A5s, A4s, ATo+, K8s+, KJo+, Q9s+, QJo, J9s+, T9s, 98s',
  'BTN-15': '22+, A2s+, A5o+, K6s+, KTo+, Q8s+, QTo+, J8s+, JTo, T7s+, 97s+, 87s, 76s',
  'SB-15': '22+, A2s+, A2o+, K2s+, K6o+, Q4s+, Q9o+, J6s+, J9o+, T6s+, T8o+, 96s+, 98o, 85s+, 75s+, 64s+, 54s',

  // ---- 20bb (tightest) ----
  'UTG-20': 'TT+, ATs+, AJo+, KJs+, QJs',
  'HJ-20': '88+, A9s+, A5s, AJo+, KTs+, KQo, QTs+, JTs',
  'CO-20': '22+, A9s+, A5s, AJo+, K9s+, KQo, QTs+, JTs, T9s',
  'BTN-20': '22+, A3s+, A9o+, K8s+, KTo+, Q8s+, QJo, J8s+, JTo, T8s+, 98s',
  'SB-20': '22+, A2s+, A2o+, K3s+, K9o+, Q5s+, Q9o+, J6s+, J9o+, T6s+, T9o, 96s+, 98o, 86s+, 75s+, 65s, 54s',
};

export function pushFoldKey(pos: string, depth: number): string {
  return `${pos}-${depth}`;
}
