// Minimal types to compile the vendored Greenline data module.
// Mirrors the public shape of AHTOOOXA/poker-charts (MIT).
export type SourceAction = 'raise' | 'call' | 'allin' | 'fold' | 'check';
export interface WeightedCell { weight: number; actions: Partial<Record<SourceAction, number>>; }
export type Cell = SourceAction | SourceAction[] | WeightedCell;
export type Chart = Record<string, Cell>;
