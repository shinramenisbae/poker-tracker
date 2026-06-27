import { describe, it, expect } from 'vitest';
import { availableScenarios, getStrategy } from './index';

describe('chart store', () => {
  it('lists RFI hero positions from the Greenline data', () => {
    const rfi = availableScenarios('rfi');
    expect(rfi.length).toBeGreaterThan(0);
    expect(rfi.every(s => s.hero && !s.villain)).toBe(true);
    expect(rfi.map(s => s.hero)).toContain('UTG');
  });

  it('lists vs-open scenarios with a villain', () => {
    const vo = availableScenarios('vs-open');
    expect(vo.length).toBeGreaterThan(0);
    expect(vo.every(s => !!s.villain)).toBe(true);
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
});
