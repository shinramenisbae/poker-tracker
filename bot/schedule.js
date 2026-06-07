// Scheduling helper: compute the delay until the next occurrence of a given
// wall-clock hour in a timezone, honouring DST (e.g. Pacific/Auckland switches
// between NZST/NZDT). No external deps — uses Intl to read the zone's current
// offset.
//
// Exported as pure functions so the daily-reminder timing is unit-testable
// without waiting real hours.

// Returns the offset (in minutes, east-of-UTC positive) that `timeZone` is at
// for the given absolute instant. e.g. Pacific/Auckland → 780 (NZST) or 720+60.
function tzOffsetMinutes(date, timeZone) {
  // Format the instant as wall-clock time in the target zone, then diff against
  // the same fields interpreted as UTC. That difference is the zone's offset.
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = Object.fromEntries(dtf.formatToParts(date).map((p) => [p.type, p.value]));
  // 'hour' can come back as '24' at midnight in some environments; normalize.
  const hour = parts.hour === '24' ? '00' : parts.hour;
  const asUTC = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(hour), Number(parts.minute), Number(parts.second)
  );
  return Math.round((asUTC - date.getTime()) / 60000);
}

/**
 * Milliseconds from `now` until the next time it is `hour:00:00` wall-clock in
 * `timeZone`. If it is exactly that hour now, returns the full interval to the
 * next day (never 0/negative), so a scheduler can't busy-loop.
 *
 * @param {Date} now
 * @param {number} hour 0..23 local hour in the zone
 * @param {string} timeZone IANA zone, e.g. 'Pacific/Auckland'
 * @returns {number} delay in ms (> 0)
 */
function msUntilNextLocalHour(now, hour, timeZone) {
  const offsetMin = tzOffsetMinutes(now, timeZone);
  // Current wall-clock time in the zone:
  const local = new Date(now.getTime() + offsetMin * 60000);
  // Build the target instant for *today* at hour:00 in the zone, expressed in
  // UTC by subtracting the offset.
  let targetLocalMidnightUTC = Date.UTC(
    local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hour, 0, 0
  );
  let targetUTC = targetLocalMidnightUTC - offsetMin * 60000;
  if (targetUTC <= now.getTime()) {
    // Already past today's target — go to tomorrow.
    targetLocalMidnightUTC = Date.UTC(
      local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1, hour, 0, 0
    );
    // Recompute offset at ~tomorrow in case a DST transition lands in between.
    const approx = new Date(targetLocalMidnightUTC - offsetMin * 60000);
    const offsetTomorrow = tzOffsetMinutes(approx, timeZone);
    targetUTC = targetLocalMidnightUTC - offsetTomorrow * 60000;
  }
  return targetUTC - now.getTime();
}

export { msUntilNextLocalHour, tzOffsetMinutes };
