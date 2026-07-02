# GTO Trainer — Design Spec

**Date:** 2026-06-27
**Status:** Draft for review
**Author:** Brainstormed with Claude

---

## 1. Overview & Goal

Add a **GTO Trainer** feature to the Tribe Poker Tracker: a drill where the player is dropped into a poker **spot**, picks an action from a small set of buttons, and is graded against game-theory-optimal (GTO) play with instant feedback.

**Primary goal:** A genuinely educational, fast-to-use preflop trainer that ships on the existing hobby VPS with no new infrastructure, built so the same spot/grading engine extends to postflop later.

**Success in one sentence:** A new `/trainer` page where you can repeatedly answer realistic preflop spots, get color-coded GTO feedback (with the full strategy + range chart), and watch your accuracy/streak persist on your device.

---

## 2. Scope

### Phase 1 — Preflop trainer (this spec, the MVP)
Four spot categories, all using free/bundled chart data, **no solver, no backend changes**:

1. **RFI** (raise-first-in) — first to act, open or fold, all 6 positions, 100bb.
2. **Facing an open** — someone raised before you: fold / call / 3-bet.
3. **Facing a 3-bet** — you opened and got 3-bet: fold / call / 4-bet.
4. **Short-stack push/fold** — jam all-in or fold, across a **range of depths (10 / 15 / 20 / 25bb)** so users practice shallow vs deeper short stacks (separate Nash data).

> **Amendment (2026-07-02):** push/fold depths shipped as **5 / 10 / 15 / 20bb**. The real Nash source (`a1r93/push-or-fold`, MIT — digitized Jennifear MTT chart, §6) covers 1–20bb only; no published open-jam data exists at 25bb (open-jamming 25bb is not a realistic strategy). The hand-authored starter ranges were replaced with a verified conversion of that source.

**Deep vs shallow:** the cash categories (1–3) are **100bb** (deep) because that's what the free charts provide; category 4 supplies the **shallow** practice. Intermediate cash depths (e.g. 40/60bb) are an accepted v1 limitation — they'd need extra chart data and are deferred (§12).

### Phase 2 — Postflop trainer (designed-for, not built now)
The Check / Bet / Bet / Fold experience with real bet sizes, fed by **offline-precomputed** solver output (TexasSolver) bundled as JSON. Outlined in §11 so Phase 1 doesn't paint us into a corner.

