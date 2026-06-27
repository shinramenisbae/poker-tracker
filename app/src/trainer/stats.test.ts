import { describe, it, expect } from 'vitest';
import { applyResult } from './stats';
import { emptyStats } from './types';

describe('stats', () => {
  it('best increments correct + streak', () => {
    const s = applyResult(emptyStats(), 'rfi', 'best', '2026-06-27');
    expect(s.totalAnswered).toBe(1);
    expect(s.totalCorrect).toBe(1);
    expect(s.currentStreak).toBe(1);
    expect(s.bestStreak).toBe(1);
    expect(s.byCategory.rfi.best).toBe(1);
  });
  it('correct also counts and continues the streak', () => {
    let s = applyResult(emptyStats(), 'rfi', 'best', 'd');
    s = applyResult(s, 'vs-open', 'correct', 'd');
    expect(s.totalCorrect).toBe(2);
    expect(s.currentStreak).toBe(2);
  });
  it('inaccuracy/mistake break the streak but keep bestStreak', () => {
    let s = applyResult(emptyStats(), 'rfi', 'best', 'd');
    s = applyResult(s, 'rfi', 'mistake', 'd');
    expect(s.currentStreak).toBe(0);
    expect(s.bestStreak).toBe(1);
    expect(s.totalCorrect).toBe(1);
    expect(s.byCategory.rfi.mistake).toBe(1);
  });
});
