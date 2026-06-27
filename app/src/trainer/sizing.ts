import type { ActionOption, Category, HistoryItem, Position } from './types';
import { ALL_POSITIONS } from './types';

export const SB_BB = 0.5;
export const BB_BB = 1;
export const OPEN_BB = 2.5;

const order = (p: Position) => ALL_POSITIONS.indexOf(p);
const round05 = (x: number) => Math.round(x * 2) / 2;

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

function isInPosition(hero: Position, villain: Position): boolean {
  // hero acts after villain on later streets if hero is later in order, except blinds act first postflop.
  // For 3-bet sizing we only need: hero in position vs the opener => hero seat later and hero not a blind.
  return order(hero) > order(villain) && hero !== 'SB' && hero !== 'BB';
}

export function buildContext(
  category: Category,
  heroPos: Position,
  villainPos?: Position,
  effStackBb = 100,
): SpotContext {
  if (category === 'rfi') {
    return {
      potBb: SB_BB + BB_BB,
      toCallBb: 0,
      legalActions: [FOLD, { kind: 'raise', label: `Open to ${OPEN_BB}bb`, sizeBb: OPEN_BB, bucket: 'raise', covers: ['raise', 'allin'] }],
      actionHistory: history(heroPos, undefined, undefined),
    };
  }

  if (category === 'push-fold') {
    return {
      potBb: SB_BB + BB_BB,
      toCallBb: 0,
      legalActions: [FOLD, { kind: 'allin', label: `Jam ${effStackBb}bb`, sizeBb: effStackBb, bucket: 'allin', covers: ['allin', 'raise'] }],
      actionHistory: history(heroPos, undefined, undefined),
    };
  }

  if (category === 'vs-open') {
    const v = villainPos!;
    const threeBet = round05(OPEN_BB * (isInPosition(heroPos, v) ? 3 : 4));
    const pot = OPEN_BB + SB_BB + BB_BB; // blinds + opener (opener pays open; if opener is a blind this slightly overcounts — acceptable for display)
    const toCall = OPEN_BB - blindPosted(heroPos);
    return {
      potBb: pot,
      toCallBb: round05(toCall),
      legalActions: [
        FOLD,
        { kind: 'call', label: `Call ${round05(toCall)}bb`, sizeBb: round05(toCall), bucket: 'call', covers: ['call'] },
        { kind: 'raise', label: `3-bet to ${threeBet}bb`, sizeBb: threeBet, bucket: 'raise', covers: ['raise', 'allin'] },
      ],
      actionHistory: history(heroPos, v, OPEN_BB),
    };
  }

  // vs-3bet: hero opened, villain 3-bet; hero faces the 3-bet.
  const v = villainPos!;
  const villainIP = isInPosition(v, heroPos);
  const threeBet = round05(OPEN_BB * (villainIP ? 3 : 4));
  const fourBet = round05(threeBet * 2.2);
  const pot = OPEN_BB + threeBet + SB_BB + BB_BB;
  const toCall = threeBet - OPEN_BB;
  return {
    potBb: round05(pot),
    toCallBb: round05(toCall),
    legalActions: [
      FOLD,
      { kind: 'call', label: 'Call', sizeBb: round05(toCall), bucket: 'call', covers: ['call'] },
      { kind: 'raise', label: `4-bet to ${fourBet}bb`, sizeBb: fourBet, bucket: 'raise', covers: ['raise', 'allin'] },
    ],
    actionHistory: history(heroPos, v, threeBet),
  };
}

/** Build a per-seat strip in betting order. Aggressor 'acted', hero 'hero', seats after hero 'pending', the rest 'fold'. */
function history(heroPos: Position, aggressor: Position | undefined, amountBb: number | undefined): HistoryItem[] {
  const hi = order(heroPos);
  return ALL_POSITIONS.map((pos): HistoryItem => {
    if (pos === heroPos) return { pos, state: 'hero', label: 'YOU' };
    if (aggressor && pos === aggressor) {
      return { pos, state: 'acted', label: amountBb ? `raise ${amountBb}` : 'raise', amountBb };
    }
    if (order(pos) > hi) return { pos, state: 'pending', label: 'to act' };
    return { pos, state: 'fold', label: 'fold' };
  });
}
