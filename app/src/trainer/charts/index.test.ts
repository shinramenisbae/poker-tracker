import { describe, it, expect } from 'vitest';
import { availableScenarios, getStrategy } from './index';
import type { Position } from '../types';
import { ALL_POSITIONS } from '../types';
import { allHandClasses } from '../ranges';

describe('chart store', () => {
  it('lists RFI hero positions from the chart data', () => {
    const rfi = availableScenarios('rfi');
    expect(rfi.length).toBeGreaterThan(0);
    expect(rfi.every(s => s.hero && !s.villain)).toBe(true);
    expect(rfi.map(s => s.hero)).toContain('UTG');
  });

  it('RFI surfaces all opening positions', () => {
    const rfi = availableScenarios('rfi');
    const heroes = new Set(rfi.map(s => s.hero));
    // UTG, HJ, CO, BTN, SB all have RFI charts; BB does not open-raise.
    for (const pos of ['UTG', 'HJ', 'CO', 'BTN', 'SB'] as Position[]) {
      expect(heroes.has(pos)).toBe(true);
    }
  });

  it('lists vs-open scenarios with a villain', () => {
    const vo = availableScenarios('vs-open');
    expect(vo.length).toBeGreaterThan(0);
    expect(vo.every(s => !!s.villain)).toBe(true);
    expect(vo.map(s => s.villain)).toContain('HJ');
  });

  it('push-fold scenarios carry a depth', () => {
    const pf = availableScenarios('push-fold');
    expect(pf.length).toBeGreaterThan(0);
    expect(pf.every(s => typeof s.depth === 'number')).toBe(true);
  });

  it('AA is never a fold in any scenario', () => {
    for (const cat of ['rfi', 'vs-open', 'vs-3bet', 'push-fold'] as const) {
      const sc = availableScenarios(cat)[0];
      const strat = getStrategy(cat, sc.hero, 'AA', sc.villain, sc.depth);
      expect((strat.fold ?? 0)).toBeLessThan(1);
    }
  });

  it('a trash hand folds at RFI', () => {
    const sc = availableScenarios('rfi').find(s => s.hero === 'UTG')!;
    const strat = getStrategy('rfi', sc.hero, '72o', sc.villain, sc.depth);
    expect(strat.fold).toBe(1);
  });

  it('AA is not a fold for HJ RFI', () => {
    const strat = getStrategy('rfi', 'HJ', 'AA');
    expect((strat.fold ?? 0)).toBeLessThan(1);
  });

  it('no availableScenarios hero or villain is undefined (no silent data loss)', () => {
    for (const cat of ['rfi', 'vs-open', 'vs-3bet', 'push-fold'] as const) {
      const scenes = availableScenarios(cat);
      for (const sc of scenes) {
        expect(ALL_POSITIONS).toContain(sc.hero);
        if (sc.villain !== undefined) {
          expect(ALL_POSITIONS).toContain(sc.villain);
        }
      }
    }
  });

  it('every chart strategy sums to ~1 across all scenarios and hands', () => {
    const hands = allHandClasses();
    for (const cat of ['rfi', 'vs-open', 'vs-3bet'] as const) {
      for (const sc of availableScenarios(cat)) {
        for (const hc of hands) {
          const s = getStrategy(cat, sc.hero, hc, sc.villain);
          const sum = Object.values(s).reduce((a, b) => a + (b ?? 0), 0);
          expect(sum, `${cat} ${sc.hero} vs ${sc.villain ?? '-'} ${hc}`).toBeGreaterThan(0.98);
          expect(sum).toBeLessThan(1.02);
        }
      }
    }
  });

  it('charts carry genuinely mixed frequencies (the point of this dataset)', () => {
    const hands = allHandClasses();
    const mixedShare = (cat: 'rfi' | 'vs-open' | 'vs-3bet') => {
      let mixed = 0, total = 0;
      for (const sc of availableScenarios(cat)) {
        for (const hc of hands) {
          const s = getStrategy(cat, sc.hero, hc, sc.villain);
          // button space: raise and allin share one button
          const btn = [(s.raise ?? 0) + (s.allin ?? 0), s.call ?? 0, s.fold ?? 0];
          total++;
          if (btn.filter(f => f >= 0.05).length >= 2) mixed++;
        }
      }
      return mixed / total;
    };
    expect(mixedShare('vs-open')).toBeGreaterThan(0.15);
    expect(mixedShare('rfi')).toBeGreaterThan(0.05);
    expect(mixedShare('vs-3bet')).toBeGreaterThan(0.05);
    // a known nuanced cell: BB defending vs BTN open mixes 3-bet and call with ATs
    const ats = getStrategy('vs-open', 'BB', 'ATs', 'BTN');
    expect(ats.raise ?? 0).toBeGreaterThan(0.05);
    expect(ats.call ?? 0).toBeGreaterThan(0.5);
  });
});
