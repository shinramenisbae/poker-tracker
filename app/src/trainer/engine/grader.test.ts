import { describe, it, expect } from 'vitest';
import { grade, TIER_COLOR } from './grader';
import type { ActionOption } from '../types';

const FOLD: ActionOption = { kind: 'fold', label: 'Fold', bucket: 'fold', covers: ['fold'] };
const CALL: ActionOption = { kind: 'call', label: 'Call', bucket: 'call', covers: ['call'] };
const RAISE: ActionOption = { kind: 'raise', label: '3-bet', bucket: 'raise', covers: ['raise', 'allin'] };
const ACTIONS = [FOLD, CALL, RAISE];

describe('grader', () => {
  it('marks the top-frequency button as Best', () => {
    const r = grade(ACTIONS, { raise: 0.78, call: 0.22 }, 'raise');
    expect(r.tier).toBe('best');
    expect(r.color).toBe('positive');
    expect(r.bestBucket).toBe('raise');
  });
  it('a played-but-not-top button is Correct (neutral)', () => {
    const r = grade(ACTIONS, { raise: 0.78, call: 0.22 }, 'call');
    expect(r.tier).toBe('correct');
    expect(r.color).toBe('primary');
    expect(r.chosenFreq).toBeCloseTo(0.22);
  });
  it('a rarely-played button (<3.5%) is an Inaccuracy (red)', () => {
    const r = grade(ACTIONS, { raise: 0.97, call: 0.03 }, 'call');
    expect(r.tier).toBe('inaccuracy');
    expect(r.color).toBe('negative');
  });
  it('a never-played button is a Mistake (red)', () => {
    const r = grade(ACTIONS, { raise: 1 }, 'fold');
    expect(r.tier).toBe('mistake');
    expect(r.color).toBe('negative');
  });
  it('aggregates raw allin into the raise button', () => {
    const r = grade(ACTIONS, { raise: 0.5, allin: 0.5 }, 'raise');
    expect(r.chosenFreq).toBeCloseTo(1);
    expect(r.tier).toBe('best');
    expect(r.buttonFreq.raise).toBeCloseTo(1);
  });
  it('TIER_COLOR maps tiers to palette tokens', () => {
    expect(TIER_COLOR.best).toBe('positive');
    expect(TIER_COLOR.correct).toBe('primary');
    expect(TIER_COLOR.mistake).toBe('negative');
  });
});
