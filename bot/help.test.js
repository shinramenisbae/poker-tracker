import { test } from 'node:test';
import assert from 'node:assert/strict';
import { helpText } from './help.js';

const settings = {
  channelId: '123',
  reminderHour: 10,
  reminderTz: 'Pacific/Auckland',
  chipDivisor: 100,
};
const uiBase = 'https://triber-poker-a.duckdns.org';

test('helpText: the player topic names this server\'s channel', () => {
  const s = helpText({ topic: 'player', settings, uiBase });
  assert.match(s, /<#123>/);
});

test('helpText: the player topic gives this server\'s reminder schedule', () => {
  // A server on a different schedule must get its own answer, which is the
  // whole reason this is generated rather than written down once.
  const s = helpText({ topic: 'player', settings: { ...settings, reminderHour: 18, reminderTz: 'Europe/London' }, uiBase });
  assert.match(s, /18:00/);
  assert.match(s, /Europe\/London/);
});

test('helpText: an unconfigured channel reads as not configured, never a blank mention', () => {
  const s = helpText({ topic: 'player', settings: { ...settings, channelId: '' }, uiBase });
  assert.doesNotMatch(s, /<#>/);
  assert.match(s, /not configured/i);
});

test('helpText: the player topic covers the commands players actually run', () => {
  const s = helpText({ topic: 'player', settings, uiBase });
  for (const cmd of ['/link', '/paid', '/unpaid', '/finish']) {
    assert.ok(s.includes(cmd), `player help should mention ${cmd}`);
  }
});

test('helpText: the player topic does not bury players in admin setup', () => {
  const s = helpText({ topic: 'player', settings, uiBase });
  assert.ok(!s.includes('/setup-roles'), 'player help should not cover role setup');
});

test('helpText: the admin topic covers the setup commands', () => {
  const s = helpText({ topic: 'admin', settings, uiBase });
  for (const cmd of ['/setup', '/setup-roles', '/settings']) {
    assert.ok(s.includes(cmd), `admin help should mention ${cmd}`);
  }
});

test('helpText: the admin topic warns about role position, which fails silently', () => {
  const s = helpText({ topic: 'admin', settings, uiBase });
  assert.match(s, /above/i);
});

test('helpText: links to this guild\'s own tracker, not a hardcoded one', () => {
  const s = helpText({ topic: 'player', settings, uiBase: 'https://tribepoker-b.duckdns.org' });
  assert.match(s, /tribepoker-b\.duckdns\.org/);
});

test('helpText: an unknown or missing topic falls back to player rather than erroring', () => {
  assert.equal(helpText({ topic: 'nonsense', settings, uiBase }), helpText({ topic: 'player', settings, uiBase }));
  assert.equal(helpText({ settings, uiBase }), helpText({ topic: 'player', settings, uiBase }));
});

test('helpText: both topics fit inside Discord\'s 2000-character message limit', () => {
  // Prose grows. Over the limit the whole reply vanishes at runtime rather
  // than truncating, so this is a real failure mode, not a formality.
  for (const topic of ['player', 'admin']) {
    const len = helpText({ topic, settings, uiBase }).length;
    assert.ok(len <= 2000, `${topic} help is ${len} chars, over Discord's 2000 limit`);
  }
});
