import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePerPlayerResults, formatResultsMessage, rebuildResultsMessage, isResultsPost } from './results-message.js';

// Two winners and a loser; Daniel H won the most, Stephen won less.
const session = (over = {}) => ({
  id: 's1',
  date: '2026-09-16',
  gameType: 'in-person',
  bankPlayerId: null,
  players: [
    { id: 'p-daniel', name: 'Daniel H', buyIns: [{ amount: 200 }], cashOut: { amount: 1415 } },
    { id: 'p-stephen', name: 'Stephen', buyIns: [{ amount: 100 }], cashOut: { amount: 300 } },
    { id: 'p-leo', name: 'Leo', buyIns: [{ amount: 600 }], cashOut: { amount: 583 } },
  ],
  ...over,
});

const accounts = {
  'Daniel H': { displayName: 'D Huang', account: '12-3456-7890123-00' },
  Stephen: { displayName: 'S Fang', account: '98-7654-3210987-00' },
  Leo: { displayName: 'L Chen', account: '11-2233-4455667-00' },
};

const messageFor = (s) => formatResultsMessage(s, computePerPlayerResults(s), accounts);

test('formatResultsMessage: with no stored banker the biggest winner banks', () => {
  const msg = messageFor(session());
  assert.match(msg, /🏦 \*\*Bank player: Daniel H\*\*/);
  assert.match(msg, /pay Daniel H/);
});

test('formatResultsMessage: a stored banker overrides the biggest winner', () => {
  // The whole point of the override: Discord must name the person the tracker
  // says is holding the money, not whoever won the most.
  const msg = messageFor(session({ bankPlayerId: 'p-stephen' }));
  assert.match(msg, /🏦 \*\*Bank player: Stephen\*\*/);
  assert.match(msg, /pay Stephen/);
  assert.doesNotMatch(msg, /Bank player: Daniel H/);
});

test('formatResultsMessage: the banker is not also told to pay themselves', () => {
  const msg = messageFor(session({ bankPlayerId: 'p-stephen' }));
  // Stephen won, so he is in the winners list — as the bank, without an
  // account to transfer to.
  assert.match(msg, /• Stephen: \*\*\+\$200\.00\*\*\s+🏦/);
  // And Daniel H, no longer the bank, needs his account shown so he gets paid.
  assert.match(msg, /• Daniel H: \*\*\+\$1215\.00\*\* → D Huang/);
});

test('formatResultsMessage: a banker who lost is still named as the bank', () => {
  const msg = messageFor(session({ bankPlayerId: 'p-leo' }));
  assert.match(msg, /🏦 \*\*Bank player: Leo\*\*/);
  assert.match(msg, /L Chen/);
});

test('formatResultsMessage: a stored banker who has left the session falls back', () => {
  const msg = messageFor(session({ bankPlayerId: 'gone' }));
  assert.match(msg, /🏦 \*\*Bank player: Daniel H\*\*/);
});

test('formatResultsMessage: rake is shown as owed to whoever holds it', () => {
  const msg = messageFor(session({ rakeAmount: 133, rakeHolder: 'Stephen' }));
  assert.match(msg, /🧾 \*\*Rake\*\*: \$133\.00 → Stephen/);
});

test('formatResultsMessage: rake held by the banker moves no money', () => {
  const msg = messageFor(session({ rakeAmount: 133, rakeHolder: null }));
  assert.match(msg, /🧾 \*\*Rake\*\*: \$133\.00 — kept by Daniel H/);
});

test('formatResultsMessage: a night with no rake says nothing about it', () => {
  assert.doesNotMatch(messageFor(session({ rakeAmount: 0 })), /Rake/);
});

const STREAK_TAIL = '\n📈 **Streak watch**\n🔥 Jordan has won 3 in a row\n\n\n_New here? Run `/help`._';

test('rebuildResultsMessage: the streak lines posted at the time are kept', () => {
  // Streaks were true when the session was posted. Recomputing them weeks later
  // would rewrite history, so the tail is carried over untouched.
  const original = `🎲 **Session results — 2026-09-16**\nold body${STREAK_TAIL}`;
  const rebuilt = rebuildResultsMessage(original, '🎲 **Session results — 2026-09-16**\nnew body');
  assert.equal(rebuilt, `🎲 **Session results — 2026-09-16**\nnew body${STREAK_TAIL}`);
});

test('rebuildResultsMessage: the role mention stays at the top', () => {
  const original = `<@&12345>\n🎲 **Session results — 2026-09-16**\nold body${STREAK_TAIL}`;
  const rebuilt = rebuildResultsMessage(original, '🎲 **Session results — 2026-09-16**\nnew body');
  assert.ok(rebuilt.startsWith('<@&12345>\n'));
  assert.match(rebuilt, /new body/);
  assert.match(rebuilt, /Streak watch/);
});

