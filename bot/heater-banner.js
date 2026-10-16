// The banner for a run nobody should miss.
//
// A hot streak is announced from 3 wins in a row, as one line under "Streak
// watch" at the foot of the results post — fine for a heater, easy to scroll
// past for a run that has gone on for weeks. From the sixth straight win the
// player gets a headline at the top of the post instead, pinging them when
// their Discord account is linked, and it comes back with the count raised on
// every win after that until the run ends.
//
// Pure: transitions from streaks.js in, Discord text out.

/** Wins in a row before the banner replaces the streak-watch line. */
export const BIG_HEATER_AT = 6;

/** A hot run still going (just reached or extended) at BIG_HEATER_AT or more. */
export function isBigHeater(t) {
  return t.kind === 'hot'
    && (t.event === 'started' || t.event === 'extended')
    && t.length >= BIG_HEATER_AT;
}

/** Big heaters get the banner; everything else stays in streak watch. */
export function splitBigHeaters(transitions = []) {
  const big = [];
  const rest = [];
  for (const t of transitions) (isBigHeater(t) ? big : rest).push(t);
  return { big, rest };
}

// One per count, chosen by the count rather than at random, so reposting a
// session's results says the same thing it said the first time.
const SUBLINES = [
  'The table is formally requesting an audit.',
  'At this point the rest of you are just donating.',
  'Someone check their sleeves.',
  'This is no longer a heater. This is a climate event.',
];

/**
 * @param {{playerName: string, length: number}} t
 * @param {string|null} discordUserId pinged when the player has linked their account
 */
export function heaterBanner(t, discordUserId = null) {
  const ping = discordUserId ? ` <@${discordUserId}>` : '';
  const subline = SUBLINES[(t.length - BIG_HEATER_AT) % SUBLINES.length];
  return [
    `# 🚨🔥 ${t.length} IN A ROW 🔥🚨`,
    `**${t.playerName}**${ping} has won ${t.length} sessions straight. ${subline}`,
  ].join('\n');
}
