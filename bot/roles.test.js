import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRoleNames, resolveRoleName, canAssign, membersNeedingRole } from './roles.js';

// Plain shapes, mapped from discord.js objects at the call site, so the rules
// below are testable without a gateway connection.
const role = (id, name, extra = {}) => ({ id, name, managed: false, position: 1, ...extra });

// --- validateRoleNames ---

test('validateRoleNames: trims the names the owner typed', () => {
  const r = validateRoleNames({ poker: '  Poker  ', hot: 'Running Hot', cold: '' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.names, { poker: 'Poker', hot: 'Running Hot', cold: '' });
});

test('validateRoleNames: a blank field skips that role rather than failing', () => {
  const r = validateRoleNames({ poker: 'Poker', hot: '', cold: '   ' });
  assert.equal(r.ok, true);
  assert.equal(r.names.hot, '');
  assert.equal(r.names.cold, '');
});

test('validateRoleNames: all three blank is nothing to do', () => {
  const r = validateRoleNames({ poker: '', hot: '  ', cold: '' });
  assert.equal(r.ok, false);
  assert.match(r.error, /at least one/i);
});

test('validateRoleNames: the same name twice is a typo, not a request', () => {
  // hot and cold pointing at one role would make every streak transition add
  // and remove the same role.
  const r = validateRoleNames({ poker: '', hot: 'Streak', cold: 'streak' });
  assert.equal(r.ok, false);
  assert.match(r.error, /same name/i);
});

// --- resolveRoleName ---

test('resolveRoleName: reuses an existing role, case-insensitively', () => {
  const existing = [role('1', 'poker'), role('2', 'Other')];
  const r = resolveRoleName(existing, 'Poker');
  assert.equal(r.action, 'reuse');
  assert.equal(r.role.id, '1');
});

test('resolveRoleName: creates when nothing matches', () => {
  const r = resolveRoleName([role('2', 'Other')], 'Poker');
  assert.equal(r.action, 'create');
});

test('resolveRoleName: never reuses a managed integration role', () => {
  // A bot's own auto-role can share a name; handing it out is impossible.
  const r = resolveRoleName([role('1', 'Poker', { managed: true })], 'Poker');
  assert.equal(r.action, 'create');
});

test('resolveRoleName: never reuses @everyone', () => {
  const r = resolveRoleName([role('g', '@everyone')], '@everyone');
  assert.equal(r.action, 'create');
});

test('resolveRoleName: matches on the trimmed name', () => {
  const r = resolveRoleName([role('1', 'Running Hot')], '  running hot  ');
  assert.equal(r.action, 'reuse');
  assert.equal(r.role.id, '1');
});

// --- canAssign ---

test('canAssign: a role below the bot can be handed out', () => {
  assert.equal(canAssign(role('1', 'Poker', { position: 3 }), 7), true);
});

test('canAssign: a role above the bot cannot, and the bot cannot move it', () => {
  assert.equal(canAssign(role('1', 'Poker', { position: 9 }), 7), false);
});

test('canAssign: equal position is not assignable either', () => {
  assert.equal(canAssign(role('1', 'Poker', { position: 7 }), 7), false);
});

// --- membersNeedingRole ---

const member = (id, roleIds = [], isBot = false) => ({ id, isBot, roleIds });

test('membersNeedingRole: everyone without it', () => {
  const members = [member('a'), member('b', ['r1']), member('c')];
  assert.deepEqual(membersNeedingRole(members, 'r1').map((m) => m.id), ['a', 'c']);
});

test('membersNeedingRole: skips bots', () => {
  const members = [member('a'), member('bot', [], true)];
  assert.deepEqual(membersNeedingRole(members, 'r1').map((m) => m.id), ['a']);
});

test('membersNeedingRole: a re-run assigns nothing', () => {
  const members = [member('a', ['r1']), member('b', ['r1'])];
  assert.deepEqual(membersNeedingRole(members, 'r1'), []);
});
