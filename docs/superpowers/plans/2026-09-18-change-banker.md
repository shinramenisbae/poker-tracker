# Changing the banker by hand — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A completed session's banker can be pointed at someone other than the biggest winner, and Discord follows.

**Architecture:** A pure rule module decides whether a change is allowed; a thin route applies it and tells the bot. The bot's results post starts honouring the stored banker (it does not today), and its message-building moves out of `index.js` so both the first post and the later edit share one implementation.

**Tech Stack:** Node 22, Express 4, `sqlite3`, CommonJS backend; ESM bot on discord.js; React 19 + TypeScript frontend.

**Spec:** `docs/superpowers/specs/2026-09-18-rake-banker-merge-design.md` (Part B)

## Global Constraints

- **No new npm dependencies.**
- Backend CommonJS, bot ESM, frontend TS — never mixed.
- Backend tests `node --test`; bot tests `node --test` over pure modules with no Discord connection; frontend Vitest.
- Money compares with a half-cent tolerance, never `===`.
- Every commit message ends with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## File Structure

| File | Responsibility |
|---|---|
| `backend/change-banker.js` (new) | Pure: may this session's banker change, and to whom |
| `backend/server.js` (modify) | `PUT /api/sessions/:id/banker`, then tell the bot |
| `bot/results-message.js` (new) | The results text: `formatResultsMessage`, `rebuildResultsMessage` |
| `bot/index.js` (modify) | Import from the new module; `POST /banker-changed/:id` |
| `app/src/api/index.ts` (modify) | `changeBanker(sessionId, playerId)` |
| `app/src/hooks/useStorage.ts` (modify) | `changeBanker` mutation |
| `app/src/pages/Results.tsx` (modify) | "Change banker" button, player list, locked reason |

---

### Task 1: The rule

**Files:** Create `backend/change-banker.js`, `backend/change-banker.test.js`

**Produces:** `canChangeBanker({session, playerId, paidCount}): {ok: true} | {ok: false, code, reason}`
with codes `'ACTIVE' | 'SETTLED' | 'PAID' | 'UNKNOWN_PLAYER'`.

Rules, in this order: session still active → `ACTIVE`; `settledAt` set → `SETTLED`; `paidCount > 0` → `PAID`; `playerId` not among `session.players` → `UNKNOWN_PLAYER`; else ok.

Tests: happy path; active session; settled session; one payment recorded; unknown player; a player who lost can still bank (deliberate — an older player may bank a night they lost).

### Task 2: The route

**Files:** Modify `backend/server.js`

`PUT /api/sessions/:id/banker` with `{playerId}`:
1. `readSession` → 404 when missing.
2. `SELECT COUNT(*) FROM session_payments WHERE sessionId = ?`.
3. `canChangeBanker` → 409 with `{error, code}` when refused.
4. `UPDATE sessions SET bankPlayerId = ?, updatedAt = ?`.
5. When `discordThreadId` is set, `forwardToBot` → `/banker-changed/:id` (best-effort: a Discord failure must not fail the change — return `discord: {ok: false, error}` in the body instead).
6. Respond with the updated session plus `discord`.

Verify by hand with curl against a local database: happy path, a session with a payment (409), unknown player (400/409), unknown session (404).

### Task 3: The bot says the right name

**Files:** Create `bot/results-message.js`, `bot/results-message.test.js`; modify `bot/index.js`

Move `computePerPlayerResults`, `formatMoney`, `formatCash` and `formatResultsMessage` out of `index.js` into `results-message.js` unchanged, then make one change: the bank player is `session.bankPlayerId`'s player when set, falling back to `winners[0]`.

Add `rebuildResultsMessage(original, rebuilt)`: keeps a leading role-mention line, takes the new results body, and re-attaches everything from `📈 **Streak watch**` onward from the original (falling back to the `_New here? Run /help._` hint, then to nothing).

Tests: an explicit `bankPlayerId` names that player as bank and lists them without bank details in the winners list; no `bankPlayerId` keeps today's biggest-winner behaviour; a bank player who lost is still named; `rebuildResultsMessage` preserves the streak tail; preserves the role mention; copes with a message that has neither.

### Task 4: The bot endpoint

**Files:** Modify `bot/index.js`

`POST /banker-changed/:sessionId` (wrapped in `withGuildFromRequest`, like `/announce`):
1. Fetch the session from the tracker; require `discordThreadId`, else `{ok: true, skipped: 'not announced'}`.
2. Fetch the thread; find the newest bot-authored message whose content contains `**Session results —` (scan the first 50).
3. Rebuild with `formatResultsMessage` + `rebuildResultsMessage`, `message.edit(...)`.
4. `sendToThread` a note: `🏦 **Banker changed to X** (was Y) — pay X instead`, plus their bank account when on file, `allowedMentions: {parse: []}`.
5. Return `{ok: true, edited: boolean}`.

The old banker's name comes from the request body (`{previousBankPlayerName}`), because by the time the bot looks the tracker already holds the new one.

### Task 5: The frontend

**Files:** Modify `app/src/api/index.ts`, `app/src/hooks/useStorage.ts`, `app/src/pages/Results.tsx`, `app/src/pages/Results.test.tsx`

- `changeBanker(sessionId, playerId): Promise<Session & {discord?: {ok: boolean, error?: string}}>`.
- Hook mutation storing the returned session.
- On the results page, next to the bank player card: a **Change banker** button opening a list of that session's players with their results; picking one calls the mutation. While any payment exists or the session is settled, the button is disabled with the reason. Payments come from `GET /api/sessions/:id/payments`, which the page does not fetch today.

Tests: the button lists players and sends the pick; disabled with a reason when someone has paid.

### Task 6: Ship

Full check (`npm test` in backend and bot, `vitest run`, `npm run build`, `npm run lint`), browser verification against a local backend, PR, merge, deploy group B.
