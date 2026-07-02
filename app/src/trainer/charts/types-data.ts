/**
 * Sparse per-hand chart table (vendored data shape): only non-fold action mass
 * is stored; fold = 1 - sum(listed). Hands absent from the table fold at 100%.
 */
export type ChartTable = Record<string, Partial<Record<'raise' | 'allin' | 'call', number>>>;
