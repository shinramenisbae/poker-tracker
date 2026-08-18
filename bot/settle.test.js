import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canFinish, bankPlayerName } from './settle.js';

// Luke is the biggest winner, so the bank player. George owes $200 by transfer,
// Simon $108. The cash-only loser owes nothing chaseable.
function session(over = {}) {
  return {
    status: 'completed',
    bankPlayerId: null,
    players: [
      { id: 'luke', name: 'Luke', buyIns: [{ amount: 100, method: 'cash' }], cashOut: { amount: 570.5 } },
      { id: 'simon', name: 'Simon', buyIns: [{ amount: 100, method: 'cash' }, { amount: 108, method: 'bank' }], cashOut: { amount: 0 } },
      { id: 'george', name: 'George', buyIns: [{ amount: 200, method: 'bank' }], cashOut: { amount: 0 } },
    ],
    ...over,
  };
}
const allPaid = new Set(['George', 'Simon']);
const base = { isAdmin: false, alreadySettled: false, reopen: false };

// --- bankPlayerName ---

test('bankPlayerName: falls back to the biggest winner when unset', () => {
  assert.equal(bankPlayerName(session()), 'Luke');
});

test('bankPlayerName: an explicit bankPlayerId wins over the biggest winner', () => {
  assert.equal(bankPlayerName(session({ bankPlayerId: 'simon' })), 'Simon');
});

test('bankPlayerName: null when nobody won, so nobody is the bank', () => {
  const s = session({ players: [{ id: 'a', name: 'A', buyIns: [{ amount: 50 }], cashOut: { amount: 0 } }] });
  assert.equal(bankPlayerName(s), null);
});

// --- who may run it ---

test('canFinish: the bank player may close the books', () => {
  const r = canFinish({ ...base, session: session(), callerPlayerName: 'Luke', paidNames: allPaid });
  assert.equal(r.ok, true);
});

test('canFinish: an admin may close them too, bank player or not', () => {
  const r = canFinish({ ...base, session: session(), callerPlayerName: 'Nobody', isAdmin: true, paidNames: allPaid });
  assert.equal(r.ok, true);
});

test('canFinish: another player may not', () => {
  const r = canFinish({ ...base, session: session(), callerPlayerName: 'George', paidNames: allPaid });
  assert.equal(r.ok, false);
  assert.match(r.reason, /bank player/i);
});

test('canFinish: an unlinked caller is told how to link, not just refused', () => {
  const r = canFinish({ ...base, session: session(), callerPlayerName: null, paidNames: allPaid });
  assert.equal(r.ok, false);
  assert.match(r.reason, /\/link/);
});

// --- the gate ---

test('canFinish: refuses while a debtor is outstanding, naming them', () => {
  const r = canFinish({ ...base, session: session(), callerPlayerName: 'Luke', paidNames: new Set(['Simon']) });
  assert.equal(r.ok, false);
  assert.match(r.reason, /George/);
  assert.match(r.reason, /200/);
});

test('canFinish: refuses an active session even though it has no debtors', () => {
  // No cash-outs means no settlement, so hasOutstanding is vacuously false —
  // without the status check this would settle a game still being played.
  const s = session({ status: 'active', players: [{ id: 'a', name: 'A', buyIns: [{ amount: 50 }] }] });
  const r = canFinish({ ...base, session: s, callerPlayerName: 'A', isAdmin: true, paidNames: new Set() });
  assert.equal(r.ok, false);
  assert.match(r.reason, /still (in progress|active)/i);
});

// --- settling twice, and undoing ---

test('canFinish: refuses to settle twice, pointing at reopen', () => {
  const r = canFinish({ ...base, session: session(), callerPlayerName: 'Luke', paidNames: allPaid, alreadySettled: true });
  assert.equal(r.ok, false);
  assert.match(r.reason, /reopen/i);
});

test('canFinish: reopen works on a settled session', () => {
  const r = canFinish({ ...base, session: session(), callerPlayerName: 'Luke', paidNames: allPaid, alreadySettled: true, reopen: true });
  assert.equal(r.ok, true);
});

test('canFinish: reopen on a session that was never settled is refused', () => {
  const r = canFinish({ ...base, session: session(), callerPlayerName: 'Luke', paidNames: allPaid, reopen: true });
  assert.equal(r.ok, false);
  assert.match(r.reason, /not settled|wasn't settled/i);
});

test('canFinish: reopen does not require debts to be paid, since it is an undo', () => {
  const r = canFinish({ ...base, session: session(), callerPlayerName: 'Luke', paidNames: new Set(), alreadySettled: true, reopen: true });
  assert.equal(r.ok, true);
});

test('canFinish: reopen still requires permission', () => {
  const r = canFinish({ ...base, session: session(), callerPlayerName: 'George', paidNames: allPaid, alreadySettled: true, reopen: true });
  assert.equal(r.ok, false);
});
