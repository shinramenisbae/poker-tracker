import { describe, it, expect } from 'vitest';
import { generateSpot, isDecision, isMixed } from './spotGenerator';
import { handClassOf } from '../ranges';
import { order } from '../sizing';
import type { ActionOption } from '../types';

describe('spotGenerator', () => {
  const rng = () => 0.123; // deterministic

  it('builds a valid RFI spot', () => {
    const spot = generateSpot({ category: 'rfi' }, rng);
    expect(spot.category).toBe('rfi');
    expect(spot.villainPos).toBeUndefined();
    expect(spot.legalActions.map(a => a.kind)).toEqual(['fold', 'raise']);
    expect(spot.heroHand).toHaveLength(2);
    expect(spot.handClass).toBe(handClassOf(spot.heroHand[0], spot.heroHand[1]));
    const sum = Object.values(spot.strategy).reduce((a, b) => a + (b ?? 0), 0);
    expect(sum).toBeCloseTo(1);
  });

  it('builds a vs-open spot with a villain before the hero', () => {
    const spot = generateSpot({ category: 'vs-open' }, rng);
    expect(spot.villainPos).toBeDefined();
    expect(spot.legalActions.map(a => a.kind)).toEqual(['fold', 'call', 'raise']);
  });

  it('builds a push-fold spot with a depth and jam button', () => {
    const spot = generateSpot({ category: 'push-fold', depth: 15 }, rng);
    expect(spot.effStackBb).toBe(15);
    expect(spot.legalActions.some(a => a.kind === 'allin')).toBe(true);
  });

  it('every spot has a unique id', () => {
    const a = generateSpot({ category: 'rfi' }, () => 0.1);
    const b = generateSpot({ category: 'rfi' }, () => 0.9);
    expect(a.id).not.toBe(b.id);
  });

  it('positions are always valid across many sampled spots', () => {
    for (let i = 0; i < 200; i++) {
      const r = () => (i + 0.5) / 200;
      const vo = generateSpot({ category: 'vs-open' }, r);
      expect(order(vo.villainPos!)).toBeLessThan(order(vo.heroPos));

      const v3 = generateSpot({ category: 'vs-3bet' }, r);
      expect(order(v3.villainPos!)).toBeGreaterThan(order(v3.heroPos));

      const rfi = generateSpot({ category: 'rfi' }, r);
      expect(rfi.heroPos).not.toBe('BB');
    }
  });
});

describe('biased dealing', () => {
  const ACTIONS: ActionOption[] = [
    { kind: 'fold', label: 'Fold', bucket: 'fold', covers: ['fold'] },
    { kind: 'call', label: 'Call', bucket: 'call', covers: ['call'] },
    { kind: 'raise', label: '3-bet', bucket: 'raise', covers: ['raise', 'allin'] },
  ];

  it('isDecision: pure folds are trivial, anything else is a decision', () => {
    expect(isDecision({ fold: 1 })).toBe(false);
    expect(isDecision({ raise: 1 })).toBe(true);
    expect(isDecision({ raise: 0.5, fold: 0.5 })).toBe(true);
  });

  it('isMixed: needs two buttons played >=5% in button space', () => {
    expect(isMixed(ACTIONS, { raise: 0.7, fold: 0.3 })).toBe(true);
    expect(isMixed(ACTIONS, { raise: 1 })).toBe(false);
    expect(isMixed(ACTIONS, { raise: 0.97, call: 0.03 })).toBe(false);
    // raise+allin collapse into one button: NOT a visible mix
    expect(isMixed(ACTIONS, { raise: 0.5, allin: 0.5 })).toBe(false);
  });

  it('deals mostly decision-relevant hands but still some clear folds (RFI, 300 spots)', () => {
    const spots = Array.from({ length: 300 }, () => generateSpot({ category: 'rfi' }));
    const decisions = spots.filter((s) => isDecision(s.strategy)).length;
    const folds = spots.length - decisions;
    // uniform dealing would put decisions at ~25%; the bias should lift it well above 45%
    expect(decisions / spots.length).toBeGreaterThan(0.45);
    // ...without eliminating clear folds entirely (they stay part of the drill)
    expect(folds).toBeGreaterThan(5);
  });
});
