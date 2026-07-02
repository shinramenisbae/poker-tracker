import { describe, it, expect } from 'vitest';
import { tableStrategy, notationStrategy } from './convert';
import type { ChartTable } from './types-data';

describe('tableStrategy', () => {
  const table: ChartTable = {
    'AA': { raise: 1 },
    'ATs': { raise: 0.14, call: 0.86 },
    'A5s': { raise: 0.31, call: 0.69 },
    'K4s': { call: 0.37 },              // fold = 0.63 implied
    'AKo': { raise: 0.83, allin: 0.17 },
  };

  it('pure cells pass through', () => {
    expect(tableStrategy(table, 'AA')).toEqual({ raise: 1 });
  });

  it('mixed cells keep their fractional frequencies', () => {
    const s = tableStrategy(table, 'ATs');
    expect(s.raise).toBeCloseTo(0.14);
    expect(s.call).toBeCloseTo(0.86);
    expect(s.fold ?? 0).toBeCloseTo(0);
  });

  it('fold is the implied remainder of listed mass', () => {
    const s = tableStrategy(table, 'K4s');
    expect(s.call).toBeCloseTo(0.37);
    expect(s.fold).toBeCloseTo(0.63);
  });

  it('unlisted hands and missing tables fold at 100%', () => {
    expect(tableStrategy(table, '72o')).toEqual({ fold: 1 });
    expect(tableStrategy(undefined, 'AA')).toEqual({ fold: 1 });
  });

  it('frequencies always sum to ~1', () => {
    for (const hand of ['AA', 'ATs', 'A5s', 'K4s', 'AKo', '72o']) {
      const s = tableStrategy(table, hand);
      const sum = Object.values(s).reduce((a, b) => a + (b ?? 0), 0);
      expect(sum, hand).toBeCloseTo(1);
    }
  });
});

describe('notationStrategy', () => {
  it('jam-range hands go all-in, the rest fold', () => {
    expect(notationStrategy('22+, A2s+', 'AA')).toEqual({ allin: 1 });
    expect(notationStrategy('22+, A2s+', '72o')).toEqual({ fold: 1 });
  });
});
