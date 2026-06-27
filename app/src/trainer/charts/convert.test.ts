import { describe, it, expect } from 'vitest';
import { cellToStrategy } from './convert';

describe('cellToStrategy', () => {
  it('pure action string', () => {
    expect(cellToStrategy('raise')).toEqual({ raise: 1 });
    expect(cellToStrategy('fold')).toEqual({ fold: 1 });
    expect(cellToStrategy('allin')).toEqual({ allin: 1 });
  });
  it('equal split for arrays', () => {
    expect(cellToStrategy(['raise', 'fold'])).toEqual({ raise: 0.5, fold: 0.5 });
  });
  it('weighted cell: weight is in-range %, remainder folds', () => {
    // 60% in range, all of that raises => raise 0.6, fold 0.4
    expect(cellToStrategy({ weight: 60, actions: { raise: 100 } })).toEqual({ raise: 0.6, fold: 0.4 });
  });
  it('weighted cell with action split', () => {
    // 100% in range, raise 70 / call 30
    const s = cellToStrategy({ weight: 100, actions: { raise: 70, call: 30 } });
    expect(s.raise).toBeCloseTo(0.7);
    expect(s.call).toBeCloseTo(0.3);
    expect(s.fold ?? 0).toBeCloseTo(0);
  });
  it('frequencies always sum to ~1', () => {
    const s = cellToStrategy({ weight: 40, actions: { raise: 50, allin: 50 } });
    const sum = Object.values(s).reduce((a, b) => a + (b ?? 0), 0);
    expect(sum).toBeCloseTo(1);
  });
});
