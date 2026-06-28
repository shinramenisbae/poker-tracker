// EV computer: walks parsed hands, identifies eligible all-in moments,
// computes per-player actual + expected net for each hand, and produces
// per-player time series suitable for the chart.

const { parseHandLog } = require('./parse');
const { computeEquity } = require('./equity');

// Sum a player's chip contributions in a hand from action log.
// Includes blinds, straddles, bets, calls, raises (note: "raises to X" is the
// new TOTAL, not delta).
function contributionByPlayer(hand) {
  const contrib = {};
  // Track per-street running contribution per player, because "raises to X"
  // resets the player's street contribution to X (not adds X).
  const perStreet = {};
  let curStreet = 'preflop';
  for (const a of hand.actions) {
    if (a.street !== curStreet) {
      // Close out previous street totals
      for (const [p, v] of Object.entries(perStreet)) {
        contrib[p] = (contrib[p] || 0) + v;
      }
      Object.keys(perStreet).forEach((k) => delete perStreet[k]);
      curStreet = a.street;
    }
    const p = a.playerKey;
    const amt = Number(a.amount) || 0;
    if (a.type === 'sb' || a.type === 'bb' || a.type === 'missedBlind' || a.type === 'straddle' || a.type === 'bombPotAnte') {
      // Forced posts — additive (only one per player per street).
      perStreet[p] = (perStreet[p] || 0) + amt;
    } else if (a.type === 'bets') {
      // First voluntary bet on this street.
      perStreet[p] = (perStreet[p] || 0) + amt;
    } else if (a.type === 'calls') {
      // PokerNow "calls X" means "calls TO X" — the street total for this
      // player becomes X (not += X). The exception is all-in for less than the
      // call amount: PokerNow logs "calls X" where X is the all-in commit
      // (≤ the bet to call). Either way, the new street total = X.
      perStreet[p] = amt;
    } else if (a.type === 'raise') {
      perStreet[p] = amt;
    } else if (a.type === 'folds' || a.type === 'checks') {
      // no contribution
    }
  }
  for (const [p, v] of Object.entries(perStreet)) {
    contrib[p] = (contrib[p] || 0) + v;
  }
  return contrib;
}

// Per-hand net for a player (actual chip change for this hand).
function actualNetByPlayer(hand, contrib) {
  const net = {};
  const bountyR = hand.bountyReceived || {};
  const bountyP = hand.bountyPaid || {};
  // Include players who only received/paid a bounty without being in the hand's
  // action stream (rare but possible).
  const allKeys = new Set([
    ...hand.players,
    ...Object.keys(bountyR),
    ...Object.keys(bountyP),
  ]);
  for (const p of allKeys) {
    const collected = hand.collected[p] || 0;
    const uncalled = hand.uncalledReturned[p] || 0;
    const bIn = bountyR[p] || 0;
    const bOut = bountyP[p] || 0;
    net[p] = collected + uncalled + bIn - (contrib[p] || 0) - bOut;
  }
  return net;
}

/**
 * Compute EV for one hand, if it's eligible (≥2 all-in players who showed
 * hole cards AND the board wasn't fully dealt at the moment of their all-in).
 *
 * Returns null if not eligible.
 * Returns { perPlayer: { playerKey: { expectedNet, actualNet, equity } }, eligible: true }
 * for eligible hands.
 */
