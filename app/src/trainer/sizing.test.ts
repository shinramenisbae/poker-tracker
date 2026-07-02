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

  it('RFI CO: UTG/HJ fold, CO hero, BTN pending, blinds posted + pending, pot 1.5', () => {
    const ctx = buildContext('rfi', 'CO');
    const at = (p: string) => ctx.actionHistory.find(h => h.pos === p)!;
    expect(at('UTG').state).toBe('fold');
    expect(at('HJ').state).toBe('fold');
    expect(at('CO').state).toBe('hero');
    expect(at('CO').committedBb).toBe(0);
    expect(at('BTN').state).toBe('pending');
    expect(at('SB').state).toBe('pending');
    expect(at('SB').committedBb).toBeCloseTo(0.5);
    expect(at('BB').state).toBe('pending');
    expect(at('BB').committedBb).toBeCloseTo(1);
    expect(ctx.potBb).toBeCloseTo(1.5);
  });

  it('vs-open BTN vs CO: villain acted 2.5, hero committed 0, pot=sum=4, toCall 2.5, 3bet 7.5', () => {
    const ctx = buildContext('vs-open', 'BTN', 'CO');
    const at = (p: string) => ctx.actionHistory.find(h => h.pos === p)!;
    expect(at('CO').state).toBe('acted');
    expect(at('CO').committedBb).toBeCloseTo(2.5);
    expect(at('CO').live).toBe(true);
    expect(at('BTN').state).toBe('hero');
    expect(at('BTN').committedBb).toBe(0);
    // potBb = sum of committed = 2.5 (open) + 0.5 (SB) + 1 (BB) = 4
    expect(ctx.potBb).toBeCloseTo(4);
    expect(ctx.toCallBb).toBeCloseTo(2.5);
    expect(ctx.legalActions.map(a => a.kind)).toEqual(['fold', 'call', 'raise']);
    const tb = ctx.legalActions.find(a => a.kind === 'raise')!;
    expect(tb.label.startsWith('3-bet to ')).toBe(true);
    expect(tb.sizeBb).toBeCloseTo(7.5);
  });

  it('vs-open BB vs CO: BB already posted 1bb so to-call is reduced', () => {
    const ctx = buildContext('vs-open', 'BB', 'CO');
    expect(ctx.toCallBb).toBeCloseTo(OPEN_BB - 1);
  });

  it('vs-open BB vs SB (villain IS the blind): no blind double-count, pot 3.5', () => {
    const ctx = buildContext('vs-open', 'BB', 'SB');
    const at = (p: string) => ctx.actionHistory.find(h => h.pos === p)!;
    // SB raised to 2.5 (this includes its 0.5 blind), BB has 1 posted.
    expect(at('SB').state).toBe('acted');
    expect(at('SB').committedBb).toBeCloseTo(2.5);
    expect(at('BB').state).toBe('hero');
    expect(at('BB').committedBb).toBeCloseTo(1);
    // pot = 2.5 + 1 = 3.5 (no double-count of the SB blind)
    expect(ctx.potBb).toBeCloseTo(3.5);
  });

  it('vs-3bet UTG vs BTN: hero opened 2.5, BTN 3bet 7.5, EVERYONE else fold, pot 11.5, toCall 5, 4bet 16.5', () => {
    const ctx = buildContext('vs-3bet', 'UTG', 'BTN');
    const at = (p: string) => ctx.actionHistory.find(h => h.pos === p)!;
    // hero's seat cell shows the open he already made...
    expect(at('UTG').state).toBe('hero-acted');
    expect(at('UTG').label).toBe('raise 2.5');
    expect(at('UTG').committedBb).toBeCloseTo(2.5);
    expect(at('UTG').live).toBe(true);
    // ...and the timeline ends with the action back on the hero.
    expect(ctx.actionHistory).toHaveLength(7);
    const last = ctx.actionHistory[ctx.actionHistory.length - 1];
    expect(last.pos).toBe('UTG');
    expect(last.state).toBe('hero');
    expect(last.label).toBe('to act');
    expect(last.committedBb).toBe(0); // no double-count in the pot or chip sprites
    expect(at('BTN').state).toBe('acted');
    expect(at('BTN').committedBb).toBeCloseTo(7.5);
    // every other seat folded, NOT pending
    expect(at('HJ').state).toBe('fold');
    expect(at('CO').state).toBe('fold');
    expect(at('SB').state).toBe('fold');
    expect(at('BB').state).toBe('fold');
    // dead blinds still committed in pot
    expect(at('SB').committedBb).toBeCloseTo(0.5);
    expect(at('BB').committedBb).toBeCloseTo(1);
    expect(at('SB').live).toBe(false);
    // pot = 2.5 + 7.5 + 0.5 + 1 = 11.5
    expect(ctx.potBb).toBeCloseTo(11.5);
    expect(ctx.toCallBb).toBeCloseTo(5);
    expect(ctx.legalActions.map(a => a.kind)).toEqual(['fold', 'call', 'raise']);
    const fb = ctx.legalActions.find(a => a.kind === 'raise')!;
    expect(fb.label.startsWith('4-bet to ')).toBe(true);
    expect(fb.sizeBb).toBeCloseTo(16.5);
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
