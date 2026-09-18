// The results message: what gets posted in a session's thread.
//
// Lifted out of index.js so the first post and any later edit build the text
// the same way — the banker can be changed by hand after a session, and the
// posted message has to be corrected rather than left naming the wrong person.
//
// Pure: no Discord, no network, so every line of the message is testable.

import { calculateSettlements } from './settlement.js';

function computePerPlayerResults(session) {
  // Returns [{id, name, profit}] sorted by profit desc
  return (session.players || [])
    .map((p) => {
      const buyIn = (p.buyIns || []).reduce((s, b) => s + (Number(b.amount) || 0), 0);
      const cashOut = p.cashOut ? Number(p.cashOut.amount) || 0 : Number(p.cashOutAmount) || 0;
      return { id: p.id, name: p.name, profit: cashOut - buyIn };
    })
    .sort((a, b) => b.profit - a.profit);
}

function formatMoney(n) {
  const sign = n >= 0 ? '+' : '−';
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

/** Plain dollar amount (no +/- sign), for cash/bank annotations. */
function formatCash(n) {
  return `$${Math.abs(Number(n) || 0).toFixed(2)}`;
}

function formatResultsMessage(session, results, bankAccounts) {
  const winners = results.filter((r) => r.profit > 0.005);
  const losers = results.filter((r) => r.profit < -0.005);
  const evens = results.filter((r) => Math.abs(r.profit) <= 0.005);

  // The stored banker wins over the biggest winner. Sessions are re-pointed at
  // a regular when a newcomer wins big, and everything else — reminders,
  // /unpaid, /finish, the debt board — already reads bankPlayerId. Until this
  // did too, an override left the thread telling people to pay the wrong
  // person. An online session has no stored banker, so it still falls back.
  const stored = session.bankPlayerId
    ? results.find((r) => r.id === session.bankPlayerId)
    : null;
  const bankPlayer = stored || winners[0];
  const bankInfo = bankPlayer ? bankAccounts[bankPlayer.name] : null;

  // Settlement rows (cash vs bank split), keyed by player name for lookup. This
  // mirrors the Results page exactly, so e.g. a loser who paid partly in cash
  // shows what's already covered on the table vs still owed via bank transfer.
  const settlements = calculateSettlements(session);
  const settleByName = new Map(settlements.map((s) => [s.playerName, s]));

  let msg = `🎲 **Session results — ${session.date}**\n`;
  msg += session.gameType === 'online' ? '🌐 _Online session_\n\n' : '🪑 _In-person session_\n\n';

  if (winners.length > 0) {
    msg += '🏆 **Winners**\n';
    for (const w of winners) {
      const isBank = bankPlayer && w.id === bankPlayer.id;
      msg += `• ${w.name}: **${formatMoney(w.profit)}**`;
      if (isBank) {
        msg += `  🏦 _(bank player — collects from losers)_\n`;
      } else {
        // Show bank info inline so the bank player can transfer winnings.
        const info = bankAccounts[w.name];
        if (info) {
          msg += ` → ${info.displayName} \`${info.account}\`\n`;
        } else {
          msg += ` → _(no account on file)_\n`;
        }
      }
    }
    msg += '\n';
  }

  if (losers.length > 0) {
    msg += `💸 **Losers** _(pay ${bankPlayer ? bankPlayer.name : 'the bank player'})_\n`;
    for (const l of losers) {
      msg += `• ${l.name}: ${formatMoney(l.profit)}`;
      // Annotate how the loss settles: cash already on the table vs bank transfer
      // still owed. Only show when there's a meaningful cash component, so the
      // common all-bank loser stays a clean one-liner.
      const s = settleByName.get(l.name);
      if (s && s.cashBuyIn > 0.005) {
        const owed = s.bankOwed || 0;
        if (owed > 0.005) {
          msg += `  _(paid ${formatCash(s.cashBuyIn)} cash, owes ${formatCash(owed)} via bank)_`;
        } else {
          msg += `  _(paid in cash on the table)_`;
        }
      }
      msg += '\n';
    }
    msg += '\n';
  }

  if (evens.length > 0) {
    msg += `⚖️ **Even**: ${evens.map((e) => e.name).join(', ')}\n\n`;
  }

  if (bankPlayer) {
    msg += `🏦 **Bank player: ${bankPlayer.name}**\n`;
    if (bankInfo) {
      msg += `   ${bankInfo.displayName}\n`;
      msg += `   \`${bankInfo.account}\`\n`;
    } else {
      msg += `   _(no bank account on file — losers, please ask ${bankPlayer.name} for their details)_\n`;
    }
  }

  return msg;
}

// Everything the original message carried after the results themselves.
const STREAK_HEADING = '\n📈 **Streak watch**';
const HELP_HINT = '\n\n\n_New here? Run `/help`._';

/**
 * Puts a corrected results body back into a message that is already posted.
 *
 * Two things are carried over rather than recomputed. The role mention, so the
 * edit doesn't re-ping a thread. And the streak lines, which were true the
 * night they were posted — recalculating them weeks later would rewrite
 * history, and might say nothing at all now that later sessions exist.
 *
 * @param {string} original the message as posted
 * @param {string} rebuilt the new results body
 * @returns {string}
 */
function rebuildResultsMessage(original, rebuilt) {
  const text = String(original || '');

  const mentionMatch = text.match(/^(<@&\d+>\n)/);
  const mention = mentionMatch ? mentionMatch[1] : '';

  let tail = '';
  const streakAt = text.indexOf(STREAK_HEADING);
  if (streakAt !== -1) {
    tail = text.slice(streakAt);
  } else if (text.includes(HELP_HINT)) {
    tail = HELP_HINT;
  }

  return `${mention}${rebuilt}${tail}`;
}

export { computePerPlayerResults, formatMoney, formatCash, formatResultsMessage, rebuildResultsMessage };