function computeHandEv(hand, opts = {}) {
  const contrib = contributionByPlayer(hand);
  const actualNet = actualNetByPlayer(hand, contrib);

  // Eligibility:
  // - at least 1 *declared* all-in (PokerNow only tags "...and go all in" when
  //   that action puts the player's whole stack in; a bigger stack that CALLS
  //   the shove keeps chips behind and is logged as a plain "calls X", so it is
  //   NOT in allInPlayers). The common shove-and-cover race therefore has just
  //   one declared all-in — requiring 2 here silently dropped those hands. The
  //   `showdownCommitted >= 2` check below is what actually guarantees a real
  //   two-way all-in showdown.
  // - every declared all-in player showed hole cards
  // - the board at the time of the all-in is < 5 cards (else no card to come,
  //   so actual == expected — no variance to chart)
  if (hand.allInPlayers.length < 1) return null;

  // "Showdown committed" = anyone who reached showdown without folding.
  // That includes players who CALLED an all-in (they're committed even though
  // their action wasn't tagged all-in). Identify via: showed cards + never
  // folded in this hand.
  const foldedSet = new Set(
    hand.actions.filter((a) => a.type === 'folds').map((a) => a.playerKey)
  );
  const showdownCommitted = Object.keys(hand.shownCards).filter((p) => !foldedSet.has(p));

  // Eligibility (user spec): at least one declared all-in AND ≥2 committed
  // players shown cards. If any committed player didn't show, equity calc
  // would be wrong, so skip.
  const anyAllInWithCards = hand.allInPlayers.some((p) => hand.shownCards[p] && !foldedSet.has(p));
  if (!anyAllInWithCards) return null;
  if (showdownCommitted.length < 2) return null;

  // Make sure every all-in player also showed (otherwise we'd model a smaller
  // showdown than really happened).
  const allInCommitted = hand.allInPlayers.filter((p) => !foldedSet.has(p));
  if (!allInCommitted.every((p) => hand.shownCards[p])) return null;

  const allInWithCards = showdownCommitted;

  // Use the board state at the FIRST all-in (most conservative — that's the
  // earliest moment chips were committed irrevocably). If multiple all-ins
  // happened on different streets, the first one's snapshot is the right one
  // for equity purposes.
  // Match boardAtAllIn entries to allInPlayers by position.
  const firstAllInIdx = 0;
  const community = hand.boardAtAllIn[firstAllInIdx] || [];
  if (community.length >= 5) return null; // board fully dealt — deterministic, skip

  const holeCards = allInWithCards.map((p) => hand.shownCards[p]);
  const equity = computeEquity({
    holeCards,
    communityCards: community,
    gameType: hand.gameType,
    samples: opts.samples || 8000,
  });

  // Compute "pot eligible to be won by all-in players"
  // For simplicity: sum of contributions from all players who didn't fold-out
  // before the all-in (approximated as: sum of all collected + uncalled
  // returned across all all-in players + everyone else's contributions).
  // Concretely: total pot put in by anyone = sum of contributions.
  // Pot returned uncalled goes back, so "live" pot = sum(contrib) - sum(uncalledReturned)
  let totalPot = 0;
  for (const v of Object.values(contrib)) totalPot += v;
  for (const v of Object.values(hand.uncalledReturned || {})) totalPot -= v;

  // Each all-in player's expected NET = equity * potShare - their contribution
  // For heads-up: each player's share of the pot = whole pot (modulo side
  // pots which we don't fully model in v1). For multi-way we still use
  // total pot as a reasonable approximation.
  const bountyR = hand.bountyReceived || {};
  const bountyP = hand.bountyPaid || {};
  const perPlayer = {};
  allInWithCards.forEach((p, i) => {
    const eq = equity[i];
    // Effective contribution = what actually stayed in the pot. PokerNow logs
    // record "raises to X" at the player's intended raise amount, but if no one
    // had enough chips to match, the unmatched portion comes back via
    // "Uncalled bet of Y returned". The actualNet formula already handles this;
    // expectedNet must use the same effective amount or the two sums won't
    // reconcile to zero (zero-sum game). Bounty payments (7-2 etc.) are
    // independent of equity — pass them through unchanged.
    const effectiveContrib = (contrib[p] || 0) - (hand.uncalledReturned[p] || 0);
    const expectedGross = eq * totalPot;
    const bountyNet = (bountyR[p] || 0) - (bountyP[p] || 0);
    const expectedNet = expectedGross - effectiveContrib + bountyNet;
    perPlayer[p] = {
      equity: eq,
      expectedNet,
      actualNet: actualNet[p],
      totalPot,
      contribution: effectiveContrib,
    };
  });

  return { eligible: true, perPlayer, totalPot };
}

/**
 * Produce per-player chart series across all hands in the log.
 *
 * For each hand, compute:
 *   - actualNet (always)
 *   - expectedNet (= equity-weighted if eligible all-in, else = actualNet)
 *
 * Returns:
 *   {
 *     players: [playerKey, ...],
 *     hands: [{ handNumber, perPlayer: { playerKey: { actualNet, expectedNet, isAllInEv } } }, ...]
 *   }
 */
function computeSessionEv(csvText, opts = {}) {
  const hands = parseHandLog(csvText);
  const playersSet = new Set();
  const handRows = [];

  for (const hand of hands) {
    const contrib = contributionByPlayer(hand);
    const actualNet = actualNetByPlayer(hand, contrib);

    const evResult = computeHandEv(hand, opts);
    const perPlayer = {};
    // Use keys from actualNet (broader than hand.players — includes bounty
    // payers/receivers who may not have been seated for this hand).
    for (const p of Object.keys(actualNet)) {
      playersSet.add(p);
      const an = actualNet[p] || 0;
      let en = an; // default: non-all-in hands → expected = actual
      let isAllInEv = false;
      if (evResult && evResult.perPlayer[p]) {
        en = evResult.perPlayer[p].expectedNet;
        isAllInEv = true;
      }
      perPlayer[p] = { actualNet: an, expectedNet: en, isAllInEv };
    }
    handRows.push({
      handNumber: hand.handNumber,
      handId: hand.handId,
      gameType: hand.gameType,
      hasAllInEv: !!evResult,
      perPlayer,
    });
  }

  return {
    players: [...playersSet],
    hands: handRows,
  };
}

module.exports = { parseHandLog, computeHandEv, computeSessionEv };
