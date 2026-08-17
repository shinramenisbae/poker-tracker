import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unarchiveIfArchived, respond, sendToThread } from './respond.js';

// discord.js's MessageFlags.Ephemeral, inlined so these stay runnable without
// installing the bot's dependencies — as the other bot tests are.
const EPHEMERAL = 64;

// Minimal stand-ins for the Discord objects. Discord's API is the one
// dependency we can't exercise for real in a unit test, so these record what
// the helpers would have asked it to do.
function fakeThread({ archived = false, failWith = null } = {}) {
  const setArchivedCalls = [];
  const sent = [];
  return {
    archived,
    setArchivedCalls,
    sent,
    async setArchived(value) {
      setArchivedCalls.push(value);
      if (failWith) throw failWith;
      this.archived = value;
    },
    async send(payload) {
      // Discord rejects a message posted into an archived thread (50083).
      if (this.archived) throw new Error('Thread is archived');
      sent.push(payload);
    },
  };
}

function fakeInteraction({ deferred = false, replied = false } = {}) {
  const calls = [];
  return {
    deferred,
    replied,
    calls,
    async reply(payload) { calls.push(['reply', payload]); },
    async editReply(payload) { calls.push(['editReply', payload]); },
  };
}

test('unarchiveIfArchived: reopens an archived thread', async () => {
  const thread = fakeThread({ archived: true });
  const reopened = await unarchiveIfArchived(thread);
  assert.equal(reopened, true);
  assert.deepEqual(thread.setArchivedCalls, [false]);
});

test('unarchiveIfArchived: leaves an active thread untouched', async () => {
  const thread = fakeThread({ archived: false });
  const reopened = await unarchiveIfArchived(thread);
  assert.equal(reopened, false);
  assert.deepEqual(thread.setArchivedCalls, []);
});

test('unarchiveIfArchived: ignores a channel that cannot be archived', async () => {
  // A normal text channel has no setArchived — must not throw.
  const reopened = await unarchiveIfArchived({ archived: true });
  assert.equal(reopened, false);
});

test('unarchiveIfArchived: tolerates a missing channel', async () => {
  assert.equal(await unarchiveIfArchived(null), false);
  assert.equal(await unarchiveIfArchived(undefined), false);
});

test('unarchiveIfArchived: surfaces a permission failure rather than swallowing it', async () => {
  const boom = new Error('Missing Permissions');
  const thread = fakeThread({ archived: true, failWith: boom });
  await assert.rejects(() => unarchiveIfArchived(thread), /Missing Permissions/);
});

test('sendToThread: reopens an archived thread so the message lands', async () => {
  const thread = fakeThread({ archived: true });
  await sendToThread(thread, { content: 'reminder' });
  assert.deepEqual(thread.setArchivedCalls, [false]);
  assert.deepEqual(thread.sent, [{ content: 'reminder' }]);
});

test('sendToThread: posts straight to an active thread', async () => {
  const thread = fakeThread({ archived: false });
  await sendToThread(thread, { content: 'reminder' });
  assert.deepEqual(thread.setArchivedCalls, []);
  assert.deepEqual(thread.sent, [{ content: 'reminder' }]);
});

test('respond: replies when the interaction has not been answered yet', async () => {
  const interaction = fakeInteraction();
  await respond(interaction, { content: 'hi' });
  assert.deepEqual(interaction.calls, [['reply', { content: 'hi' }]]);
});

test('respond: edits the placeholder instead of replying twice when deferred', async () => {
  const interaction = fakeInteraction({ deferred: true });
  await respond(interaction, { content: 'done' });
  assert.deepEqual(interaction.calls, [['editReply', { content: 'done' }]]);
});

test('respond: drops ephemeral flags when editing, since visibility is fixed at defer time', async () => {
  const interaction = fakeInteraction({ deferred: true });
  await respond(interaction, { content: 'oops', flags: EPHEMERAL });
  assert.deepEqual(interaction.calls, [['editReply', { content: 'oops' }]]);
});
