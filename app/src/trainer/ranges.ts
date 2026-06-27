import type { Card, HandClass, Rank } from './types';

export const RANKS: Rank[] = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];
const RANK_INDEX: Record<string, number> = Object.fromEntries(RANKS.map((r, i) => [r, i]));
const SUITS: Card['suit'][] = ['s', 'h', 'd', 'c'];

export function allHandClasses(): HandClass[] {
  const out: HandClass[] = [];
  for (let i = 0; i < 13; i++) {
    for (let j = 0; j < 13; j++) {
      if (i === j) out.push(RANKS[i] + RANKS[i]);
      else if (i < j) out.push(RANKS[i] + RANKS[j] + 's');
      else out.push(RANKS[j] + RANKS[i] + 'o');
    }
  }
  return out;
}

export function handClassOf(a: Card, b: Card): HandClass {
  const ai = RANK_INDEX[a.rank];
  const bi = RANK_INDEX[b.rank];
  const [hi, lo] = ai <= bi ? [a, b] : [b, a];
  if (hi.rank === lo.rank) return hi.rank + lo.rank;
  return hi.rank + lo.rank + (hi.suit === lo.suit ? 's' : 'o');
}

export function comboCountOf(hc: HandClass): number {
  if (hc.length === 2) return 6;          // pair
  return hc.endsWith('s') ? 4 : 12;
}

/** Uniform over all 1326 combos: pick two distinct cards from a shuffled-by-rng draw. */
export function randomCombo(rng: () => number): [Card, Card] {
  const deck: Card[] = [];
  for (const r of RANKS) for (const s of SUITS) deck.push({ rank: r, suit: s });
  const i = Math.floor(rng() * deck.length);
  let j = Math.floor(rng() * deck.length);
  if (j === i) j = (j + 1) % deck.length;
  return [deck[i], deck[j]];
}

export function gridIndex(hc: HandClass): { row: number; col: number } {
  const r0 = RANK_INDEX[hc[0]];
  const r1 = RANK_INDEX[hc[1]];
  if (hc.length === 2) return { row: r0, col: r0 };
  if (hc.endsWith('s')) return { row: Math.min(r0, r1), col: Math.max(r0, r1) };
  return { row: Math.max(r0, r1), col: Math.min(r0, r1) }; // offsuit -> below diagonal
}

/** Parse standard range notation: "TT+, A2s+, KQo, 72o". Returns a set of hand classes. */
export function expandNotation(notation: string): Set<HandClass> {
  const out = new Set<HandClass>();
  for (let token of notation.split(',')) {
    token = token.trim();
    if (!token) continue;
    const plus = token.endsWith('+');
    const base = plus ? token.slice(0, -1) : token;

    if (base.length === 2 && base[0] === base[1]) {
      // pair, e.g. TT or TT+
      const start = RANK_INDEX[base[0]];
      const range = plus ? rangeUpTo(start) : [start];
      for (const idx of range) out.add(RANKS[idx] + RANKS[idx]);
    } else if (base.length === 3) {
      const hi = base[0], suit = base[2];
      const loStart = RANK_INDEX[base[1]];
      const hiIdx = RANK_INDEX[hi];
      // plus walks the low card up toward (but not reaching) the high card
      const lows = plus ? rangeBetween(loStart, hiIdx + 1) : [loStart];
      for (const loIdx of lows) out.add(hi + RANKS[loIdx] + suit);
    }
  }
  return out;
}

/** indices from `start` up to and including AA (index 0), i.e. stronger pairs. */
function rangeUpTo(start: number): number[] {
  const out: number[] = [];
  for (let i = start; i >= 0; i--) out.push(i);
  return out;
}

/** indices from `start` (weak, larger index) up to `endExclusive` (stronger, smaller index). */
function rangeBetween(start: number, endExclusive: number): number[] {
  const out: number[] = [];
  for (let i = start; i > endExclusive - 1; i--) out.push(i);
  return out;
}
