// May this session's banker be changed by hand, and to whom.
//
// The banker is normally the biggest winner, chosen when the session ends. That
// is sometimes the wrong person socially: a newcomer wins big, and the group
// would rather a regular held everyone's money. So it can be re-pointed — but
// only while doing so is harmless.
//
// The line is the first payment. Once someone has sent money to the named
// banker, changing the name sends the rest of the group to a different person
// and leaves the first payment stranded. Unmarking that payment is the way
// back, which is why the refusal says so.
//
// Pure, so every refusal is testable without a database.

/**
 * @param {object} args
 * @param {{status: string, settledAt: string|null, players: {id: string}[]}} args.session
 * @param {string} args.playerId the proposed banker
 * @param {number} args.paidCount rows in session_payments for this session
 * @returns {{ok: true} | {ok: false, code: string, reason: string}}
 */
function canChangeBanker({ session, playerId, paidCount = 0 } = {}) {
  if (!session || session.status !== 'completed') {
    return {
      ok: false,
      code: 'ACTIVE',
      reason: 'This session is still in progress — the banker is decided when it ends.',
    };
  }

  if (session.settledAt) {
    return {
      ok: false,
      code: 'SETTLED',
      reason: 'The books are closed on this session. Reopen it with `/finish reopen:true` first.',
    };
  }

  // Ordered before the unknown-player check on purpose: when both are wrong,
  // the caller should hear the one they can act on.
  if (paidCount > 0) {
    return {
      ok: false,
      code: 'PAID',
      reason: paidCount === 1
        ? 'Someone has already paid the current banker. Unmark that payment first.'
        : `${paidCount} people have already paid the current banker. Unmark those payments first.`,
    };
  }

  const players = session.players || [];
  if (!players.some((p) => p.id === playerId)) {
    return {
      ok: false,
      code: 'UNKNOWN_PLAYER',
      reason: 'That player did not play in this session.',
    };
  }

  return { ok: true };
}

module.exports = { canChangeBanker };
