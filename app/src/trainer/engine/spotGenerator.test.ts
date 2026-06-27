import { describe, it, expect } from 'vitest';
import { generateSpot } from './spotGenerator';
import { handClassOf } from '../ranges';

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
});
