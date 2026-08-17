// Effective bot configuration: what the server owner set with /setup, layered
// over the deployment's env vars.
//
// Precedence is DB-over-env, per field: a value set via /setup wins, anything
// not set there falls through to the env var. That keeps existing env-only
// deployments working exactly as before (their DB row simply doesn't exist)
// while letting a new server be configured entirely from Discord.
//
// Kept pure and separate from index.js so the precedence rules are testable
// without a Discord connection.

// A DB column counts as "set" only if it's a non-empty value. SQLite gives back
// null for unset columns, and an empty string is what you'd get from clearing a
// field — both should fall through to env rather than blanking the config.
function isSet(v) {
  return v !== null && v !== undefined && v !== '';
}

function pick(dbValue, envValue) {
  if (isSet(dbValue)) return String(dbValue);
  if (isSet(envValue)) return String(envValue);
  return '';
}

/**
 * @param {object|null} dbSettings row from /api/bot-settings (null when unset)
 * @param {object} env  the bot's process.env-derived defaults
 * @returns {{channelId, pokerRoleId, hotRoleId, coldRoleId, reminderHour,
 *            reminderTz, chipDivisor, guildId, guildName, source}}
 *   `source` maps each field to 'setup' | 'env' | 'default' for /settings output.
 */
function resolveSettings(dbSettings, env = {}) {
  const db = dbSettings || {};

  // Note the explicit '' check before Number(): Number('') is 0, which would
  // sail through the 0-23 range test and silently schedule reminders at
  // midnight on an instance that has no config at all.
  const reminderHourRaw = pick(db.reminderHour, env.PAYMENT_REMINDER_HOUR);
  const parsedHour = reminderHourRaw === '' ? NaN : Number(reminderHourRaw);
  const reminderHour = Number.isInteger(parsedHour) && parsedHour >= 0 && parsedHour <= 23
    ? parsedHour
    : 10;

  const chipDivisorRaw = pick(db.chipDivisor, env.POKERNOW_CHIP_DIVISOR);
  const parsedDivisor = chipDivisorRaw === '' ? NaN : Number(chipDivisorRaw);
  const chipDivisor = Number.isFinite(parsedDivisor) && parsedDivisor > 0 ? parsedDivisor : 100;

  const source = (dbValue, envValue) => (isSet(dbValue) ? 'setup' : (isSet(envValue) ? 'env' : 'default'));

  return {
    guildId: pick(db.guildId, ''),
    guildName: pick(db.guildName, ''),
    channelId: pick(db.channelId, env.DISCORD_CHANNEL_ID),
    pokerRoleId: pick(db.pokerRoleId, env.DISCORD_POKER_ROLE_ID),
    hotRoleId: pick(db.hotRoleId, env.DISCORD_HOT_ROLE_ID),
    coldRoleId: pick(db.coldRoleId, env.DISCORD_COLD_ROLE_ID),
    reminderHour,
    reminderTz: pick(db.reminderTz, env.PAYMENT_REMINDER_TZ) || 'Pacific/Auckland',
    chipDivisor,
    source: {
      channelId: source(db.channelId, env.DISCORD_CHANNEL_ID),
      pokerRoleId: source(db.pokerRoleId, env.DISCORD_POKER_ROLE_ID),
      hotRoleId: source(db.hotRoleId, env.DISCORD_HOT_ROLE_ID),
      coldRoleId: source(db.coldRoleId, env.DISCORD_COLD_ROLE_ID),
      reminderHour: source(db.reminderHour, env.PAYMENT_REMINDER_HOUR),
      reminderTz: source(db.reminderTz, env.PAYMENT_REMINDER_TZ),
      chipDivisor: source(db.chipDivisor, env.POKERNOW_CHIP_DIVISOR),
    },
  };
}

/** The bot can't do anything useful without a channel to watch. */
function isConfigured(settings) {
  return Boolean(settings && settings.channelId);
}

export { resolveSettings, isConfigured };
