import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accountsMapFromResponse, consolidateBankAccounts } from './bank.js';

test('accountsMapFromResponse: extracts a clean map', () => {
  const json = { accounts: { George: { displayName: 'George Lin', account: '01-0170-0115185-00' } } };
  assert.deepEqual(accountsMapFromResponse(json), {
    George: { displayName: 'George Lin', account: '01-0170-0115185-00' },
  });
});

test('accountsMapFromResponse: missing/!object accounts → empty map', () => {
  assert.deepEqual(accountsMapFromResponse(null), {});
  assert.deepEqual(accountsMapFromResponse({}), {});
  assert.deepEqual(accountsMapFromResponse({ accounts: null }), {});
  assert.deepEqual(accountsMapFromResponse('nope'), {});
});

test('accountsMapFromResponse: skips malformed entries, defaults fields', () => {
  const json = { accounts: { A: null, B: { displayName: 'Bee' } } };
  assert.deepEqual(accountsMapFromResponse(json), { B: { displayName: 'Bee', account: '' } });
});

test('consolidateBankAccounts: drops _comment and lists rows', () => {
  const raw = { _comment: 'note', Stephen: { displayName: 'S F', account: '99' } };
  assert.deepEqual(consolidateBankAccounts(raw), [
    { name: 'Stephen', displayName: 'S F', account: '99' },
  ]);
});

test('consolidateBankAccounts: folds Arya into Aarya, Aarya wins', () => {
  const raw = {
    Aarya: { displayName: 'Aarya Real', account: 'AA' },
    Arya: { displayName: 'Arya Old', account: 'AR' },
  };
  const rows = consolidateBankAccounts(raw);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { name: 'Aarya', displayName: 'Aarya Real', account: 'AA' });
});

test('consolidateBankAccounts: Aarya inherits fields it is missing from Arya', () => {
  const raw = {
    Aarya: { displayName: '', account: '' },
    Arya: { displayName: 'Arya Old', account: 'AR' },
  };
  const rows = consolidateBankAccounts(raw);
  assert.deepEqual(rows, [{ name: 'Aarya', displayName: 'Arya Old', account: 'AR' }]);
});
