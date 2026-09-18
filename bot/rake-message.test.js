import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatSessionRakePost,
  formatSpendPost,
  formatGivePost,
  formatAdjustPost,
  formatBalance,
  formatCorrectionPost,
} from './rake-message.js';

// The pile after the first session past the cut-off.
const balances = {
  total: 874.5,
  holders: [
    { name: 'Stephen', balance: 372.5 },
    { name: 'Jordan', balance: 329 },
    { name: 'Daniel H', balance: 133 },
    { name: 'Jeremy', balance: 40 },
  ],
};

test('formatSessionRakePost: the night, the rake, who holds it, and the pile', () => {
  const post = formatSessionRakePost(
    { date: '2026-09-23', notes: 'Wednesday sesh' },
    { amount: 133, holder: 'Daniel H' },
    balances
  );
  assert.match(post, /Wednesday sesh — 2026-09-23/);
  assert.match(post, /\$133\.00 → held by \*\*Daniel H\*\*/);
  assert.match(post, /Pile: \*\*\$874\.50\*\*/);
  assert.match(post, /Stephen \$372\.50/);
  assert.match(post, /Jeremy \$40\.00/);
});

test('formatSessionRakePost: a session with no name still reads as a night', () => {
  const post = formatSessionRakePost({ date: '2026-09-23', notes: '' }, { amount: 50, holder: 'Jordan' }, balances);
  assert.match(post, /2026-09-23/);
  assert.doesNotMatch(post, /— *—/);
});

test('formatSpendPost: money leaving the pile says what it went on', () => {
  const post = formatSpendPost({ amount: 120, fromName: 'Jeremy', note: 'new chips' }, balances);
  assert.match(post, /Jeremy spent \*\*\$120\.00\*\*/);
  assert.match(post, /new chips/);
  assert.match(post, /Pile: \*\*\$874\.50\*\*/);
});

test('formatSpendPost: no note, no empty brackets', () => {
  const post = formatSpendPost({ amount: 120, fromName: 'Jeremy', note: null }, balances);
  assert.match(post, /Jeremy spent \*\*\$120\.00\*\*/);
  assert.doesNotMatch(post, /\(\)|—\s*$/m);
});

test('formatGivePost: a hand-over names both people', () => {
  const post = formatGivePost({ amount: 329, fromName: 'Jordan', toName: 'Stephen' }, balances);
  assert.match(post, /Jordan → \*\*Stephen\*\*: \$329\.00/);
});

test('formatAdjustPost: a correction reads as a correction', () => {
  const credit = formatAdjustPost({ amount: 50, toName: 'Stephen', note: 'miscount' }, balances);
  assert.match(credit, /Stephen \+\$50\.00/);
  assert.match(credit, /miscount/);
  const debit = formatAdjustPost({ amount: 50, fromName: 'Stephen', note: 'miscount' }, balances);
  assert.match(debit, /Stephen −\$50\.00/);
});

test('formatBalance: the pile and everyone holding a piece of it', () => {
  const text = formatBalance(balances);
  assert.match(text, /\$874\.50/);
  assert.match(text, /Stephen \$372\.50/);
  assert.match(text, /Daniel H \$133\.00/);
});

test('formatBalance: an empty pile says so rather than showing a bare zero', () => {
  assert.match(formatBalance({ total: 0, holders: [] }), /nothing in the rake pile/i);
});

test('formatCorrectionPost: says what changed and what the pile is now', () => {
  const post = formatCorrectionPost(
    { date: '2026-09-23', notes: 'Wednesday sesh' },
    { from: 133, to: 143 },
    { ...balances, total: 884.5 }
  );
  assert.match(post, /\$133\.00 → \$143\.00/);
  assert.match(post, /\$884\.50/);
});

test('every post fits inside Discord s 2000-character limit with a big group', () => {
  const crowded = {
    total: 5000,
    holders: Array.from({ length: 60 }, (_, i) => ({ name: `Player ${i}`, balance: 83.33 })),
  };
  const post = formatSessionRakePost({ date: '2026-09-23', notes: 'Big one' }, { amount: 133, holder: 'Player 1' }, crowded);
  assert.ok(post.length <= 2000, `post was ${post.length} characters`);
  assert.match(post, /and \d+ more/);
});
