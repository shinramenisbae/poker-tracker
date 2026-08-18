// What to do, in the order it happens.
//
// Discord's own command picker already lists every command with a description,
// so repeating that here would just be a second copy to keep in sync. What it
// can't tell you is the sequence, or this server's answers — when reminders
// fire, which channel is watched. Both come from the guild's /setup config, so
// two groups on the same bot get genuinely different help.
//
// Kept out of index.js because prose bloats a file without adding behaviour.

const channelOf = (s) => (s?.channelId ? `<#${s.channelId}>` : '_not configured_');
const scheduleOf = (s) => `${String(s?.reminderHour ?? 10).padStart(2, '0')}:00 ${s?.reminderTz || 'Pacific/Auckland'}`;

function playerHelp(settings, uiBase) {
  return [
    '🃏 **Using the poker bot**',
    '',
    `**1. After a session** — drop the PokerNow \`ledger_*.csv\` into ${channelOf(settings)}.`,
    'I read it, create the session and post the results in a thread. Adding the',
    '`poker_now_log_*.csv` too gets you hand history and all-in EV.',
    '',
    '**2. Once, so I know who you are** — `/link player:<your name>`.',
    'Without it I can\'t ping you about debts or give you streak roles.',
    '',
    '**3. When you\'ve sent your money** — `/paid` in that session\'s thread.',
    'Check who\'s still outstanding with `/unpaid`.',
    '',
    `**4. Reminders** — every day at ${scheduleOf(settings)} I ping anyone who still`,
    'owes the bank player, until everyone\'s marked paid.',
    '',
    '**5. Closing it out** — the bank player runs `/finish` once they\'ve been paid',
    'by everyone and paid the winners out.',
    '',
    `📊 Full stats, charts and history: ${uiBase}`,
    '',
    '_Admin setting things up? Try_ `/help topic:admin`_._',
  ].join('\n');
}

function adminHelp(settings, uiBase) {
  return [
    '⚙️ **Setting the poker bot up**',
    '',
    '**1. Point me at a channel** — `/setup channel:#your-poker-channel`.',
    `Currently watching ${channelOf(settings)}. I only read threads under it.`,
    '',
    '**2. Create the roles** — `/setup-roles` opens a form for the three role',
    'names, creates them, and hands the results ping role to everyone.',
    '',
    '**3. Check anything** — `/settings` shows the current config.',
    '',
    '**Permissions I need:** Manage Roles (streak roles) and Manage Threads',
    '(fix & repost). ⚠️ My own role must sit **above** the Running Hot and',
    'Running Cold roles, or assigning them fails silently. Roles I create myself',
    'land in the right place automatically.',
    '',
    `**Other \`/setup\` options:** \`reminder_hour\` and \`timezone\` (now ${scheduleOf(settings)}),`,
    `and \`chip_divisor\` for PokerNow chips per $1 (now ${settings?.chipDivisor ?? 100}).`,
    '',
    `📊 Tracker: ${uiBase}`,
  ].join('\n');
}

/**
 * @param {{topic?: string, settings?: object, uiBase?: string}} args
 * @returns {string} a Discord message, under the 2000-character limit
 */
function helpText({ topic = 'player', settings = {}, uiBase = '' } = {}) {
  return topic === 'admin' ? adminHelp(settings, uiBase) : playerHelp(settings, uiBase);
}

export { helpText };
