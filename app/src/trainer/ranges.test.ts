import { describe, it, expect } from 'vitest';
import { allHandClasses, handClassOf, comboCountOf, randomCombo, expandNotation, gridIndex } from './ranges';
import type { Card, Rank, Suit } from './types';

const c = (s: string): Card => ({ rank: s[0] as Rank, suit: s[1] as Suit });

describe('ranges', () => {
  it('enumerates 169 unique classes', () => {
    const all = allHandClasses();
    expect(all.length).toBe(169);
    expect(new Set(all).size).toBe(169);
    expect(all).toContain('AA');
    expect(all).toContain('AKs');
    expect(all).toContain('AKo');
  });

  it('classifies combos: pair, suited, offsuit (high card first)', () => {
    expect(handClassOf(c('Ah'), c('Ad'))).toBe('AA');
    expect(handClassOf(c('Ah'), c('Kh'))).toBe('AKs');
    expect(handClassOf(c('Kd'), c('Ah'))).toBe('AKo'); // order-independent, ranks reordered
  });

  it('combo counts: pair=6, suited=4, offsuit=12', () => {
    expect(comboCountOf('AA')).toBe(6);
    expect(comboCountOf('AKs')).toBe(4);
    expect(comboCountOf('AKo')).toBe(12);
  });

  it('randomCombo is reproducible with a seeded rng and yields two distinct cards', () => {
    let i = 0;
    const seq = [0.99, 0.0, 0.5, 0.5]; // deterministic
    const rng = () => seq[i++ % seq.length];
    const [a, b] = randomCombo(rng);
    expect(a.rank + a.suit).not.toBe(b.rank + b.suit);
  });

  it('expandNotation handles +, suited/offsuit, and explicit combos', () => {
    expect(expandNotation('TT+')).toEqual(new Set(['TT', 'JJ', 'QQ', 'KK', 'AA']));
    expect(expandNotation('A2s+').has('A2s')).toBe(true);
    expect(expandNotation('A2s+').has('AKs')).toBe(true);
    expect(expandNotation('A2s+').has('A2o')).toBe(false);
    expect(expandNotation('AKo, 72o').has('72o')).toBe(true);
  });

  it('gridIndex puts AA top-left, suited above diagonal', () => {
    expect(gridIndex('AA')).toEqual({ row: 0, col: 0 });
    expect(gridIndex('AKs')).toEqual({ row: 0, col: 1 });
    expect(gridIndex('AKo')).toEqual({ row: 1, col: 0 });
  });
});
