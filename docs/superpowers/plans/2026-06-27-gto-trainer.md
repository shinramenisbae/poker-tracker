# GTO Trainer (Phase 1 — Preflop) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a client-side preflop GTO trainer page to the React app where the user answers realistic spots (RFI / facing-an-open / facing-a-3bet / short-stack push-fold) and is graded against bundled GTO chart data with color-coded feedback and per-device stats.

**Architecture:** Pure-TypeScript engine (`ranges`, `sizing`, chart converters, `grader`, `spotGenerator`, `stats`) under `app/src/trainer/`, consumed by React components under `app/src/components/trainer/` and a `Trainer.tsx` page. Chart data is vendored as static modules (Greenline, MIT) plus a hand-authored push/fold notation set, converted at load time into a uniform `Strategy` (bucket→frequency) lookup. No backend, no live solving. Grading works in **button space**: each on-screen action button aggregates one or more raw chart buckets, so the displayed buttons are fixed per category (no answer leakage) and the small/big postflop split slots in later with no rework.

**Tech Stack:** React 19, TypeScript 5.9, Vite 7, Tailwind 3.4, React Router 7 (HashRouter). Tests via Vitest + @testing-library/react + jsdom (added in Task 1).

**Conventions:**
- Work on branch `feature/gto-trainer` (already created; spec committed there).
- Commit messages use the repo's `Area: description` style with prefix `Trainer:`.
- Run a single test file: `cd app && npx vitest run src/trainer/<file>.test.ts`.
- Full suite: `cd app && npx vitest run`. Build: `cd app && npm run build`. Lint: `cd app && npm run lint`.

---

## File Structure

```
app/
  vitest.config.ts                         # NEW — test runner config (jsdom)
  src/test/setup.ts                        # NEW — jest-dom matchers
  src/trainer/
    types.ts                               # NEW — all trainer types (single source of truth)
    ranges.ts                              # NEW — 169 hand classes, combo↔class, notation parser
    sizing.ts                              # NEW — preflop sizing/pot/context model
    charts/
      source/poker-types.ts                # NEW — vendored minimal Cell/Chart types
      source/greenline.ts                  # NEW — vendored Greenline data (downloaded)
      source/NOTICE.md                     # NEW — MIT attribution
      pushfold.ts                          # NEW — hand-authored push/fold notation data
      convert.ts                           # NEW — Cell→Strategy + notation→Strategy
      index.ts                             # NEW — unified chart store / lookup API
    engine/
      grader.ts                            # NEW — grade a chosen button vs strategy
      spotGenerator.ts                     # NEW — build a Spot for a category
    stats.ts                               # NEW — localStorage-backed trainer stats
  src/components/trainer/
    ActionButtons.tsx                      # NEW
    RangeGrid.tsx                          # NEW
    PokerTable.tsx                         # NEW
    ActionHistoryStrip.tsx                 # NEW
    FeedbackPanel.tsx                      # NEW
  src/pages/Trainer.tsx                    # NEW — page wiring it all together
  src/App.tsx                              # MODIFY — add /trainer route
  src/pages/Home.tsx                       # MODIFY — add 🎯 header button
```

---

## Task 1: Add the test runner

**Files:**
- Modify: `app/package.json`
- Create: `app/vitest.config.ts`
- Create: `app/src/test/setup.ts`
- Create: `app/src/test/sanity.test.ts`

- [ ] **Step 1: Install dev dependencies**

Run:
```bash
cd app && npm install -D vitest@^2 jsdom@^25 @testing-library/react@^16 @testing-library/jest-dom@^6 @testing-library/user-event@^14
```
Expected: packages added to `devDependencies`, no errors.

- [ ] **Step 2: Add the `test` script**

In `app/package.json`, add to `"scripts"`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Create `app/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
```

- [ ] **Step 4: Create `app/src/test/setup.ts`**

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 5: Create `app/src/test/sanity.test.ts`**

```ts
import { describe, it, expect } from 'vitest';

describe('test runner', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 6: Run it**

Run: `cd app && npx vitest run src/test/sanity.test.ts`
Expected: 1 passed.

- [ ] **Step 7: Make sure the production build still ignores test files**

`tsconfig.app.json` compiles `src`. Vitest globals (`describe`/`it`) are only in test files which `tsc -b` for the app build may try to type-check. Add `"vitest/globals"` to the app types and exclude tests from the build:

In `app/tsconfig.app.json`, ensure `"compilerOptions".types` includes `"vitest/globals"` and `"@testing-library/jest-dom"`, and add to the root of that file:
```json
"exclude": ["src/**/*.test.ts", "src/**/*.test.tsx", "src/test"]
```
(If `exclude` already exists, merge these globs in.)

- [ ] **Step 8: Verify build is clean**

Run: `cd app && npm run build`
Expected: build succeeds (no TS errors from test files).

- [ ] **Step 9: Commit**

```bash
git add app/package.json app/package-lock.json app/vitest.config.ts app/src/test
git commit -m "Trainer: add Vitest + testing-library test runner"
```

---

## Task 2: Trainer types (single source of truth)

**Files:**
- Create: `app/src/trainer/types.ts`
- Test: `app/src/trainer/types.test.ts`

- [ ] **Step 1: Write the failing test**

`app/src/trainer/types.test.ts`:
```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && npx vitest run src/trainer/types.test.ts`
Expected: FAIL ("Cannot find module './types'").

- [ ] **Step 3: Create `app/src/trainer/types.ts`**

```ts
export type Position = 'UTG' | 'HJ' | 'CO' | 'BTN' | 'SB' | 'BB';
export const ALL_POSITIONS: Position[] = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'];

export type Category = 'rfi' | 'vs-open' | 'vs-3bet' | 'push-fold';
export const CATEGORIES: Category[] = ['rfi', 'vs-open', 'vs-3bet', 'push-fold'];

/** Raw chart action buckets. Preflop never uses 'check'; postflop (Phase 2) adds bet sizes. */
export type Bucket = 'fold' | 'check' | 'call' | 'raise' | 'allin';

export type Rank = 'A' | 'K' | 'Q' | 'J' | 'T' | '9' | '8' | '7' | '6' | '5' | '4' | '3' | '2';
export type Suit = 's' | 'h' | 'd' | 'c';
export interface Card { rank: Rank; suit: Suit; }

/** e.g. 'AA', 'AKs', 'AKo' */
export type HandClass = string;

/** Frequencies (0..1) over raw buckets; omitted buckets are 0. Should sum to ~1. */
export type Strategy = Partial<Record<Bucket, number>>;

export interface ActionOption {
  kind: 'fold' | 'check' | 'call' | 'raise' | 'allin';
  label: string;            // concrete, user-facing: "3-bet to 7.5bb", "Jam 15bb"
  sizeBb?: number;
  bucket: Bucket;           // identity of this button
  covers: Bucket[];         // raw strategy buckets this button aggregates (e.g. raise covers ['raise','allin'])
}

export interface HistoryItem {
  pos: Position;
  state: 'fold' | 'acted' | 'hero' | 'pending';
  label: string;            // 'fold', 'raise 2.5', 'YOU', 'to act'
  amountBb?: number;
}

export interface Spot {
  id: string;
  category: Category;
  format: string;           // "Cash 6-max" | "MTT"
  effStackBb: number;
  heroPos: Position;
  villainPos?: Position;
  actionHistory: HistoryItem[];
  potBb: number;
  toCallBb: number;
  heroHand: [Card, Card];
  handClass: HandClass;
  legalActions: ActionOption[];
  strategy: Strategy;       // raw bucket frequencies for the hero hand
  source: string;           // attribution
}

export type Tier = 'best' | 'correct' | 'inaccuracy' | 'mistake' | 'blunder';
export type TierColor = 'positive' | 'primary' | 'negative';

export interface GradeResult {
  tier: Tier;
  color: TierColor;
  chosen: Bucket;
  bestBucket: Bucket;
  /** Aggregated frequency the user actually had at their chosen button (0..1). */
  chosenFreq: number;
  /** Aggregated frequency per button bucket (button space), for the feedback breakdown. */
  buttonFreq: Partial<Record<Bucket, number>>;
}

