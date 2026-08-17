import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSettings, isConfigured, envDefaultsFor } from './settings.js';

const ENV = {
  DISCORD_CHANNEL_ID: 'env-channel',
  DISCORD_POKER_ROLE_ID: 'env-poker',
  DISCORD_HOT_ROLE_ID: 'env-hot',
  DISCORD_COLD_ROLE_ID: 'env-cold',
  PAYMENT_REMINDER_HOUR: '10',
  PAYMENT_REMINDER_TZ: 'Pacific/Auckland',
  POKERNOW_CHIP_DIVISOR: '100',
};

test('no DB row → env is used verbatim (existing deployments unaffected)', () => {
  const s = resolveSettings(null, ENV);
  assert.equal(s.channelId, 'env-channel');
  assert.equal(s.pokerRoleId, 'env-poker');
  assert.equal(s.reminderHour, 10);
  assert.equal(s.reminderTz, 'Pacific/Auckland');
  assert.equal(s.chipDivisor, 100);
  assert.equal(s.source.channelId, 'env');
});

test('/setup values win over env, per field', () => {
  const s = resolveSettings({ channelId: 'setup-channel', hotRoleId: 'setup-hot' }, ENV);
  assert.equal(s.channelId, 'setup-channel');
  assert.equal(s.hotRoleId, 'setup-hot');
  // Untouched fields still come from env.
  assert.equal(s.pokerRoleId, 'env-poker');
  assert.equal(s.coldRoleId, 'env-cold');
  assert.equal(s.source.channelId, 'setup');
  assert.equal(s.source.pokerRoleId, 'env');
});

test('null and empty DB columns fall through to env, not blank config', () => {
  const s = resolveSettings({ channelId: null, pokerRoleId: '' }, ENV);
  assert.equal(s.channelId, 'env-channel');
  assert.equal(s.pokerRoleId, 'env-poker');
});

test('a fresh instance with no env and no /setup is simply unconfigured', () => {
  const s = resolveSettings(null, {});
  assert.equal(s.channelId, '');
  assert.equal(isConfigured(s), false);
  // Safe defaults so the scheduler still has something valid.
  assert.equal(s.reminderHour, 10);
  assert.equal(s.reminderTz, 'Pacific/Auckland');
  assert.equal(s.chipDivisor, 100);
});

test('isConfigured is true as soon as a channel exists (either source)', () => {
  assert.equal(isConfigured(resolveSettings({ channelId: 'c' }, {})), true);
  assert.equal(isConfigured(resolveSettings(null, { DISCORD_CHANNEL_ID: 'c' })), true);
});

test('reminder hour: DB overrides env, and 0 (midnight) is honoured', () => {
  assert.equal(resolveSettings({ reminderHour: 6 }, ENV).reminderHour, 6);
  assert.equal(resolveSettings({ reminderHour: 0 }, ENV).reminderHour, 0);
});

test('an out-of-range or junk reminder hour falls back to 10, never NaN', () => {
  assert.equal(resolveSettings({ reminderHour: 99 }, ENV).reminderHour, 10);
  assert.equal(resolveSettings({ reminderHour: -1 }, ENV).reminderHour, 10);
  assert.equal(resolveSettings(null, { ...ENV, PAYMENT_REMINDER_HOUR: 'banana' }).reminderHour, 10);
});

test('chip divisor: overridable, but junk/zero falls back to 100', () => {
  assert.equal(resolveSettings({ chipDivisor: 1 }, ENV).chipDivisor, 1);
  assert.equal(resolveSettings({ chipDivisor: 0 }, ENV).chipDivisor, 100);
  assert.equal(resolveSettings(null, { ...ENV, POKERNOW_CHIP_DIVISOR: 'x' }).chipDivisor, 100);
});

test('guild identity is reported only from /setup', () => {
  const s = resolveSettings({ guildId: 'g1', guildName: 'Tribe B' }, ENV);
  assert.equal(s.guildId, 'g1');
  assert.equal(s.guildName, 'Tribe B');
  assert.equal(resolveSettings(null, ENV).guildId, '');
});

// --- which guild the env block belongs to ---
//
// The env vars describe ONE Discord server. With several guilds served by one
// process, handing those defaults to a guild that hasn't run /setup would point
// it at another group's channel — which is how group B's tracker ended up
// scanning group A's threads.

test('envDefaultsFor: legacy mode gives the env block to the only guild there is', () => {
  const env = envDefaultsFor({ legacy: true, guildId: null }, ENV);
  assert.equal(env.DISCORD_CHANNEL_ID, 'env-channel');
});

test('envDefaultsFor: the guild that owns the env block still inherits it', () => {
  const env = envDefaultsFor({ legacy: false, envGuildId: 'guild-a', guildId: 'guild-a' }, ENV);
  assert.equal(env.DISCORD_CHANNEL_ID, 'env-channel');
});

test('envDefaultsFor: another guild inherits nothing', () => {
  const env = envDefaultsFor({ legacy: false, envGuildId: 'guild-a', guildId: 'guild-b' }, ENV);
  assert.deepEqual(env, {});
  // and so resolves to no watched channel at all, rather than group A's
  assert.equal(isConfigured(resolveSettings(null, env)), false);
});

test('envDefaultsFor: fails closed when no guild claims the env block', () => {
  const env = envDefaultsFor({ legacy: false, envGuildId: '', guildId: 'guild-a' }, ENV);
  assert.deepEqual(env, {});
});
