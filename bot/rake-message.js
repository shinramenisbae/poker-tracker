// What the bot posts in #rake.
//
// The channel used to be a hand-kept ledger: someone remembered the night's
// rake, added it up, and posted a total. Now every movement lands here as it
// happens, each post carrying the pile as it stands at that moment. Older posts
// keep the totals that were true when they were written; the newest one is
// always current.
//
// Pure: no Discord, no network, so the wording is testable.

const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;

// Discord hard-caps a message at 2000 characters and a group can be large, so
// the holder list gives way rather than costing someone their post.
const MAX_HOLDERS = 12;

function holderLine(balances) {
  const holders = balances.holders || [];
  const shown = holders.slice(0, MAX_HOLDERS).map((h) => `${h.name} ${money(h.balance)}`);
  const rest = holders.length - shown.length;
  if (rest > 0) shown.push(`and ${rest} more`);
  return shown.join(' · ');
}

function pileFooter(balances) {
  const line = holderLine(balances);
  return `Pile: **${money(balances.total)}**${line ? `\n${line}` : ''}`;
}

const nightName = (session) =>
  session.notes && session.notes.trim()
    ? `${session.notes.trim()} — ${session.date}`
    : session.date;

/** One session's rake, posted when the session ends. */
function formatSessionRakePost(session, rake, balances) {
  return [
    `🧾 **${nightName(session)}**`,
    `Rake ${money(rake.amount)} → held by **${rake.holder}**`,
    pileFooter(balances),
  ].join('\n');
}

/** Money leaving the pile. */
function formatSpendPost(entry, balances) {
  const note = entry.note ? ` — ${entry.note}` : '';
  return [
    `💸 ${entry.fromName} spent **${money(entry.amount)}**${note}`,
    pileFooter(balances),
  ].join('\n');
}

/** Rake moving from one person to another; the pile itself does not change. */
function formatGivePost(entry, balances) {
  return [
    `🤝 ${entry.fromName} → **${entry.toName}**: ${money(entry.amount)}`,
    pileFooter(balances),
  ].join('\n');
}

/** An admin correction, up or down. */
function formatAdjustPost(entry, balances) {
  const who = entry.toName || entry.fromName;
  const sign = entry.toName ? '+' : '−';
  const note = entry.note ? ` — ${entry.note}` : '';
  return [
    `✏️ Adjustment: ${who} ${sign}${money(entry.amount)}${note}`,
    pileFooter(balances),
  ].join('\n');
}

/** A night's rake corrected after the fact. */
function formatCorrectionPost(session, change, balances) {
  return [
    `✏️ Rake for **${nightName(session)}** corrected: ${money(change.from)} → ${money(change.to)}`,
    pileFooter(balances),
  ].join('\n');
}

/** The answer to /rake balance. */
function formatBalance(balances) {
  if (!balances.holders || balances.holders.length === 0) {
    return '🧾 There is nothing in the rake pile.';
  }
  const lines = (balances.holders || []).map((h) => `• ${h.name} ${money(h.balance)}`);
  return [`🧾 **Rake pile: ${money(balances.total)}**`, ...lines].join('\n');
}

/**
 * Whether a /rake reply also needs mirroring into the rake channel.
 *
 * The replies are public, so wherever the command was run everyone present
 * sees the result. Run inside the rake channel that reply is already the
 * record, and posting it again would print the same thing twice in a row.
 *
 * @param {{commandChannelId: string, rakeChannelId: string}} args
 * @returns {{shouldMirror: boolean, hint: string}} hint is appended to the reply
 */
function rakeMirror({ commandChannelId, rakeChannelId }) {
  if (!rakeChannelId) {
    return {
      shouldMirror: false,
      hint: '\n_(no rake channel set — run `/setup rake_channel:#rake` to keep these together)_',
    };
  }
  return { shouldMirror: String(commandChannelId) !== String(rakeChannelId), hint: '' };
}

export {
  rakeMirror,
  formatSessionRakePost,
  formatSpendPost,
  formatGivePost,
  formatAdjustPost,
  formatCorrectionPost,
  formatBalance,
};
