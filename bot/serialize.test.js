import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createKeyedSerializer } from './serialize.js';

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

// Models the duplicate-session bug: a "check-then-create" with an await in the
// middle. Run concurrently without serialization, both see created=false and
// both create. Serialized, the second sees the first's result and skips.
test('same key: check-then-create runs exactly once under concurrency', async () => {
  const run = createKeyedSerializer();
  const state = { created: false };
  const creations = [];

  async function checkThenCreate(label) {
    if (state.created) return;        // existence check
    await tick();                     // window where the race used to happen
    state.created = true;
    creations.push(label);
  }

  await Promise.all([
    run('thread-1', () => checkThenCreate('a')),
    run('thread-1', () => checkThenCreate('b')),
    run('thread-1', () => checkThenCreate('c')),
  ]);

  assert.deepEqual(creations, ['a'], 'only the first task should create');
});

test('same key: never runs two tasks for that key at the same time', async () => {
  const run = createKeyedSerializer();
  let active = 0;
  let maxActive = 0;
  const task = async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await tick();
    active -= 1;
  };
  await Promise.all([run('k', task), run('k', task), run('k', task)]);
  assert.equal(maxActive, 1);
});

test('different keys run concurrently', async () => {
  const run = createKeyedSerializer();
  let active = 0;
  let maxActive = 0;
  const task = async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await tick();
    active -= 1;
  };
  await Promise.all([run('a', task), run('b', task), run('c', task)]);
  assert.equal(maxActive, 3);
});

test('a thrown task does not block the next task for the same key', async () => {
  const run = createKeyedSerializer();
  const order = [];
  const p1 = run('k', async () => { order.push('one'); throw new Error('boom'); });
  const p2 = run('k', async () => { order.push('two'); });
  await assert.rejects(p1, /boom/);
  await p2;
  assert.deepEqual(order, ['one', 'two']);
});
