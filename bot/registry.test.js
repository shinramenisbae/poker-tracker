import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRegistry, trackerFor } from './registry.js';

const LEGACY_ENV = {
  TRACKER_API_BASE: 'https://a.example.com/api',
  TRACKER_UI_BASE: 'https://a.example.com',
};

const MULTI = JSON.stringify([
  { guildId: '111', apiBase: 'https://a.example.com/api', uiBase: 'https://a.example.com', label: 'Tribe A' },
  { guildId: '222', apiBase: 'https://b.example.com/api', uiBase: 'https://b.example.com', label: 'Tribe B' },
]);

test('legacy mode: no GUILD_TRACKERS → the single tracker serves any guild', () => {
  const r = buildRegistry(LEGACY_ENV);
  assert.equal(r.legacy, true);
  assert.equal(r.entries.length, 1);
  assert.equal(trackerFor(r, '999').apiBase, 'https://a.example.com/api');
  // Even with no guild context at all (e.g. an HTTP call with no guildId).
  assert.equal(trackerFor(r, null).apiBase, 'https://a.example.com/api');
});

test('configured mode: each guild resolves to its own tracker', () => {
  const r = buildRegistry({ GUILD_TRACKERS: MULTI });
  assert.equal(r.legacy, false);
  assert.equal(trackerFor(r, '111').apiBase, 'https://a.example.com/api');
  assert.equal(trackerFor(r, '222').apiBase, 'https://b.example.com/api');
  assert.equal(trackerFor(r, '222').label, 'Tribe B');
});

// The isolation guarantee: a server the operator hasn't authorised gets no
// tracker, so the bot can't read or write anyone's data on its behalf.
test('configured mode: an unlisted guild resolves to null', () => {
  const r = buildRegistry({ GUILD_TRACKERS: MULTI });
  assert.equal(trackerFor(r, '999'), null);
  assert.equal(trackerFor(r, null), null);
  assert.equal(trackerFor(r, undefined), null);
});

test('GUILD_TRACKERS overrides the legacy vars rather than merging', () => {
  const r = buildRegistry({ ...LEGACY_ENV, GUILD_TRACKERS: MULTI });
  assert.equal(r.legacy, false);
  assert.equal(r.entries.length, 2);
  assert.equal(trackerFor(r, '999'), null); // legacy fallback must NOT apply
});

test('trailing slashes are normalised so URLs never double up', () => {
  const r = buildRegistry({
    GUILD_TRACKERS: JSON.stringify([{ guildId: '1', apiBase: 'https://a.example.com/api/', uiBase: 'https://a.example.com/' }]),
  });
  assert.equal(trackerFor(r, '1').apiBase, 'https://a.example.com/api');
  assert.equal(trackerFor(r, '1').uiBase, 'https://a.example.com');
});

test('uiBase defaults to apiBase minus /api when omitted', () => {
  const r = buildRegistry({ GUILD_TRACKERS: JSON.stringify([{ guildId: '1', apiBase: 'https://a.example.com/api' }]) });
  assert.equal(trackerFor(r, '1').uiBase, 'https://a.example.com');
});

test('guild ids are compared as strings (Discord snowflakes)', () => {
  const r = buildRegistry({ GUILD_TRACKERS: MULTI });
  assert.equal(trackerFor(r, 111).apiBase, 'https://a.example.com/api');
});

test('misconfiguration fails loudly instead of silently serving the wrong data', () => {
  assert.throws(() => buildRegistry({ GUILD_TRACKERS: '{not json' }), /not valid JSON/);
  assert.throws(() => buildRegistry({ GUILD_TRACKERS: '{"guildId":"1"}' }), /must be a JSON array/);
  assert.throws(() => buildRegistry({ GUILD_TRACKERS: '[{"apiBase":"https://x/api"}]' }), /missing guildId/);
  assert.throws(() => buildRegistry({ GUILD_TRACKERS: '[{"guildId":"1"}]' }), /missing apiBase/);
  // A duplicated guild would make routing depend on array order.
  assert.throws(
    () => buildRegistry({ GUILD_TRACKERS: '[{"guildId":"1","apiBase":"https://x/api"},{"guildId":"1","apiBase":"https://y/api"}]' }),
    /more than once/
  );
});

test('no config at all → no trackers, and nothing resolves', () => {
  const r = buildRegistry({});
  assert.equal(r.entries.length, 0);
  assert.equal(trackerFor(r, '111'), null);
});
