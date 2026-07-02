import type { ActionOption, Category, HistoryItem, Position } from './types';
import { ALL_POSITIONS } from './types';

export const SB_BB = 0.5;
export const BB_BB = 1;
export const OPEN_BB = 2.5;

export const order = (p: Position) => ALL_POSITIONS.indexOf(p);
const round05 = (x: number) => Math.round(x * 2) / 2;
const sumCommitted = (items: HistoryItem[]) => round05(items.reduce((a, h) => a + h.committedBb, 0));

export interface SpotContext {
  potBb: number;
  toCallBb: number;
  actionHistory: HistoryItem[];
  legalActions: ActionOption[];
}

const FOLD: ActionOption = { kind: 'fold', label: 'Fold', bucket: 'fold', covers: ['fold'] };

function blindPosted(pos: Position): number {
  if (pos === 'SB') return SB_BB;
  if (pos === 'BB') return BB_BB;
  return 0;
}

export function buildContext(
  category: Category,
  heroPos: Position,
  villainPos?: Position,
  effStackBb = 100,
): SpotContext {
  if (category === 'rfi' || category === 'push-fold') {
    const actionHistory = openerHistory(heroPos);
    const legalActions: ActionOption[] = category === 'rfi'
      ? [FOLD, { kind: 'raise', label: `Open to ${OPEN_BB}bb`, sizeBb: OPEN_BB, bucket: 'raise', covers: ['raise', 'allin'] }]
      : [FOLD, { kind: 'allin', label: `Jam ${effStackBb}bb`, sizeBb: effStackBb, bucket: 'allin', covers: ['allin', 'raise'] }];
    return { potBb: sumCommitted(actionHistory), toCallBb: 0, actionHistory, legalActions };
  }

  if (category === 'vs-open') {
    const v = villainPos!;
    const heroInPosVsVillain = order(heroPos) > order(v) && heroPos !== 'SB' && heroPos !== 'BB';
    const threeBet = round05(OPEN_BB * (heroInPosVsVillain ? 3 : 4));
    const toCall = round05(OPEN_BB - blindPosted(heroPos));
    const actionHistory = vsOpenHistory(heroPos, v);
    return {
      potBb: sumCommitted(actionHistory),
      toCallBb: toCall,
      legalActions: [
        FOLD,
        { kind: 'call', label: `Call ${toCall}bb`, sizeBb: toCall, bucket: 'call', covers: ['call'] },
        { kind: 'raise', label: `3-bet to ${threeBet}bb`, sizeBb: threeBet, bucket: 'raise', covers: ['raise', 'allin'] },
      ],
      actionHistory,
    };
  }

  // vs-3bet: hero opened, a LATER villain 3-bet, and it folded back to hero.
  const v = villainPos!;
  const villainInPos = order(v) > order(heroPos) && v !== 'SB' && v !== 'BB';
  const threeBet = round05(OPEN_BB * (villainInPos ? 3 : 4));
  const fourBet = round05(threeBet * 2.2);
  const toCall = round05(threeBet - OPEN_BB);
  const actionHistory = vs3betHistory(heroPos, v, threeBet);
  return {
    potBb: sumCommitted(actionHistory),
    toCallBb: toCall,
    legalActions: [
      FOLD,
      { kind: 'call', label: `Call ${toCall}bb`, sizeBb: toCall, bucket: 'call', covers: ['call'] },
      { kind: 'raise', label: `4-bet to ${fourBet}bb`, sizeBb: fourBet, bucket: 'raise', covers: ['raise', 'allin'] },
    ],
    actionHistory,
  };
}

/** rfi / push-fold: hero is the first voluntary actor. Earlier non-blinds folded; later seats (incl. live blinds) pending. */
function openerHistory(heroPos: Position): HistoryItem[] {
  const hi = order(heroPos);
  return ALL_POSITIONS.map((pos): HistoryItem => {
    const blind = blindPosted(pos);
    if (pos === heroPos) return { pos, state: 'hero', label: 'to act', committedBb: blind, live: true };
    if (order(pos) < hi && blind === 0) return { pos, state: 'fold', label: 'fold', committedBb: 0, live: false };
    if (order(pos) > hi) return { pos, state: 'pending', label: 'to act', committedBb: blind, live: true };
    // order(pos) < hi but a blind: treated as dead-folded money (can't happen for rfi heroes UTG..SB).
    return { pos, state: 'fold', label: 'fold', committedBb: blind, live: false };
  });
}

/** vs-open: villain (earlier) opened; hero faces it; seats after hero pending; the rest folded (blinds dead). */
function vsOpenHistory(heroPos: Position, villain: Position): HistoryItem[] {
  const hi = order(heroPos);
  return ALL_POSITIONS.map((pos): HistoryItem => {
    const blind = blindPosted(pos);
    if (pos === villain) return { pos, state: 'acted', label: `raise ${OPEN_BB}`, amountBb: OPEN_BB, committedBb: OPEN_BB, live: true };
    if (pos === heroPos) return { pos, state: 'hero', label: 'to act', committedBb: blind, live: true };
    if (order(pos) > hi) return { pos, state: 'pending', label: 'to act', committedBb: blind, live: true };
    return { pos, state: 'fold', label: 'fold', committedBb: blind, live: false };
  });
}

/**
 * vs-3bet: hero opened, villain (later) 3-bet, folded back to hero. Only hero + villain live;
 * everyone else folded. The strip is a timeline, so the hero appears twice: his seat cell shows
 * the open he already made, and a trailing cell shows the action back on him. The trailing cell
 * carries committedBb 0 so the pot sum and bet-chip sprites count his chips exactly once.
 */
function vs3betHistory(heroPos: Position, villain: Position, threeBet: number): HistoryItem[] {
  const seats = ALL_POSITIONS.map((pos): HistoryItem => {
    const blind = blindPosted(pos);
    if (pos === heroPos) return { pos, state: 'hero-acted', label: `raise ${OPEN_BB}`, amountBb: OPEN_BB, committedBb: OPEN_BB, live: true };
    if (pos === villain) return { pos, state: 'acted', label: `3-bet ${threeBet}`, amountBb: threeBet, committedBb: threeBet, live: true };
    return { pos, state: 'fold', label: 'fold', committedBb: blind, live: false };
  });
  return [...seats, { pos: heroPos, state: 'hero', label: 'to act', committedBb: 0, live: true }];
}
