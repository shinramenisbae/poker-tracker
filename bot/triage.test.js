import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyAttachment, attachmentTrigger } from './triage.js';

test('classifyAttachment: ledger CSV by filename prefix', () => {
  assert.equal(classifyAttachment({ name: 'ledger_pglKlW.csv' }), 'ledger');
});

test('classifyAttachment: hand log CSV by filename prefix', () => {
  assert.equal(classifyAttachment({ name: 'poker_now_log_pgl0Pu9.csv' }), 'handlog');
});

test('classifyAttachment: hand log wins even when content-type is text/csv', () => {
  assert.equal(
    classifyAttachment({ name: 'poker_now_log_x.csv', contentType: 'text/csv' }),
    'handlog',
  );
});

test('classifyAttachment: CSV by content-type with no recognizable name', () => {
  assert.equal(classifyAttachment({ name: 'export', contentType: 'text/csv' }), 'ledger');
});

test('classifyAttachment: image by extension', () => {
  assert.equal(classifyAttachment({ name: 'Screenshot.PNG' }), 'image');
});

test('classifyAttachment: image by content-type', () => {
  assert.equal(classifyAttachment({ name: 'blob', contentType: 'image/jpeg' }), 'image');
});

test('classifyAttachment: unrelated file is other', () => {
  assert.equal(classifyAttachment({ name: 'notes.txt' }), 'other');
});

test('classifyAttachment: missing attachment fields are other', () => {
  assert.equal(classifyAttachment({}), 'other');
  assert.equal(classifyAttachment(null), 'other');
});

test('attachmentTrigger: ledger upload', () => {
  assert.equal(attachmentTrigger(['ledger']), 'upload');
});

test('attachmentTrigger: image counts as an upload (OCR path)', () => {
  assert.equal(attachmentTrigger(['image']), 'upload');
});

test('attachmentTrigger: hand log only', () => {
  assert.equal(attachmentTrigger(['handlog']), 'handlog');
});

test('attachmentTrigger: ledger + hand log together → upload (ledger wins)', () => {
  assert.equal(attachmentTrigger(['ledger', 'handlog']), 'upload');
});

test('attachmentTrigger: chatter / unrelated → null (the bug fix)', () => {
  assert.equal(attachmentTrigger([]), null);
  assert.equal(attachmentTrigger(['other']), null);
});