test('rebuildResultsMessage: a message with no streaks keeps its help hint', () => {
  const original = '🎲 **Session results — 2026-09-16**\nold body\n\n\n_New here? Run `/help`._';
  const rebuilt = rebuildResultsMessage(original, '🎲 **Session results — 2026-09-16**\nnew body');
  assert.match(rebuilt, /new body/);
  assert.match(rebuilt, /_New here\? Run `\/help`\._/);
  assert.doesNotMatch(rebuilt, /old body/);
});

test('rebuildResultsMessage: a bare message is simply replaced', () => {
  const rebuilt = rebuildResultsMessage('🎲 **Session results — 2026-09-16**\nold body', 'new body only');
  assert.equal(rebuilt, 'new body only');
});

// Leo owed his $500 limit and transferred Stephen $300 more on the night.
const withBankBuyIns = (over = {}) => session({
  creditCollector: 'Stephen',
  players: [
    { id: 'p-daniel', name: 'Daniel H', buyIns: [{ amount: 200, method: 'cash' }], cashOut: { amount: 1000 } },
    { id: 'p-leo', name: 'Leo', buyIns: [{ amount: 500, method: 'credit' }, { amount: 300, method: 'bank' }], cashOut: { amount: 0 } },
  ],
  ...over,
});

test('formatResultsMessage: bank buy-ins go from the collector to the banker', () => {
  const msg = messageFor(withBankBuyIns());
  assert.match(msg, /💳 \*\*Bank buy-ins\*\*: \$300\.00 — Stephen → Daniel H/);
  // Leo lost all $800 he bought in for.
  assert.match(msg, /• Leo: −\$800\.00/);
});

test('formatResultsMessage: a collector who banks keeps the bank buy-ins', () => {
  const msg = messageFor(withBankBuyIns({ bankPlayerId: 'p-daniel', creditCollector: 'Daniel H' }));
  assert.match(msg, /\$300\.00 — kept by Daniel H/);
});

test('formatResultsMessage: no bank buy-ins, no line', () => {
  assert.doesNotMatch(messageFor(session()), /Bank buy-ins/);
});

test('isResultsPost: found whether or not it opens with the poker role mention', () => {
  const body = messageFor(session());
  assert.equal(isResultsPost(body), true);
  assert.equal(isResultsPost(`<@&1511234576104820746>\n${body}`), true);
});

test('isResultsPost: other bot posts are not results', () => {
  assert.equal(isResultsPost('✅ **Nick** marked as paid. 🎉 Everyone has paid!'), false);
  assert.equal(isResultsPost('💸 **Still unpaid — 2026-11-05**'), false);
  assert.equal(isResultsPost(''), false);
  assert.equal(isResultsPost(undefined), false);
});

// Simon is owed $495 and Min, who lost, is owed $450 of her own cash back.
const withCash = (cash = {}) => session({
  bankPlayerId: 'p-leo',
  cashInFifties: 1,
  players: [
    { id: 'p-leo', name: 'Leo', buyIns: [{ amount: 250, method: 'credit' }], cashOut: { amount: 800 } },
    { id: 'p-simon', name: 'Simon', cashPaid: cash.simon, buyIns: [{ amount: 400, method: 'credit' }], cashOut: { amount: 895 } },
    { id: 'p-min', name: 'Min', cashPaid: cash.min, buyIns: [{ amount: 1000, method: 'cash' }, { amount: 500, method: 'credit' }], cashOut: { amount: 950 } },
  ],
});

test('formatResultsMessage: says nothing about cash until someone records it', () => {
  const msg = messageFor(withCash());
  assert.doesNotMatch(msg, /gets \$/);
  assert.match(msg, /• Min: −\$550\.00  _\(paid in cash on the table\)_/);
});

test('formatResultsMessage: recorded cash shows how each player is paid', () => {
  const msg = messageFor(withCash({ simon: 500, min: 450 }));
  assert.match(msg, /• Simon: .*_\(gets \$500\.00 cash, transfers \$5\.00 back\)_/);
  assert.match(msg, /• Min: −\$550\.00  _\(gets \$450\.00 cash\)_/);
});

test('formatResultsMessage: a player recorded with no cash is paid by transfer', () => {
  const msg = messageFor(withCash({ simon: 0, min: 450 }));
  assert.match(msg, /• Simon: .*_\(gets \$495\.00 by transfer\)_/);
});

test('rebuildResultsMessage: keeps the role mention and heater banner above the heading', () => {
  const above = '<@&123>\n# 🚨🔥 6 IN A ROW 🔥🚨\n\n';
  const rebuilt = rebuildResultsMessage(`${above}🎲 **Session results — 2026-11-05**\nold`, '🎲 **Session results — 2026-11-05**\nnew');
  assert.equal(rebuilt, `${above}🎲 **Session results — 2026-11-05**\nnew`);
});

test('rebuildResultsMessage: the /help hint gives way rather than exceed the Discord limit', () => {
  const hint = '\n\n\n_New here? Run `/help`._';
  const rebuilt = rebuildResultsMessage(`🎲 **Session results — d**${hint}`, 'x'.repeat(1990));
  assert.equal(rebuilt, 'x'.repeat(1990));
});