export interface CategoryStat { answered: number; best: number; correct: number; inaccuracy: number; mistake: number; }

export interface TrainerStats {
  totalAnswered: number;
  totalCorrect: number;     // best + correct
  currentStreak: number;
  bestStreak: number;
  byCategory: Record<Category, CategoryStat>;
  lastPlayed: string;       // ISO date, '' if never
}

export function emptyStats(): TrainerStats {
  const byCategory = {} as Record<Category, CategoryStat>;
  for (const c of CATEGORIES) byCategory[c] = { answered: 0, best: 0, correct: 0, inaccuracy: 0, mistake: 0 };
  return { totalAnswered: 0, totalCorrect: 0, currentStreak: 0, bestStreak: 0, byCategory, lastPlayed: '' };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd app && npx vitest run src/trainer/types.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/trainer/types.ts app/src/trainer/types.test.ts
git commit -m "Trainer: core types (Spot, Strategy, GradeResult, TrainerStats)"
```

---

## Task 3: Hand-range utilities (`ranges.ts`)

**Files:**
- Create: `app/src/trainer/ranges.ts`
- Test: `app/src/trainer/ranges.test.ts`

- [ ] **Step 1: Write the failing test**

`app/src/trainer/ranges.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { RANKS, allHandClasses, handClassOf, comboCountOf, randomCombo, expandNotation, gridIndex } from './ranges';
import type { Card } from './types';

const c = (s: string): Card => ({ rank: s[0] as any, suit: s[1] as any });

describe('ranges', () => {
  it('enumerates 169 unique classes', () => {
    const all = allHandClasses();
    expect(all.length).toBe(169);
    expect(new Set(all).size).toBe(169);
    expect(all).toContain('AA');
    expect(all).toContain('AKs');
    expect(all).toContain('AKo');
  });

  it('classifies combos: pair, suited, offsuit (high card first)', () => {
    expect(handClassOf(c('Ah'), c('Ad'))).toBe('AA');
    expect(handClassOf(c('Ah'), c('Kh'))).toBe('AKs');
    expect(handClassOf(c('Kd'), c('Ah'))).toBe('AKo'); // order-independent, ranks reordered
  });

  it('combo counts: pair=6, suited=4, offsuit=12', () => {
    expect(comboCountOf('AA')).toBe(6);
    expect(comboCountOf('AKs')).toBe(4);
    expect(comboCountOf('AKo')).toBe(12);
  });

  it('randomCombo is reproducible with a seeded rng and yields two distinct cards', () => {
    let i = 0;
    const seq = [0.99, 0.0, 0.5, 0.5]; // deterministic
    const rng = () => seq[i++ % seq.length];
    const [a, b] = randomCombo(rng);
    expect(a.rank + a.suit).not.toBe(b.rank + b.suit);
  });

  it('expandNotation handles +, suited/offsuit, and explicit combos', () => {
    expect(expandNotation('TT+')).toEqual(new Set(['TT', 'JJ', 'QQ', 'KK', 'AA']));
    expect(expandNotation('A2s+').has('A2s')).toBe(true);
    expect(expandNotation('A2s+').has('AKs')).toBe(true);
    expect(expandNotation('A2s+').has('A2o')).toBe(false);
    expect(expandNotation('AKo, 72o').has('72o')).toBe(true);
  });

  it('gridIndex puts AA top-left, suited above diagonal', () => {
    expect(gridIndex('AA')).toEqual({ row: 0, col: 0 });
    expect(gridIndex('AKs')).toEqual({ row: 0, col: 1 });
    expect(gridIndex('AKo')).toEqual({ row: 1, col: 0 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && npx vitest run src/trainer/ranges.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `app/src/trainer/ranges.ts`**

```ts
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd app && npx vitest run src/trainer/ranges.test.ts`
Expected: PASS (all 6 tests). If `A2s+` expansion is off, confirm `rangeBetween(RANK_INDEX['2'], RANK_INDEX['A']+1)` yields 2..K (not A2s..AKs including AA). Adjust until the test passes.

- [ ] **Step 5: Commit**

```bash
git add app/src/trainer/ranges.ts app/src/trainer/ranges.test.ts
git commit -m "Trainer: hand-range utils (169 classes, combos, notation parser)"
```

---

## Task 4: Preflop sizing & context (`sizing.ts`)

**Files:**
- Create: `app/src/trainer/sizing.ts`
- Test: `app/src/trainer/sizing.test.ts`

This module produces the table context (pot, to-call, action history, stacks) and the legal action buttons (with concrete size labels) for a given category + positions. Sizing model (simple, documented):
- Blinds: SB 0.5bb, BB 1bb. Open size 2.5bb. 3-bet = 3× open in position, 4× out of position. 4-bet = 2.2× the 3-bet (rounded to 0.5bb).

- [ ] **Step 1: Write the failing test**

`app/src/trainer/sizing.test.ts`:
```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && npx vitest run src/trainer/sizing.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `app/src/trainer/sizing.ts`**

```ts
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd app && npx vitest run src/trainer/sizing.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/trainer/sizing.ts app/src/trainer/sizing.test.ts
git commit -m "Trainer: preflop sizing & spot-context model"
```

---

## Task 5: Vendor Greenline data + Cell→Strategy converter

**Files:**
- Create: `app/src/trainer/charts/source/poker-types.ts`
- Create: `app/src/trainer/charts/source/greenline.ts` (downloaded)
- Create: `app/src/trainer/charts/source/NOTICE.md`
- Create: `app/src/trainer/charts/convert.ts`
- Test: `app/src/trainer/charts/convert.test.ts`

- [ ] **Step 1: Create the vendored types `app/src/trainer/charts/source/poker-types.ts`**

```ts
// Minimal types to compile the vendored Greenline data module.
// Mirrors the public shape of AHTOOOXA/poker-charts (MIT).
export type SourceAction = 'raise' | 'call' | 'allin' | 'fold' | 'check';
export interface WeightedCell { weight: number; actions: Partial<Record<SourceAction, number>>; }
export type Cell = SourceAction | SourceAction[] | WeightedCell;
export type Chart = Record<string, Cell>;
```

- [ ] **Step 2: Download the Greenline data into the repo**

Run:
```bash
curl -fsSL https://raw.githubusercontent.com/AHTOOOXA/poker-charts/main/src/data/ranges/greenline.ts \
  -o app/src/trainer/charts/source/greenline.ts
```
Then **edit the top import** of that downloaded file so it points at our vendored types:
- Replace the first import line (e.g. `import type { Chart } from './index'`) with:
  ```ts
  import type { Chart } from './poker-types';
  ```
- Confirm the file still exports `export const charts: Record<string, Chart> = { ... }`.

Expected: file present, ~38KB, compiles against `poker-types.ts`.

- [ ] **Step 3: Create attribution `app/src/trainer/charts/source/NOTICE.md`**

```md
# Third-party data

`greenline.ts` is preflop range data adapted from **AHTOOOXA/poker-charts**
(https://github.com/AHTOOOXA/poker-charts), MIT License. Range values were
extracted by that project from public Greenline Poker study charts. Only the
data and a minimal type shim are vendored here; no source code is linked.
```

- [ ] **Step 4: Write the failing converter test**

`app/src/trainer/charts/convert.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { cellToStrategy } from './convert';

describe('cellToStrategy', () => {
  it('pure action string', () => {
    expect(cellToStrategy('raise')).toEqual({ raise: 1 });
    expect(cellToStrategy('fold')).toEqual({ fold: 1 });
    expect(cellToStrategy('allin')).toEqual({ allin: 1 });
  });
  it('equal split for arrays', () => {
    expect(cellToStrategy(['raise', 'fold'])).toEqual({ raise: 0.5, fold: 0.5 });
  });
  it('weighted cell: weight is in-range %, remainder folds', () => {
    // 60% in range, all of that raises => raise 0.6, fold 0.4
    expect(cellToStrategy({ weight: 60, actions: { raise: 100 } })).toEqual({ raise: 0.6, fold: 0.4 });
  });
  it('weighted cell with action split', () => {
    // 100% in range, raise 70 / call 30
    const s = cellToStrategy({ weight: 100, actions: { raise: 70, call: 30 } });
    expect(s.raise).toBeCloseTo(0.7);
    expect(s.call).toBeCloseTo(0.3);
    expect(s.fold ?? 0).toBeCloseTo(0);
  });
  it('frequencies always sum to ~1', () => {
    const s = cellToStrategy({ weight: 40, actions: { raise: 50, allin: 50 } });
    const sum = Object.values(s).reduce((a, b) => a + (b ?? 0), 0);
    expect(sum).toBeCloseTo(1);
  });
});
```

- [ ] **Step 5: Run to verify it fails**

Run: `cd app && npx vitest run src/trainer/charts/convert.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 6: Implement `app/src/trainer/charts/convert.ts`**

```ts
import type { Bucket, HandClass, Strategy } from '../types';
import type { Cell, SourceAction } from './source/poker-types';
import { expandNotation } from '../ranges';

const toBucket = (a: SourceAction): Bucket => a; // identity: raise/call/allin/fold/check

export function cellToStrategy(cell: Cell): Strategy {
  if (typeof cell === 'string') {
    return { [toBucket(cell)]: 1 };
  }
  if (Array.isArray(cell)) {
    const f = 1 / cell.length;
    const s: Strategy = {};
    for (const a of cell) s[toBucket(a)] = (s[toBucket(a)] ?? 0) + f;
    return s;
  }
  // WeightedCell: weight (0..100) is the in-range fraction; actions are % among in-range.
  const inRange = Math.max(0, Math.min(100, cell.weight)) / 100;
  const s: Strategy = {};
  let assigned = 0;
  const actionSum = Object.values(cell.actions).reduce((a, b) => a + (b ?? 0), 0) || 1;
  for (const [a, pct] of Object.entries(cell.actions)) {
    const freq = inRange * ((pct ?? 0) / actionSum);
    s[toBucket(a as SourceAction)] = (s[toBucket(a as SourceAction)] ?? 0) + freq;
    assigned += freq;
  }
  const fold = 1 - assigned;
  if (fold > 1e-9) s.fold = (s.fold ?? 0) + fold;
  return s;
}

/** Build a sparse-aware strategy lookup for a chart: unlisted hand => fold. */
export function chartCellStrategy(chart: Record<string, Cell> | undefined, hand: HandClass): Strategy {
  if (!chart) return { fold: 1 };
  const cell = chart[hand];
  if (cell === undefined) return { fold: 1 };
  return cellToStrategy(cell);
}

/** Convert a push/fold notation string into a per-hand strategy resolver. */
export function notationStrategy(jamNotation: string, hand: HandClass): Strategy {
  const jamSet = expandNotation(jamNotation);
  return jamSet.has(hand) ? { allin: 1 } : { fold: 1 };
}
```

- [ ] **Step 7: Run to verify it passes**

Run: `cd app && npx vitest run src/trainer/charts/convert.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 8: Commit**

```bash
git add app/src/trainer/charts/source app/src/trainer/charts/convert.ts app/src/trainer/charts/convert.test.ts
git commit -m "Trainer: vendor Greenline ranges (MIT) + cell->strategy converter"
```

---

## Task 6: Push/fold notation dataset

**Files:**
- Create: `app/src/trainer/charts/pushfold.ts`
- Test: `app/src/trainer/charts/pushfold.test.ts`

These are approximate Nash-style open-jam ranges (presented as "GTO-style", per spec §12), keyed `"<POS>-<depthBb>"`. Wider when shorter, tighter when deeper. Refine later against a published chart — this is data, not logic.

- [ ] **Step 1: Create `app/src/trainer/charts/pushfold.ts`**

```ts
// Approximate short-stack open-jam (push) ranges by position and effective stack (bb).
// "GTO-style" starter data — refine against a published Nash chart over time.
// Key: `${Position}-${depth}`. Value: standard range notation of hands to JAM; all else folds.
export const PUSH_FOLD_DEPTHS = [10, 15, 20, 25] as const;
export type PushFoldDepth = (typeof PUSH_FOLD_DEPTHS)[number];

export const pushFold: Record<string, string> = {
  // ---- 10bb (wide) ----
  'UTG-10': '44+, A7s+, A5s, KTs+, QTs+, JTs, ATo+, KJo+',
  'HJ-10':  '33+, A4s+, K9s+, QTs+, JTs, T9s, A9o+, KTo+, QJo',
  'CO-10':  '22+, A2s+, K8s+, Q9s+, J9s+, T9s, 98s, A7o+, K9o+, QTo+, JTo',
  'BTN-10': '22+, A2s+, K5s+, Q8s+, J8s+, T8s+, 97s+, 87s, 76s, A2o+, K8o+, Q9o+, J9o+, T9o',
  'SB-10':  '22+, A2s+, K4s+, Q7s+, J8s+, T8s+, 97s+, 86s+, 76s, A2o+, K7o+, Q9o+, J9o+, T9o',

  // ---- 15bb ----
  'UTG-15': '66+, A9s+, KTs+, QJs, AJo+',
  'HJ-15':  '55+, A7s+, KTs+, QTs+, JTs, ATo+, KQo',
  'CO-15':  '33+, A4s+, K9s+, QTs+, JTs, T9s, A9o+, KJo+, QJo',
  'BTN-15': '22+, A2s+, K7s+, Q9s+, J9s+, T9s, 98s, A7o+, K9o+, QTo+, JTo',
  'SB-15':  '22+, A2s+, K6s+, Q8s+, J8s+, T8s+, 98s, A5o+, K9o+, QTo+, JTo',

  // ---- 20bb ----
  'UTG-20': '77+, AJs+, KQs, AKo',
  'HJ-20':  '66+, ATs+, KJs+, AQo+',
  'CO-20':  '44+, A8s+, KTs+, QJs, AJo+, KQo',
  'BTN-20': '22+, A4s+, K9s+, QTs+, JTs, T9s, A9o+, KJo+, QJo',
  'SB-20':  '22+, A3s+, K8s+, Q9s+, J9s+, T9s, A8o+, KTo+, QJo',

  // ---- 25bb (tight) ----
  'UTG-25': '88+, AQs+, AKo',
  'HJ-25':  '77+, AJs+, KQs, AQo+',
  'CO-25':  '55+, ATs+, KJs+, AJo+',
  'BTN-25': '33+, A7s+, KTs+, QJs, ATo+, KQo',
  'SB-25':  '22+, A5s+, K9s+, QTs+, JTs, A9o+, KJo+',
};

export function pushFoldKey(pos: string, depth: number): string {
  return `${pos}-${depth}`;
}
```

- [ ] **Step 2: Write the test**

`app/src/trainer/charts/pushfold.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { pushFold, pushFoldKey, PUSH_FOLD_DEPTHS } from './pushfold';
import { expandNotation } from '../ranges';

describe('pushfold data', () => {
  it('has an entry for each authored position/depth and parses cleanly', () => {
    for (const key of Object.keys(pushFold)) {
      const set = expandNotation(pushFold[key]);
      expect(set.size).toBeGreaterThan(0);
      expect(set.has('AA')).toBe(true); // every jam range contains AA
    }
  });
  it('shorter stacks jam wider than deeper stacks (BTN)', () => {
    const wide = expandNotation(pushFold[pushFoldKey('BTN', 10)]).size;
    const tight = expandNotation(pushFold[pushFoldKey('BTN', 25)]).size;
    expect(wide).toBeGreaterThan(tight);
  });
  it('covers the four declared depths for BTN', () => {
    for (const d of PUSH_FOLD_DEPTHS) {
      expect(pushFold[pushFoldKey('BTN', d)]).toBeTruthy();
    }
  });
});
```

- [ ] **Step 3: Run to verify it passes**

Run: `cd app && npx vitest run src/trainer/charts/pushfold.test.ts`
Expected: PASS (3 tests). If `expandNotation` chokes on any token, fix the notation string (not the parser unless the parser is genuinely wrong).

- [ ] **Step 4: Commit**

```bash
git add app/src/trainer/charts/pushfold.ts app/src/trainer/charts/pushfold.test.ts
git commit -m "Trainer: push/fold open-jam starter ranges (10-25bb)"
```

---

## Task 7: Unified chart store (`charts/index.ts`)

**Files:**
- Create: `app/src/trainer/charts/index.ts`
- Test: `app/src/trainer/charts/index.test.ts`

- [ ] **Step 1: Write the failing test**

`app/src/trainer/charts/index.test.ts`:
```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && npx vitest run src/trainer/charts/index.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `app/src/trainer/charts/index.ts`**

```ts
import type { Category, HandClass, Position, Strategy } from '../types';
import { ALL_POSITIONS } from '../types';
import { charts as greenline } from './source/greenline';
import { chartCellStrategy, notationStrategy } from './convert';
import { pushFold, pushFoldKey, PUSH_FOLD_DEPTHS } from './pushfold';

export interface ScenarioRef {
  hero: Position;
  villain?: Position;
  depth?: number;
  source: string;
}

const SCENARIO_TOKEN: Record<Exclude<Category, 'push-fold'>, string> = {
  'rfi': 'RFI',
  'vs-open': 'vs-open',
  'vs-3bet': 'vs-3bet',
};

function parsePosition(s: string): Position | undefined {
  return (ALL_POSITIONS as string[]).includes(s) ? (s as Position) : undefined;
}

/** Greenline chart keys look like 'UTG-RFI' or 'SB-vs-open-BTN'. */
export function availableScenarios(category: Category): ScenarioRef[] {
  if (category === 'push-fold') {
    const out: ScenarioRef[] = [];
    for (const key of Object.keys(pushFold)) {
      const [pos, depthStr] = key.split('-');
      const hero = parsePosition(pos);
      const depth = Number(depthStr);
      if (hero && PUSH_FOLD_DEPTHS.includes(depth as any)) {
        out.push({ hero, depth, source: 'push/fold (GTO-style)' });
      }
    }
    return out;
  }

  const token = SCENARIO_TOKEN[category];
  const out: ScenarioRef[] = [];
  for (const key of Object.keys(greenline)) {
    // hero-RFI  OR  hero-vs-open-villain  OR  hero-vs-3bet-villain
    if (category === 'rfi') {
      const m = key.match(/^([A-Z]{2,3})-RFI$/);
      if (m) {
        const hero = parsePosition(m[1]);
        if (hero) out.push({ hero, source: 'Greenline (MIT)' });
      }
    } else {
      const m = key.match(new RegExp(`^([A-Z]{2,3})-${token}-([A-Z]{2,3})$`));
      if (m) {
        const hero = parsePosition(m[1]);
        const villain = parsePosition(m[2]);
        if (hero && villain) out.push({ hero, villain, source: 'Greenline (MIT)' });
      }
    }
  }
  return out;
}

export function getStrategy(
  category: Category,
  hero: Position,
  hand: HandClass,
  villain?: Position,
  depth?: number,
): Strategy {
  if (category === 'push-fold') {
    const notation = pushFold[pushFoldKey(hero, depth ?? 0)];
    if (!notation) return { fold: 1 };
    return notationStrategy(notation, hand);
  }
  const token = SCENARIO_TOKEN[category];
  const key = villain ? `${hero}-${token}-${villain}` : `${hero}-${token}`;
  return chartCellStrategy(greenline[key], hand);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd app && npx vitest run src/trainer/charts/index.test.ts`
Expected: PASS (5 tests). If `availableScenarios('vs-open')` is empty, inspect the actual Greenline key format with a quick console.log of `Object.keys(greenline).slice(0,20)` and adjust the regex/token to match (e.g. the data may use `vs-open` exactly as written, which the token expects).

- [ ] **Step 5: Commit**

```bash
git add app/src/trainer/charts/index.ts app/src/trainer/charts/index.test.ts
git commit -m "Trainer: unified chart store (scenario discovery + strategy lookup)"
```

---

## Task 8: Grader (`engine/grader.ts`)

**Files:**
- Create: `app/src/trainer/engine/grader.ts`
- Test: `app/src/trainer/engine/grader.test.ts`

- [ ] **Step 1: Write the failing test**

`app/src/trainer/engine/grader.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { grade, TIER_COLOR } from './grader';
import type { ActionOption } from '../types';

const FOLD: ActionOption = { kind: 'fold', label: 'Fold', bucket: 'fold', covers: ['fold'] };
const CALL: ActionOption = { kind: 'call', label: 'Call', bucket: 'call', covers: ['call'] };
const RAISE: ActionOption = { kind: 'raise', label: '3-bet', bucket: 'raise', covers: ['raise', 'allin'] };
const ACTIONS = [FOLD, CALL, RAISE];

describe('grader', () => {
  it('marks the top-frequency button as Best', () => {
    const r = grade(ACTIONS, { raise: 0.78, call: 0.22 }, 'raise');
    expect(r.tier).toBe('best');
    expect(r.color).toBe('positive');
    expect(r.bestBucket).toBe('raise');
  });
  it('a played-but-not-top button is Correct (neutral)', () => {
    const r = grade(ACTIONS, { raise: 0.78, call: 0.22 }, 'call');
    expect(r.tier).toBe('correct');
    expect(r.color).toBe('primary');
    expect(r.chosenFreq).toBeCloseTo(0.22);
  });
  it('a rarely-played button (<3.5%) is an Inaccuracy (red)', () => {
    const r = grade(ACTIONS, { raise: 0.97, call: 0.03 }, 'call');
    expect(r.tier).toBe('inaccuracy');
    expect(r.color).toBe('negative');
  });
  it('a never-played button is a Mistake (red)', () => {
    const r = grade(ACTIONS, { raise: 1 }, 'fold');
    expect(r.tier).toBe('mistake');
    expect(r.color).toBe('negative');
  });
  it('aggregates raw allin into the raise button', () => {
    const r = grade(ACTIONS, { raise: 0.5, allin: 0.5 }, 'raise');
    expect(r.chosenFreq).toBeCloseTo(1);
    expect(r.tier).toBe('best');
    expect(r.buttonFreq.raise).toBeCloseTo(1);
  });
  it('TIER_COLOR maps tiers to palette tokens', () => {
    expect(TIER_COLOR.best).toBe('positive');
    expect(TIER_COLOR.correct).toBe('primary');
    expect(TIER_COLOR.mistake).toBe('negative');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && npx vitest run src/trainer/engine/grader.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `app/src/trainer/engine/grader.ts`**

```ts
import type { ActionOption, Bucket, GradeResult, Strategy, Tier, TierColor } from '../types';

export const CORRECT_THRESHOLD = 0.035;

export const TIER_COLOR: Record<Tier, TierColor> = {
  best: 'positive',
  correct: 'primary',
  inaccuracy: 'negative',
  mistake: 'negative',
  blunder: 'negative',
};

/** Aggregate raw strategy into button space using each button's `covers`. */
export function aggregate(actions: ActionOption[], strategy: Strategy): Partial<Record<Bucket, number>> {
  const out: Partial<Record<Bucket, number>> = {};
  for (const a of actions) {
    out[a.bucket] = a.covers.reduce((sum, k) => sum + (strategy[k] ?? 0), 0);
  }
  return out;
}

export function grade(actions: ActionOption[], strategy: Strategy, chosen: Bucket): GradeResult {
  const buttonFreq = aggregate(actions, strategy);
  const entries = Object.entries(buttonFreq) as [Bucket, number][];
  const maxFreq = entries.reduce((m, [, f]) => Math.max(m, f), 0);
  const bestBucket = (entries.find(([, f]) => f === maxFreq)?.[0]) ?? chosen;
  const chosenFreq = buttonFreq[chosen] ?? 0;

  let tier: Tier;
  if (chosenFreq > 0 && chosenFreq === maxFreq) tier = 'best';
  else if (chosenFreq >= CORRECT_THRESHOLD) tier = 'correct';
  else if (chosenFreq > 0) tier = 'inaccuracy';
  else tier = 'mistake';

  return { tier, color: TIER_COLOR[tier], chosen, bestBucket, chosenFreq, buttonFreq };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd app && npx vitest run src/trainer/engine/grader.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/trainer/engine/grader.ts app/src/trainer/engine/grader.test.ts
git commit -m "Trainer: grader (forgiving tiers in button space)"
```

---

## Task 9: Spot generator (`engine/spotGenerator.ts`)

**Files:**
- Create: `app/src/trainer/engine/spotGenerator.ts`
- Test: `app/src/trainer/engine/spotGenerator.test.ts`

- [ ] **Step 1: Write the failing test**

`app/src/trainer/engine/spotGenerator.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { generateSpot } from './spotGenerator';
import { handClassOf } from '../ranges';

describe('spotGenerator', () => {
  const rng = () => 0.123; // deterministic

  it('builds a valid RFI spot', () => {
    const spot = generateSpot({ category: 'rfi' }, rng);
    expect(spot.category).toBe('rfi');
    expect(spot.villainPos).toBeUndefined();
    expect(spot.legalActions.map(a => a.kind)).toEqual(['fold', 'raise']);
    expect(spot.heroHand).toHaveLength(2);
    expect(spot.handClass).toBe(handClassOf(spot.heroHand[0], spot.heroHand[1]));
    const sum = Object.values(spot.strategy).reduce((a, b) => a + (b ?? 0), 0);
    expect(sum).toBeCloseTo(1);
  });

  it('builds a vs-open spot with a villain before the hero', () => {
    const spot = generateSpot({ category: 'vs-open' }, rng);
    expect(spot.villainPos).toBeDefined();
    expect(spot.legalActions.map(a => a.kind)).toEqual(['fold', 'call', 'raise']);
  });

  it('builds a push-fold spot with a depth and jam button', () => {
    const spot = generateSpot({ category: 'push-fold', depth: 15 }, rng);
    expect(spot.effStackBb).toBe(15);
    expect(spot.legalActions.some(a => a.kind === 'allin')).toBe(true);
  });

  it('every spot has a unique id', () => {
    const a = generateSpot({ category: 'rfi' }, () => 0.1);
    const b = generateSpot({ category: 'rfi' }, () => 0.9);
    expect(a.id).not.toBe(b.id);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && npx vitest run src/trainer/engine/spotGenerator.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `app/src/trainer/engine/spotGenerator.ts`**

```ts
import type { Category, Spot } from '../types';
import { randomCombo, handClassOf } from '../ranges';
import { buildContext } from '../sizing';
import { availableScenarios, getStrategy } from '../charts';

export interface GenerateOptions {
  category: Category;
  depth?: number;          // push-fold only; if omitted, sampled from available depths
}

let counter = 0;

function pick<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}

export function generateSpot(opts: GenerateOptions, rng: () => number = Math.random): Spot {
  let scenarios = availableScenarios(opts.category);
  if (opts.category === 'push-fold' && opts.depth) {
    scenarios = scenarios.filter(s => s.depth === opts.depth);
  }
  if (scenarios.length === 0) throw new Error(`No scenarios for category ${opts.category}`);
  const sc = pick(scenarios, rng);

  const effStack = opts.category === 'push-fold' ? (sc.depth ?? 15) : 100;
  const ctx = buildContext(opts.category, sc.hero, sc.villain, effStack);

  const [a, b] = randomCombo(rng);
  const handClass = handClassOf(a, b);
  const strategy = getStrategy(opts.category, sc.hero, handClass, sc.villain, sc.depth);

  return {
    id: `spot-${++counter}-${Math.floor(rng() * 1e6)}`,
    category: opts.category,
    format: opts.category === 'push-fold' ? 'MTT' : 'Cash 6-max',
    effStackBb: effStack,
    heroPos: sc.hero,
    villainPos: sc.villain,
    actionHistory: ctx.actionHistory,
    potBb: ctx.potBb,
    toCallBb: ctx.toCallBb,
    heroHand: [a, b],
    handClass,
    legalActions: ctx.legalActions,
    strategy,
    source: sc.source,
  };
}

export function randomCategory(rng: () => number, categories: Category[]): Category {
  return categories[Math.floor(rng() * categories.length) % categories.length];
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd app && npx vitest run src/trainer/engine/spotGenerator.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/trainer/engine/spotGenerator.ts app/src/trainer/engine/spotGenerator.test.ts
git commit -m "Trainer: spot generator (sample scenario + combo, build Spot)"
```

---

## Task 10: Stats (`stats.ts`)

**Files:**
- Create: `app/src/trainer/stats.ts`
- Test: `app/src/trainer/stats.test.ts`

- [ ] **Step 1: Write the failing test**

`app/src/trainer/stats.test.ts`:
```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && npx vitest run src/trainer/stats.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `app/src/trainer/stats.ts`**

```ts
import type { Category, Tier, TrainerStats } from './types';

export const TRAINER_STATS_KEY = 'poker-tracker-trainer-stats';

export function applyResult(prev: TrainerStats, category: Category, tier: Tier, isoDate: string): TrainerStats {
  const isCorrect = tier === 'best' || tier === 'correct';
  const cat = prev.byCategory[category];
  const updatedCat = {
    answered: cat.answered + 1,
    best: cat.best + (tier === 'best' ? 1 : 0),
    correct: cat.correct + (tier === 'correct' ? 1 : 0),
    inaccuracy: cat.inaccuracy + (tier === 'inaccuracy' ? 1 : 0),
    mistake: cat.mistake + (tier === 'mistake' || tier === 'blunder' ? 1 : 0),
  };
  const currentStreak = isCorrect ? prev.currentStreak + 1 : 0;
  return {
    totalAnswered: prev.totalAnswered + 1,
    totalCorrect: prev.totalCorrect + (isCorrect ? 1 : 0),
    currentStreak,
    bestStreak: Math.max(prev.bestStreak, currentStreak),
    byCategory: { ...prev.byCategory, [category]: updatedCat },
    lastPlayed: isoDate,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd app && npx vitest run src/trainer/stats.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/trainer/stats.ts app/src/trainer/stats.test.ts
git commit -m "Trainer: localStorage-backed stats (applyResult)"
```

---

## Task 11: `ActionButtons` component

**Files:**
- Create: `app/src/components/trainer/ActionButtons.tsx`
- Test: `app/src/components/trainer/ActionButtons.test.tsx`

- [ ] **Step 1: Write the failing test**

`app/src/components/trainer/ActionButtons.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ActionButtons } from './ActionButtons';
import type { ActionOption } from '../../trainer/types';

const ACTIONS: ActionOption[] = [
  { kind: 'fold', label: 'Fold', bucket: 'fold', covers: ['fold'] },
  { kind: 'call', label: 'Call 2.5bb', bucket: 'call', covers: ['call'] },
  { kind: 'raise', label: '3-bet to 7.5bb', bucket: 'raise', covers: ['raise', 'allin'] },
];

describe('ActionButtons', () => {
  it('renders one button per legal action with its concrete label', () => {
    render(<ActionButtons actions={ACTIONS} disabled={false} onChoose={() => {}} />);
    expect(screen.getByRole('button', { name: /Fold/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /3-bet to 7.5bb/ })).toBeInTheDocument();
  });

  it('calls onChoose with the chosen bucket', async () => {
    const onChoose = vi.fn();
    render(<ActionButtons actions={ACTIONS} disabled={false} onChoose={onChoose} />);
    await userEvent.click(screen.getByRole('button', { name: /3-bet to 7.5bb/ }));
    expect(onChoose).toHaveBeenCalledWith('raise');
  });

  it('disables buttons when disabled', () => {
    render(<ActionButtons actions={ACTIONS} disabled onChoose={() => {}} />);
    expect(screen.getByRole('button', { name: /Fold/ })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && npx vitest run src/components/trainer/ActionButtons.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `app/src/components/trainer/ActionButtons.tsx`**

```tsx
import type { ActionOption, Bucket } from '../../trainer/types';

interface Props {
  actions: ActionOption[];
  disabled: boolean;
  onChoose: (bucket: Bucket) => void;
  chosen?: Bucket;
}

export function ActionButtons({ actions, disabled, onChoose, chosen }: Props) {
  return (
    <div className="flex gap-2 mt-4">
      {actions.map((a) => {
        const isFold = a.kind === 'fold';
        const isChosen = chosen === a.bucket;
        return (
          <button
            key={a.bucket}
            disabled={disabled}
            onClick={() => onChoose(a.bucket)}
            className={[
              'flex-1 rounded-xl px-2 py-3 font-semibold text-sm border transition-colors disabled:opacity-60',
              isChosen ? 'ring-2 ring-text-primary' : '',
              isFold
                ? 'text-accent-negative border-accent-negative/40 bg-surface-secondary'
                : 'text-text-primary border-accent-primary-light bg-surface-secondary hover:border-accent-primary',
            ].join(' ')}
          >
            {a.label}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd app && npx vitest run src/components/trainer/ActionButtons.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/components/trainer/ActionButtons.tsx app/src/components/trainer/ActionButtons.test.tsx
git commit -m "Trainer: ActionButtons component"
```

---

## Task 12: `RangeGrid` component

**Files:**
- Create: `app/src/components/trainer/RangeGrid.tsx`
- Test: `app/src/components/trainer/RangeGrid.test.tsx`

- [ ] **Step 1: Write the failing test**

`app/src/components/trainer/RangeGrid.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { RangeGrid } from './RangeGrid';

describe('RangeGrid', () => {
  it('renders 169 cells and highlights the hero hand', () => {
    const { container } = render(
      <RangeGrid category="rfi" hero="UTG" highlight="AA" />
    );
    const cells = container.querySelectorAll('[data-hand]');
    expect(cells.length).toBe(169);
    const hero = container.querySelector('[data-hand="AA"]');
    expect(hero?.getAttribute('data-hero')).toBe('true');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && npx vitest run src/components/trainer/RangeGrid.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `app/src/components/trainer/RangeGrid.tsx`**

```tsx
import type { Category, HandClass, Position } from '../../trainer/types';
import { allHandClasses } from '../../trainer/ranges';
import { getStrategy } from '../../trainer/charts';

interface Props {
  category: Category;
  hero: Position;
  villain?: Position;
  depth?: number;
  highlight: HandClass;
}

/** Action color, separate from the green/red grading palette. */
function cellColor(strat: ReturnType<typeof getStrategy>): string {
  const raise = (strat.raise ?? 0) + (strat.allin ?? 0);
  const call = strat.call ?? 0;
  const fold = strat.fold ?? 0;
  if (fold >= 0.999) return 'bg-bg-tertiary text-text-tertiary';      // fold
  if (raise > 0 && call > 0) return 'bg-accent-primary/70 text-text-inverse'; // mixed
  if (raise >= call) return 'bg-accent-primary text-text-inverse';    // raise
  return 'bg-[#9aa77f] text-text-inverse';                            // call (muted olive)
}

export function RangeGrid({ category, hero, villain, depth, highlight }: Props) {
  const hands = allHandClasses();
  return (
    <div className="grid grid-cols-13 gap-[2px] max-w-[560px]">
      {hands.map((hc) => {
        const strat = getStrategy(category, hero, hc, villain, depth);
        const isHero = hc === highlight;
        return (
          <div
            key={hc}
            data-hand={hc}
            data-hero={isHero ? 'true' : 'false'}
            title={hc}
            className={[
              'aspect-square rounded-[3px] text-[9px] font-bold flex items-center justify-center',
              cellColor(strat),
              isHero ? 'outline outline-2 outline-text-primary z-10' : '',
            ].join(' ')}
          >
            {hc}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Add the 13-column grid utility to Tailwind**

In `app/tailwind.config.js`, extend the theme:
```js
// inside theme.extend
gridTemplateColumns: {
  '13': 'repeat(13, minmax(0, 1fr))',
},
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd app && npx vitest run src/components/trainer/RangeGrid.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 6: Commit**

```bash
git add app/src/components/trainer/RangeGrid.tsx app/src/components/trainer/RangeGrid.test.tsx app/tailwind.config.js
git commit -m "Trainer: RangeGrid (13x13 action-colored chart with hero highlight)"
```

---

## Task 13: `PokerTable` + `ActionHistoryStrip` components (render smoke)

**Files:**
- Create: `app/src/components/trainer/ActionHistoryStrip.tsx`
- Create: `app/src/components/trainer/PokerTable.tsx`
- Test: `app/src/components/trainer/PokerTable.test.tsx`

- [ ] **Step 1: Write the failing test**

`app/src/components/trainer/PokerTable.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PokerTable } from './PokerTable';
import { ActionHistoryStrip } from './ActionHistoryStrip';
import { generateSpot } from '../../trainer/engine/spotGenerator';

describe('PokerTable + strip', () => {
  it('renders the pot, hero seat, and the action strip', () => {
    const spot = generateSpot({ category: 'vs-open' }, () => 0.3);
    render(<div><PokerTable spot={spot} /><ActionHistoryStrip spot={spot} /></div>);
    expect(screen.getByText(/Pot/i)).toBeInTheDocument();
    expect(screen.getAllByText('YOU').length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && npx vitest run src/components/trainer/PokerTable.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `app/src/components/trainer/ActionHistoryStrip.tsx`**

```tsx
import type { Spot } from '../../trainer/types';

export function ActionHistoryStrip({ spot }: { spot: Spot }) {
  return (
    <div className="mt-2">
      <div className="text-[10px] uppercase tracking-wide text-text-tertiary mb-1.5">Action this street (preflop)</div>
      <div className="flex gap-1.5">
        {spot.actionHistory.map((h) => {
          const base = 'flex-1 rounded-lg py-1.5 text-center border';
          const style =
            h.state === 'hero' ? 'bg-text-primary text-text-inverse border-text-primary'
            : h.state === 'acted' ? 'bg-[#EFE6D7] border-[#caa877] text-[#6E5638] font-bold'
            : h.state === 'pending' ? 'bg-surface-secondary border-bg-tertiary border-dashed text-text-tertiary italic'
            : 'bg-surface-secondary border-bg-tertiary text-text-tertiary opacity-40';
          return (
            <div key={h.pos} className={`${base} ${style}`}>
              <div className="text-[11px] font-bold">{h.pos}</div>
              <div className="text-[11px] mt-0.5">{h.label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Implement `app/src/components/trainer/PokerTable.tsx`**

Seats are placed around a wide racetrack felt (matches the approved mockup). Hero hand shown at the bottom; aggressor highlighted; pot centered.

```tsx
import type { Card, Position, Spot } from '../../trainer/types';
import { ALL_POSITIONS } from '../../trainer/types';

const SEAT_POS: Record<Position, { top: string; left: string }> = {
  UTG: { top: '13%', left: '25%' },
  HJ:  { top: '13%', left: '50%' },
  CO:  { top: '30%', left: '84%' },
  BTN: { top: '84%', left: '62%' },
  SB:  { top: '84%', left: '38%' },
  BB:  { top: '30%', left: '16%' },
};

function CardView({ card }: { card: Card }) {
  const red = card.suit === 'h' || card.suit === 'd';
  const suit = { s: '♠', h: '♥', d: '♦', c: '♣' }[card.suit];
  return (
    <div className="flex flex-col items-center justify-center w-[52px] h-[72px] rounded-lg bg-white border border-[#E0D9CD] shadow font-extrabold text-2xl leading-none"
         style={{ color: red ? '#B85450' : '#2D2A26' }}>
      <span>{card.rank}</span>
      <small className="text-[13px] mt-0.5">{suit}</small>
    </div>
  );
}

export function PokerTable({ spot }: { spot: Spot }) {
  return (
    <div className="relative mx-auto my-4" style={{ height: 340 }}>
      <div className="absolute inset-0 border-[8px] border-[#2F4638]"
           style={{ borderRadius: 170, background: 'radial-gradient(ellipse at 50% 42%, #496b55 0%, #3E5C4A 60%, #355140 100%)', boxShadow: 'inset 0 0 60px rgba(0,0,0,.28)' }} />
      {ALL_POSITIONS.map((pos) => {
        const p = SEAT_POS[pos];
        const isHero = pos === spot.heroPos;
        const isAggr = pos === spot.villainPos;
        const folded = !isHero && !isAggr;
        return (
          <div key={pos} className="absolute -translate-x-1/2 -translate-y-1/2 text-center w-24" style={{ top: p.top, left: p.left }}>
            <div className={[
              'rounded-lg py-1.5 text-xs font-bold border',
              isHero ? 'bg-white text-text-primary border-white'
              : isAggr ? 'bg-[#6E5638] text-white border-[#caa877]'
              : 'bg-white/10 text-[#EDEAE3] border-white/20',
              folded ? 'opacity-40' : '',
            ].join(' ')}>
              {isHero ? `${pos} · YOU` : pos}
            </div>
            <div className="text-[10px] mt-0.5" style={{ color: '#cdbfa6' }}>{spot.effStackBb}bb</div>
          </div>
        );
      })}
      <div className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 text-center" style={{ top: '42%' }}>
        <div className="text-[10px] uppercase tracking-wider" style={{ color: '#cdbfa6' }}>Pot</div>
        <div className="text-xl font-extrabold text-white">{spot.potBb}bb</div>
      </div>
      <div className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 flex gap-2" style={{ top: '88%' }}>
        <CardView card={spot.heroHand[0]} />
        <CardView card={spot.heroHand[1]} />
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd app && npx vitest run src/components/trainer/PokerTable.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 6: Commit**

```bash
git add app/src/components/trainer/PokerTable.tsx app/src/components/trainer/ActionHistoryStrip.tsx app/src/components/trainer/PokerTable.test.tsx
git commit -m "Trainer: PokerTable + ActionHistoryStrip components"
```

---

## Task 14: `FeedbackPanel` component

**Files:**
- Create: `app/src/components/trainer/FeedbackPanel.tsx`
- Test: `app/src/components/trainer/FeedbackPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

`app/src/components/trainer/FeedbackPanel.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FeedbackPanel } from './FeedbackPanel';
import { generateSpot } from '../../trainer/engine/spotGenerator';
import { grade } from '../../trainer/engine/grader';

function setup(chosen: 'fold' | 'call' | 'raise') {
  const spot = generateSpot({ category: 'vs-open' }, () => 0.2);
  const result = grade(spot.legalActions, spot.strategy, chosen);
  return { spot, result };
}

describe('FeedbackPanel', () => {
  it('shows the tier verdict and a Next button', () => {
    const { spot, result } = setup('raise');
    render(<FeedbackPanel spot={spot} result={result} onNext={() => {}} stats={{ accuracyPct: 80, streak: 4 }} />);
    expect(screen.getByText(/Best|Correct|Inaccuracy|Mistake/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Next/i })).toBeInTheDocument();
  });

  it('range chart is collapsed until toggled', async () => {
    const { spot, result } = setup('call');
    const { container } = render(<FeedbackPanel spot={spot} result={result} onNext={() => {}} stats={{ accuracyPct: 50, streak: 0 }} />);
    expect(container.querySelectorAll('[data-hand]').length).toBe(0);
    await userEvent.click(screen.getByRole('button', { name: /Show full range/i }));
    expect(container.querySelectorAll('[data-hand]').length).toBe(169);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && npx vitest run src/components/trainer/FeedbackPanel.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `app/src/components/trainer/FeedbackPanel.tsx`**

```tsx
import { useState } from 'react';
import type { Bucket, GradeResult, Spot } from '../../trainer/types';
import { RangeGrid } from './RangeGrid';

const TIER_LABEL: Record<GradeResult['tier'], string> = {
  best: 'Best ★', correct: 'Correct ✓', inaccuracy: 'Inaccuracy', mistake: 'Mistake', blunder: 'Blunder',
};
const COLOR_CLASS: Record<GradeResult['color'], string> = {
  positive: 'text-accent-positive', primary: 'text-accent-primary', negative: 'text-accent-negative',
};
const BAR_BG: Record<'best' | 'correct' | 'bad', string> = {
  best: 'bg-accent-positive', correct: 'bg-accent-primary', bad: 'bg-accent-negative',
};

function labelFor(spot: Spot, bucket: Bucket): string {
  return spot.legalActions.find((a) => a.bucket === bucket)?.label ?? bucket;
}

interface Props {
  spot: Spot;
  result: GradeResult;
  onNext: () => void;
  stats: { accuracyPct: number; streak: number };
}

export function FeedbackPanel({ spot, result, onNext, stats }: Props) {
  const [showRange, setShowRange] = useState(false);

  // button-space distribution, sorted high→low, classified for the traffic-light bars
  const rows = Object.entries(result.buttonFreq)
    .map(([bucket, freq]) => ({ bucket: bucket as Bucket, freq: freq ?? 0 }))
    .filter((r) => spot.legalActions.some((a) => a.bucket === r.bucket))
    .sort((a, b) => b.freq - a.freq);
  const top = rows[0]?.freq ?? 0;

  return (
    <div className="card mt-4">
      <div className={`text-xl font-extrabold ${COLOR_CLASS[result.color]}`}>{TIER_LABEL[result.tier]}</div>
      <div className="text-sm text-text-secondary mt-1">
        You played <b>{labelFor(spot, result.chosen)}</b> — GTO takes it{' '}
        {(result.chosenFreq * 100).toFixed(0)}% here. Top line: <b>{labelFor(spot, result.bestBucket)}</b>.
      </div>

      <div className="text-[12px] uppercase tracking-wide text-text-tertiary mt-4 mb-2">GTO strategy for {spot.handClass}</div>
      <div className="space-y-1.5">
        {rows.map((r) => {
          const cls = r.freq === top && r.freq > 0 ? 'best' : r.freq >= 0.035 ? 'correct' : 'bad';
          const isChosen = r.bucket === result.chosen;
          return (
            <div key={r.bucket} className="flex items-center gap-2">
              <div className={`w-28 text-sm ${isChosen ? 'font-bold underline' : ''}`}>{labelFor(spot, r.bucket)}</div>
              <div className="flex-1 h-5 rounded bg-bg-tertiary overflow-hidden">
                <div className={`h-full ${BAR_BG[cls]}`} style={{ width: `${Math.max(2, r.freq * 100)}%` }} />
              </div>
              <div className="w-12 text-right text-sm tabular-nums">{(r.freq * 100).toFixed(0)}%</div>
            </div>
          );
        })}
      </div>

      <div className="text-xs text-text-secondary mt-3 bg-surface-secondary border border-bg-tertiary rounded-lg p-2">
        Graded by frequency (the free preflop charts don't carry EV). Per-hand EV-loss arrives with the postflop phase.
      </div>

      <button onClick={() => setShowRange((v) => !v)} className="text-sm text-accent-primary mt-3 hover:underline">
        {showRange ? 'Hide full range ▴' : 'Show full range ▾'}
      </button>
      {showRange && (
        <div className="mt-2">
          <RangeGrid category={spot.category} hero={spot.heroPos} villain={spot.villainPos}
                     depth={spot.category === 'push-fold' ? spot.effStackBb : undefined} highlight={spot.handClass} />
        </div>
      )}

      <div className="flex items-center justify-between mt-4 pt-3 border-t border-bg-tertiary">
        <div className="text-sm text-text-secondary">
          Session: <b className="text-text-primary">{stats.accuracyPct}%</b> · streak <b className="text-text-primary">{stats.streak}</b>
        </div>
        <button onClick={onNext} className="btn-primary">Next spot ▸</button>
      </div>
    </div>
  );
}
```

> Note: `btn-primary`/`card` classes come from `app/src/index.css`. If `btn-primary` does not exist there, use the same Tailwind classes the app's other primary buttons use (check `index.css`); do not invent a new style.

- [ ] **Step 4: Run to verify it passes**

Run: `cd app && npx vitest run src/components/trainer/FeedbackPanel.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/components/trainer/FeedbackPanel.tsx app/src/components/trainer/FeedbackPanel.test.tsx
git commit -m "Trainer: FeedbackPanel (verdict, frequency bars, collapsible range)"
```

---

## Task 15: `Trainer` page + routing + Home entry

**Files:**
- Create: `app/src/pages/Trainer.tsx`
- Modify: `app/src/App.tsx` (add route above the catch-all at line 29)
- Modify: `app/src/pages/Home.tsx` (add 🎯 button in the header button row, lines 53-76)

- [ ] **Step 1: Implement `app/src/pages/Trainer.tsx`**

```tsx
import { useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Bucket, Category, GradeResult, Spot } from '../trainer/types';
import { CATEGORIES, emptyStats } from '../trainer/types';
import { useLocalStorage } from '../hooks/useStorage';
import { generateSpot, randomCategory } from '../trainer/engine/spotGenerator';
import { grade } from '../trainer/engine/grader';
import { applyResult, TRAINER_STATS_KEY } from '../trainer/stats';
import { PUSH_FOLD_DEPTHS, type PushFoldDepth } from '../trainer/charts/pushfold';
import { PokerTable } from '../components/trainer/PokerTable';
import { ActionHistoryStrip } from '../components/trainer/ActionHistoryStrip';
import { ActionButtons } from '../components/trainer/ActionButtons';
import { FeedbackPanel } from '../components/trainer/FeedbackPanel';

const CATEGORY_LABEL: Record<Category, string> = {
  'rfi': 'RFI', 'vs-open': 'Facing open', 'vs-3bet': 'Facing 3-bet', 'push-fold': 'Push/fold',
};

type CatFilter = Category | 'mixed';

function makeSpot(filter: CatFilter, depth: PushFoldDepth | 'mixed'): Spot {
  const category = filter === 'mixed' ? randomCategory(Math.random, CATEGORIES) : filter;
  const d = category === 'push-fold'
    ? (depth === 'mixed' ? PUSH_FOLD_DEPTHS[Math.floor(Math.random() * PUSH_FOLD_DEPTHS.length)] : depth)
    : undefined;
  return generateSpot({ category, depth: d });
}

export function Trainer() {
  const navigate = useNavigate();
  const [stats, setStats] = useLocalStorage(TRAINER_STATS_KEY, emptyStats());
  const [filter, setFilter] = useState<CatFilter>('mixed');
  const [depth, setDepth] = useState<PushFoldDepth | 'mixed'>('mixed');
  const [spot, setSpot] = useState<Spot>(() => makeSpot('mixed', 'mixed'));
  const [result, setResult] = useState<GradeResult | null>(null);

  const next = useCallback(() => {
    setResult(null);
    setSpot(makeSpot(filter, depth));
  }, [filter, depth]);

  const choose = useCallback((bucket: Bucket) => {
    if (result) return;
    const r = grade(spot.legalActions, spot.strategy, bucket);
    setResult(r);
    setStats((prev) => applyResult(prev, spot.category, r.tier, new Date().toISOString().slice(0, 10)));
  }, [result, spot, setStats]);

  const accuracyPct = stats.totalAnswered ? Math.round((stats.totalCorrect / stats.totalAnswered) * 100) : 0;

  const showDepthRow = filter === 'push-fold';
  const chips = useMemo(() => (['mixed', ...CATEGORIES] as CatFilter[]), []);

  return (
    <div className="min-h-full bg-bg-primary">
      <header className="sticky top-0 bg-bg-primary/95 backdrop-blur-sm border-b border-bg-tertiary z-10">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-text-primary">🎯 GTO Trainer</h1>
          <button onClick={() => navigate('/')} className="p-2 rounded-full hover:bg-bg-tertiary" title="Home">🏠</button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 pb-24">
        {/* category chips */}
        <div className="flex gap-2 flex-wrap mb-2">
          {chips.map((c) => (
            <button key={c}
              onClick={() => { setFilter(c); setResult(null); setSpot(makeSpot(c, depth)); }}
              className={`px-3 py-1.5 rounded-full text-sm border ${filter === c ? 'bg-text-primary text-text-inverse border-text-primary' : 'bg-surface-secondary border-accent-primary-light text-text-secondary'}`}>
              {c === 'mixed' ? 'Mixed' : CATEGORY_LABEL[c as Category]}
            </button>
          ))}
        </div>

        {/* depth chips (push/fold only) */}
        {showDepthRow && (
          <div className="flex gap-2 flex-wrap mb-4">
            {(['mixed', ...PUSH_FOLD_DEPTHS] as (PushFoldDepth | 'mixed')[]).map((d) => (
              <button key={d}
                onClick={() => { setDepth(d); setResult(null); setSpot(makeSpot('push-fold', d)); }}
                className={`px-3 py-1 rounded-full text-xs border ${depth === d ? 'bg-accent-primary text-text-inverse border-accent-primary' : 'bg-surface-secondary border-accent-primary-light text-text-secondary'}`}>
                {d === 'mixed' ? 'Mixed' : `${d}bb`}
              </button>
            ))}
          </div>
        )}

        <div className="card">
          <div className="text-[11px] uppercase tracking-wide text-text-tertiary">
            {spot.format} · {spot.effStackBb}bb · Hero: {spot.heroPos}
          </div>
          <ActionHistoryStrip spot={spot} />
          <PokerTable spot={spot} />
          {!result && <ActionButtons actions={spot.legalActions} disabled={false} onChoose={choose} />}
        </div>

        {result && (
          <FeedbackPanel spot={spot} result={result} onNext={next}
            stats={{ accuracyPct, streak: stats.currentStreak }} />
        )}
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Add the route in `app/src/App.tsx`**

Add the import near the other page imports:
```tsx
import { Trainer } from './pages/Trainer';
```
Add the route **above** the catch-all (`<Route path="*" ... />`) at `app/src/App.tsx:29`:
```tsx
<Route path="/trainer" element={<Trainer />} />
```

- [ ] **Step 3: Add the Home header button in `app/src/pages/Home.tsx`**

Inside the header button row (`<div className="flex items-center gap-2">`, around line 53), add as the first button:
```tsx
<button
  onClick={() => navigate('/trainer')}
  className="p-2 rounded-full hover:bg-bg-tertiary transition-colors"
  title="GTO Trainer"
>
  🎯
</button>
```

- [ ] **Step 4: Verify build + full test suite**

Run: `cd app && npm run build && npx vitest run`
Expected: build succeeds; all tests pass.

- [ ] **Step 5: Manual verification (the real proof)**

Run: `cd app && npm run dev`, open the app, click 🎯 in the Home header. Verify:
- A spot renders (table + action strip + legal buttons with concrete labels).
- Clicking an action shows the feedback panel with the right tier color (green/neutral/red).
- "Show full range ▾" expands the 13×13 chart with the hero hand outlined.
- "Next spot" loads a new spot; category and (for push/fold) depth chips change the spots.
- Reload the page → stats (accuracy/streak) persist.
- Cycle each category (RFI, Facing open, Facing 3-bet, Push/fold) and confirm sane buttons + grading.

- [ ] **Step 6: Commit**

```bash
git add app/src/pages/Trainer.tsx app/src/App.tsx app/src/pages/Home.tsx
git commit -m "Trainer: page, /trainer route, and Home header entry"
```

---

## Task 16: Final verification & polish

**Files:** (none new — verification + any small fixes surfaced)

- [ ] **Step 1: Lint**

Run: `cd app && npm run lint`
Expected: no errors. Fix any (unused imports, `any` lint rules — prefer real types over `any`).

- [ ] **Step 2: Type-check + build**

Run: `cd app && npm run build`
Expected: clean.

- [ ] **Step 3: Full test suite**

Run: `cd app && npx vitest run`
Expected: all green. Note the count (should be ~ 8 test files).

- [ ] **Step 4: Spec acceptance pass**

Re-read `docs/superpowers/specs/2026-06-27-gto-trainer-design.md` §13 and confirm each success-criterion checkbox is satisfied by the running app. Fix gaps.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "Trainer: lint/build/test polish"
```

- [ ] **Step 6: Finish the branch**

Use the **superpowers:finishing-a-development-branch** skill to decide merge vs PR. Do not merge to `main` without the user's go-ahead (per their commit rule).

---

## Notes for the implementer

- **Don't run a solver, ever.** All answers are bundled lookups.
- **Grade in button space** (`covers`) so on-screen buttons stay fixed per category and never leak the answer.
- **If Greenline key formats differ** from the regexes in Task 7, log `Object.keys(greenline).slice(0,30)` and adapt — the data is the source of truth.
- **Push/fold ranges are starter data** ("GTO-style"); they're data, not logic — refine later without touching code.
- **Phase 2 (postflop)** is out of scope here; the `Bucket`/`covers` design and the `Strategy` contract are what let it slot in later.
```
