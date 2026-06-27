import { describe, it, expect } from 'vitest';
import { CATEGORIES, ALL_POSITIONS, emptyStats } from './types';

describe('trainer types', () => {
  it('exposes the four categories', () => {
    expect(CATEGORIES).toEqual(['rfi', 'vs-open', 'vs-3bet', 'push-fold']);
  });
  it('exposes six positions in betting order', () => {
    expect(ALL_POSITIONS).toEqual(['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB']);
  });
  it('emptyStats has a zeroed entry per category', () => {
    const s = emptyStats();
    expect(s.totalAnswered).toBe(0);
    expect(Object.keys(s.byCategory)).toEqual(['rfi', 'vs-open', 'vs-3bet', 'push-fold']);
    expect(s.byCategory['rfi']).toEqual({ answered: 0, best: 0, correct: 0, inaccuracy: 0, mistake: 0 });
  });
});
