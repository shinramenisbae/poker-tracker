import { test } from 'node:test';
import assert from 'node:assert/strict';
import { msUntilNextLocalHour, tzOffsetMinutes } from './schedule.js';

test('tzOffsetMinutes: Auckland is +780 (NZST) in mid-winter', () => {
  // July = NZ winter, standard time UTC+12.
  const d = new Date('2026-07-01T00:00:00Z');
  assert.equal(tzOffsetMinutes(d, 'Pacific/Auckland'), 720);
});

test('tzOffsetMinutes: Auckland is +780 (NZDT) in mid-summer', () => {
  // January = NZ summer, daylight time UTC+13.
  const d = new Date('2026-01-01T00:00:00Z');
  assert.equal(tzOffsetMinutes(d, 'Pacific/Auckland'), 780);
});

test('tzOffsetMinutes: UTC is always 0', () => {
  assert.equal(tzOffsetMinutes(new Date('2026-06-07T12:00:00Z'), 'UTC'), 0);
});

test('msUntilNextLocalHour: always strictly positive and within 24h', () => {
  const now = new Date('2026-06-07T03:17:00Z');
  const ms = msUntilNextLocalHour(now, 10, 'Pacific/Auckland');
  assert.ok(ms > 0, 'delay must be positive');
  assert.ok(ms <= 24 * 3600000, 'delay must be within 24h');
});

test('msUntilNextLocalHour: lands exactly on 10:00 Auckland wall-clock', () => {
  const now = new Date('2026-06-07T03:17:00Z'); // winter (UTC+12) → 15:17 NZST
  const target = new Date(now.getTime() + msUntilNextLocalHour(now, 10, 'Pacific/Auckland'));
  const hourInTz = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Pacific/Auckland', hour: '2-digit', hour12: false,
  }).format(target);
  // Normalize '24' → '00' just in case.
  assert.equal(hourInTz === '24' ? '00' : hourInTz, '10');
});

test('msUntilNextLocalHour: when already past 10:00, schedules next day (not negative)', () => {
  // 22:00 NZST is well past 10:00; next fire must be ~12h away, positive.
  const now = new Date('2026-07-01T10:00:00Z'); // 22:00 NZST
  const ms = msUntilNextLocalHour(now, 10, 'Pacific/Auckland');
  assert.ok(ms > 0 && ms <= 24 * 3600000);
});
