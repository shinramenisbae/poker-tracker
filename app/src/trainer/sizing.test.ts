import { describe, it, expect } from 'vitest';
import { buildContext, OPEN_BB } from './sizing';

describe('sizing/context', () => {
  it('RFI: pot is the blinds, hero opens, buttons are fold + open', () => {
    const ctx = buildContext('rfi', 'CO');
    expect(ctx.potBb).toBeCloseTo(1.5);
    expect(ctx.toCallBb).toBe(0);
    const kinds = ctx.legalActions.map(a => a.kind);
    expect(kinds).toEqual(['fold', 'raise']);
    const open = ctx.legalActions.find(a => a.kind === 'raise')!;
    expect(open.sizeBb).toBe(OPEN_BB);
    expect(open.label).toBe(`Open to ${OPEN_BB}bb`);
    expect(open.covers).toEqual(['raise', 'allin']);
  });

  it('vs-open BTN vs CO: pot = open + blinds, to call = open, buttons fold/call/3bet', () => {
    const ctx = buildContext('vs-open', 'BTN', 'CO');
    expect(ctx.potBb).toBeCloseTo(OPEN_BB + 1.5);
    expect(ctx.toCallBb).toBeCloseTo(OPEN_BB);
    expect(ctx.legalActions.map(a => a.kind)).toEqual(['fold', 'call', 'raise']);
    const tb = ctx.legalActions.find(a => a.kind === 'raise')!;
    expect(tb.label.startsWith('3-bet to ')).toBe(true);
    // in position 3-bet = 3x open
    expect(tb.sizeBb).toBeCloseTo(OPEN_BB * 3);
  });

  it('vs-open BB vs CO: BB already posted 1bb so to-call is reduced', () => {
    const ctx = buildContext('vs-open', 'BB', 'CO');
    expect(ctx.toCallBb).toBeCloseTo(OPEN_BB - 1);
  });

  it('push-fold: hero jams the effective stack, buttons fold/jam', () => {
    const ctx = buildContext('push-fold', 'BTN', undefined, 15);
    expect(ctx.legalActions.map(a => a.kind)).toEqual(['fold', 'allin']);
    const jam = ctx.legalActions.find(a => a.kind === 'allin')!;
    expect(jam.sizeBb).toBe(15);
    expect(jam.label).toBe('Jam 15bb');
    expect(jam.covers).toEqual(['allin', 'raise']);
  });

  it('action history marks folds, the aggressor, hero, and pending blinds', () => {
    const ctx = buildContext('vs-open', 'BTN', 'CO');
    const co = ctx.actionHistory.find(h => h.pos === 'CO')!;
    const btn = ctx.actionHistory.find(h => h.pos === 'BTN')!;
    const bb = ctx.actionHistory.find(h => h.pos === 'BB')!;
    expect(co.state).toBe('acted');
    expect(btn.state).toBe('hero');
    expect(bb.state).toBe('pending');
  });
});
