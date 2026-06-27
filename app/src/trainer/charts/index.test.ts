import { describe, it, expect } from 'vitest';
import { availableScenarios, getStrategy } from './index';
import type { Position } from '../types';
import { ALL_POSITIONS } from '../types';

describe('chart store', () => {
  it('lists RFI hero positions from the Greenline data', () => {
    const rfi = availableScenarios('rfi');
    expect(rfi.length).toBeGreaterThan(0);
    expect(rfi.every(s => s.hero && !s.villain)).toBe(true);
    expect(rfi.map(s => s.hero)).toContain('UTG');
  });

  it('RFI includes HJ (mapped from MP in the vendored data)', () => {
    const rfi = availableScenarios('rfi');
    const heroes = rfi.map(s => s.hero);
    // The vendored data stores 'MP-RFI'; we must surface it as HJ.
    expect(heroes).toContain('HJ');
  });

  it('RFI surfaces all six positions', () => {
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
  });

  it('vs-open includes HJ as a villain (mapped from MP in the vendored data)', () => {
    const vo = availableScenarios('vs-open');
    const villains = vo.map(s => s.villain);
    expect(villains).toContain('HJ');
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

  it('AA is not a fold for HJ RFI (tests HJ→MP data key translation)', () => {
    // If the mapping were broken, getStrategy('rfi','HJ',…) would look up 'HJ-RFI'
    // (which doesn't exist) and return {fold:1} for every hand including AA.
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
});
