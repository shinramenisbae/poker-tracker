const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pickBankPlayer } = require('./bank-player');

test('pickBankPlayer: the biggest winner banks', () => {
  assert.equal(pickBankPlayer([
    { id: 'simon', totalBuyIn: 2000, cashOutAmount: 1180 },
    { id: 'danielh', totalBuyIn: 200, cashOutAmount: 1415 },
    { id: 'jordan', totalBuyIn: 300, cashOutAmount: 1329 },
  ]), 'danielh');
});

test('pickBankPlayer: nobody up means nobody banks', () => {
  assert.equal(pickBankPlayer([
    { id: 'a', totalBuyIn: 100, cashOutAmount: 50 },
    { id: 'b', totalBuyIn: 100, cashOutAmount: 100 },
  ]), null);
});

test('pickBankPlayer: a player still owing a cash-out cannot bank', () => {
  assert.equal(pickBankPlayer([
    { id: 'a', totalBuyIn: 100, cashOutAmount: null },
    { id: 'b', totalBuyIn: 100, cashOutAmount: 150 },
  ]), 'b');
});

test('pickBankPlayer: equal winners — the first listed banks', () => {
  assert.equal(pickBankPlayer([
    { id: 'a', totalBuyIn: 100, cashOutAmount: 200 },
    { id: 'b', totalBuyIn: 100, cashOutAmount: 200 },
  ]), 'a');
});

test('pickBankPlayer: cents of profit are not a win', () => {
  // REAL arithmetic leaves dust on a balanced session; a $0.002 "winner"
  // should not be handed everyone's money.
  assert.equal(pickBankPlayer([
    { id: 'a', totalBuyIn: 100, cashOutAmount: 100.002 },
    { id: 'b', totalBuyIn: 100, cashOutAmount: 99.998 },
  ]), null);
});

test('pickBankPlayer: no players at all', () => {
  assert.equal(pickBankPlayer([]), null);
});