### Explicit non-goals (YAGNI)
- No live or in-browser solving — **ever** in the request path (hard constraint, see §10/Risks).
- No user accounts, login, or server-side leaderboard (app has no auth).
- No RNG/mixing "trainer die" mode, spaced-repetition, or ELO in v1.
- No per-hand EV-loss numbers preflop (the free charts don't carry EV; see §7).
- No postflop spots in Phase 1.

---

## 3. Key Product Decisions (brainstorm outcomes)

| Decision | Choice |
|---|---|
| Scope | Preflop first (all 4 categories), postflop as Phase 2; engine designed for both |
| Grading | **Forgiving categories** (Best / Correct / Inaccuracy / Mistake / Blunder), ~3.5% frequency threshold |
| Truth metric (preflop) | **Frequency** (what the free charts provide); EV-loss arrives with Phase 2 |
| Spot layout | **Poker-table view + action-history strip** above the table |
| Feedback colors | **Traffic light by grading tier:** green = Best, neutral tan = Correct, red = Inaccuracy/Mistake/Blunder |
| Range chart in feedback | **Collapsed** by default behind a "Show full range ▾" toggle |
| Progress tracking | **Per-device via `localStorage`** (no login), reusing the app's `useLocalStorage` hook |
| Architecture (MVP) | **Fully client-side** — bundled chart data, no backend/API changes |
| Action button labels | **Concrete action + size** (e.g. "3-bet to 7.5bb", "Jam 15bb", postflop "Bet 7bb (75% pot)") — never the words "bet small/big". Internal grading still uses small/big buckets. |
| Category selector | **In-page chips** on the Trainer page |
| Push/fold stack depths | **A range** (10 / 15 / 20 / 25bb), selectable + Mixed, for shallow→deeper practice |

---

## 4. Action Buttons — labels & preflop button sets (confirmed)

The original concept named 4 buttons "Check / Bet small / Bet big / Fold". That generic small/big naming is **dropped from the UI**. Two confirmed rules:

**(a) Buttons are labeled with the concrete action + size**, taken from the spot data — never "bet small/big":

| Category | Buttons (example sizes; actual sizes come from the chart data) |
|---|---|
| RFI | `Fold` · `Open to 2.5bb` |
| Facing an open | `Fold` · `Call 2.5bb` · `3-bet to 7.5bb` |
| Facing a 3-bet | `Fold` · `Call` · `4-bet to 21bb` |
| Push/fold | `Fold` · `Jam 15bb` (all-in at the current depth) |
| Postflop (Phase 2) | `Check` · `Bet 3bb (33% pot)` · `Bet 7bb (75% pot)` · `Fold` |

**(b) Preflop uses a single raise size per node** (the free charts encode one open size, one 3-bet size, one 4-bet size), so preflop shows the **legal 2–3 buttons** above — not a forced two-size split. The small-vs-big *bucket* is retained **internally** for grading/coloring; the player only ever sees the concrete label.

**The action-button component renders any subset of `{Fold, Check, Call, Raise, All-in}` with a `bucket` tag** (`fold|check|call|small|big`) used for grading. The same component serves preflop (2–3 buttons) and the Phase-2 postflop set (4 buttons) with no rework — postflop just supplies two raise options with different sizes/buckets.

---

## 5. The Spot Model (data contract)

A single self-contained, gradable spot:

```ts
type ActionKind = 'fold' | 'check' | 'call' | 'raise' | 'allin';
type Bucket     = 'fold' | 'check' | 'call' | 'small' | 'big';

interface ActionOption {
  kind: ActionKind;
  label: string;        // concrete, user-facing text: "3-bet to 7.5bb", "Jam 15bb", "Bet 7bb (75% pot)"
  sizeBb?: number;      // for raise/allin
  bucket: Bucket;       // grading/coloring bucket — NOT shown to the user
}

interface Spot {
  id: string;
  category: 'rfi' | 'vs-open' | 'vs-3bet' | 'push-fold';
  format: string;             // "Cash 6-max" | "MTT"
  effStackBb: number;         // 100 (cash) | 10|15|20|25 (push/fold)
  heroPos: Position;          // 'UTG'|'HJ'|'CO'|'BTN'|'SB'|'BB'
  villainPos?: Position;      // the aggressor, if any
  actionHistory: HistoryItem[]; // strip: [{pos, action, amountBb?, state:'fold'|'acted'|'hero'|'pending'}]
  potBb: number;
  toCallBb: number;
  heroHand: [Card, Card];     // concrete combo WITH suits (blockers matter)
  legalActions: ActionOption[];
  strategy: Record<Bucket, number>; // frequency 0..1 per bucket
  // ev?: Record<Bucket, number>     // Phase 2 only
  source: string;             // attribution: which chart it came from
}
```

**Why concrete suits:** the range chart highlights the exact hand; suits don't change preflop grading but keep the model identical for postflop (where blockers/board matter).

---

## 6. Data Sources (Phase 1)

| Need | Source | License | Notes |
|---|---|---|---|
| RFI / vs-open / vs-3bet / vs-4bet ranges, 100bb 6-max | **`AHTOOOXA/poker-charts`** (`greenline.ts`) | MIT | Cells encode pure action (string) or mixed (array w/ frequencies) — maps ~1:1 to our `strategy`. |
| Short-stack push/fold (Nash jam/fold), **per depth 10/15/20/25bb** | `a1r93/push-or-fold` (MIT) and/or digitized HoldemResources HUNE tables | MIT / public chart | Bundle one table per depth; depth becomes a spot/selector dimension. |
| Hand/equity helpers (optional feedback flavor) | already-installed **`pokersolver`** | MIT | Only if we show equity; not required for grading. |

**Conversion:** a one-time build step under `app/src/trainer/charts/` converts each source into our `strategy` schema as bundled TS/JSON (KB-scale, analogous to the backend's `aliases-seed.json`). Attribution recorded per `Spot.source` and in a `NOTICES` comment. No source binaries shipped.

---

## 7. Grading Logic

Given the spot's `strategy` (bucket → frequency) and the user's chosen bucket:

```
topFreq   = max frequency across buckets
userFreq  = strategy[userBucket] ?? 0

tier:
  Best        if userBucket is the highest-frequency bucket (ties → any top bucket)
  Correct     if userFreq >= 0.035 and not Best
  Inaccuracy  if 0 < userFreq < 0.035
  Mistake     if userFreq == 0  (action GTO never takes here)
  Blunder     reserved for Phase 2 EV thresholds / clear push-fold errors
```

- **Mixed strategies are first-class:** any bucket played ≥3.5% is *Correct*, never punished — the point of the "forgiving" choice.
- **Colors (traffic light):** Best → `accent-positive` (green); Correct → `accent-primary` (neutral tan); Inaccuracy/Mistake/Blunder → `accent-negative` (red).
- **Truth metric is frequency** in Phase 1 (charts lack per-action EV); feedback says so honestly. Phase 2 adds EV-loss (% pot / bb) and can split Mistake vs Blunder by EV thresholds.
- **"Correct count" for stats** = Best + Correct tiers.

---

## 8. UI / UX

### 8.1 Spot screen (approved mockups)
- **Context line:** format · effective stack · hero position.
- **Action-history strip** (above table): one cell per seat in betting order showing fold / bet amount / "YOU · to act" / pending.
- **Poker-table view:** wide rounded racetrack felt; seats with stack sizes; aggressor highlighted with a bet chip; dealer button; centered pot; hero's two cards at the bottom.
- **Action buttons:** the legal subset (§4), each labeled with the **concrete action + size** ("3-bet to 7.5bb", "Jam 15bb"); Fold styled with `accent-negative`.

### 8.2 Feedback panel (approved mockups, with color update)
- **Result banner** colored by tier (green/neutral/red) with a one-line explanation ("You played Call — GTO mixes it 22%; the top line is 3-bet to 7.5bb ★").
- **Strategy breakdown:** the GTO frequencies for the hand using the **concrete action labels**, each row colored by its tier (green = top, neutral = other played lines, red = never-played), user's pick outlined, top line starred.
- **EV honesty note** (Phase 1): grading is by frequency; EV numbers come with Phase 2.
- **Range chart:** **collapsed** behind "Show full range ▾". Expanded: the 13×13 grid for the spot, cells colored by **action** (separate palette from the green/red quality colors — §8.3), hero's hand outlined, legend included.
- **Footer:** session stats (accuracy, streak) + **Next spot** primary button.

### 8.3 Color discipline (avoid clash)
Quality/traffic-light colors (green = best, red = bad) are reserved for **grading**. The range-grid **action** legend uses a separate palette: Raise = `accent-primary` (brown), Call = a muted gold/olive, Mixed = split, Fold = neutral grey. So "green" always means "best play," never "call".

### 8.4 Drill flow
1. User opens Trainer → sees a **category chip row** (RFI / Facing open / Facing 3-bet / Push-fold / **Mixed** default).
2. When **Push-fold** is active, a second **stack-depth chip row** appears (10 / 15 / 20 / 25bb / **Mixed**).
3. A spot is generated and rendered.
4. User clicks an action → buttons lock, feedback panel animates in, stats update.
5. **Next spot** → new spot in the chosen category/depth. Repeat.

### 8.5 Navigation entry
- New route `<Route path="/trainer" element={<Trainer />} />` added **above** the catch-all in `app/src/App.tsx:29`.
- New 🎯 emoji icon button in the Home header button row (`app/src/pages/Home.tsx:53-76`), `title="GTO Trainer"`, `navigate('/trainer')`.

---

## 9. Architecture (Phase 1 — fully client-side)

No backend, server, or DB changes. New frontend modules:

```
app/src/
  pages/Trainer.tsx                  # page: category/depth state, current spot, answer/feedback state, stats
  trainer/
    types.ts                         # Spot, ActionOption, Bucket, GradeResult, TrainerStats, Position, Card
    charts/                          # bundled converted chart data (TS/JSON) + attribution
      index.ts                       # loads/normalizes chart data into lookup tables
    engine/
      spotGenerator.ts               # pick category/depth → positions → sample concrete hero combo → build Spot
      grader.ts                      # (spot, userBucket) → GradeResult {tier, color, explanation}
      ranges.ts                      # 169-grid helpers, combo↔class mapping, range-cell coloring
    stats.ts                         # localStorage-backed stats helpers
  components/trainer/
    PokerTable.tsx                   # felt + seats + pot + hero cards
    ActionHistoryStrip.tsx
    ActionButtons.tsx                # renders legal subset; concrete labels; emits chosen bucket
    FeedbackPanel.tsx                # banner + strategy breakdown + collapsed RangeGrid + footer
    RangeGrid.tsx                    # 13×13 grid, action-colored, hero highlight
```

- **Styling:** existing Tailwind tokens (`bg-bg-*`, `text-text-*`, `accent-*`) and shared `.card` / button classes from `index.css`. Hand-rolled SVG/CSS for table and grid (consistent with how pages already hand-roll charts).
- **State:** local React state in `Trainer.tsx` (no global store, matching the app). Stats via `useLocalStorage`.
- **Each module has one job** and is unit-testable in isolation — `grader.ts`, `spotGenerator.ts`, `ranges.ts` are pure functions over the `Spot` contract.

### 9.1 Spot generation / sampling (realism)
- Pick category (user-selected or weighted for Mixed); for push/fold also pick depth (selected or Mixed).
- Pick valid positions for that category.
- **Sample a concrete combo uniformly from all 1326 combos**, map to its 169-class strategy at that node. This naturally includes trash hands where **Fold is correct**, so the quiz isn't all premiums. (Future refinement: weight by realistic arrival frequency — deferred.)

### 9.2 Stats shape (localStorage key `poker-tracker-trainer-stats`)
```ts
interface TrainerStats {
  totalAnswered: number;
  totalCorrect: number;              // Best + Correct
  currentStreak: number;
  bestStreak: number;
  byCategory: Record<Category, { answered: number; best: number; correct: number; inaccuracy: number; mistake: number }>;
  lastPlayed: string;                // ISO date
}
```

---

## 10. Hard Constraints

- **Lookup-only at runtime.** Never invoke a solver in a request path. A single postflop solve is 30–90s+ and 1–8 GB RAM; the VPS cannot do this. All correct answers are precomputed/bundled.
- **No new heavy dependencies** for Phase 1. Chart data is static KB; `pokersolver` is already present.
- **Builds clean:** `tsc -b && vite build` and `eslint .` pass.

---

## 11. Phase 2 — Postflop (outline only)

- **Offline** (dev machine, never the VPS): batch-run **TexasSolver** over a curated spot set — a few pot types (SRP, 3BP), a representative flop set bucketed by texture (dry/wet/paired/monotone), fixed positions, 100bb, solved with a real **3-size tree (~33% / ~75% / all-in)**.
- **Build step collapses** solver sizes into display buckets (small ≤50% pot, big >50%; **bucket EV = max EV of member sizes** so a valid size-class pick isn't penalized). Strategy-only per-street slices (KB–MB), **never** full multi-street trees (GB).
- **Storage:** introduce a backend `trainer_spots` SQLite table (seed-on-empty, like `aliases-seed.json`) served via `GET /api/trainer/spot`, OR keep bundling JSON if size stays small. Decide once data size is known.
- **Grading gains EV-loss** (% pot / bb); Mistake vs Blunder split by EV thresholds. Buttons show real sizes as % pot (the original 4-button vision).
- **Licensing:** TexasSolver is AGPL-3.0 — generating data offline and bundling the **JSON output** is fine; **never link/ship the binary** in the hosted app.

---

## 12. Risks & Accepted Limitations

1. **Cash depths are 100bb only** in v1 (free-data reality); push/fold (10–25bb) covers shallow play. Intermediate cash depths deferred. *(Accepted.)*
2. **Data provenance:** free charts are community "study charts," not re-run solver output — fine for a hobby trainer, but present as "GTO-style," not authoritative.
3. **Mixed-strategy grading credibility:** must use frequency-threshold/partial-credit from day one (it does) and always show the full distribution.
4. **Spot realism:** sample from real combos so fold-worthy hands appear; avoid unteachable junk.
5. **Phase 2 only:** live-solve temptation, AGPL/binary-shipping, and data-size blowup — all addressed in §11.

---

## 13. Success Criteria (Phase 1)

- [ ] `/trainer` route reachable via a 🎯 button in the Home header.
- [ ] All four preflop categories drillable; push/fold offers selectable depths (10/15/20/25/Mixed).
- [ ] Each spot renders table + action-history strip + the correct legal buttons with concrete size labels.
- [ ] Answers graded into the five tiers with the correct traffic-light colors and a clear explanation.
- [ ] Feedback shows the frequency split and a collapsible, correctly-colored 13×13 range chart with the hero hand highlighted.
- [ ] Stats (accuracy, streak, per-category) persist across reloads via `localStorage`.
- [ ] No backend changes; `tsc -b && vite build` and `eslint .` pass.
- [ ] Chart data attributed per its MIT license.

---

## 14. Resolved Decisions (from review)

1. Preflop shows the **legal 2–3 buttons** (no forced small/big split). ✅
2. Category selector = **in-page chips**. ✅
3. Push/fold spans a **range of depths** (10/15/20/25bb, selectable + Mixed) for shallow-vs-deep practice. ✅
4. Button labels are **concrete action + size** ("3-bet to 7.5bb", "Jam 15bb"), never "bet small/big". ✅
