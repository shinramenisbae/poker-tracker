// Per-player poker style stats computed from a parsed PokerNow log.
//
// For each hand the player was dealt in:
//   - VPIP: did they voluntarily put money in preflop? (call, raise, or
//     voluntarily-posted straddle; blinds and bomb-pot antes don't count)
//   - PFR:  did they raise preflop?
//   - AF inputs: count their postflop bets, raises, and calls
//
// Output: { [playerKey]: { handsDealt, vpipHands, pfrHands,
//                          postflopBets, postflopRaises, postflopCalls } }

const { parseHandLog } = require('./parse');

function initCounters() {
  return {
    handsDealt: 0,
    vpipHands: 0,
    pfrHands: 0,
    postflopBets: 0,
    postflopRaises: 0,
    postflopCalls: 0,
  };
}

function computeStatsFromHands(hands) {
  const stats = {};

  for (const hand of hands) {
    // Count hands dealt for every seated player
    for (const playerKey of hand.players) {
      if (!stats[playerKey]) stats[playerKey] = initCounters();
      stats[playerKey].handsDealt++;
    }

    // VPIP / PFR — preflop street only
    const voluntaryEntries = new Set();
    const preflopRaisers = new Set();
    for (const a of hand.actions) {
      if (a.street !== 'preflop') continue;
      if (a.type === 'calls' || a.type === 'raise' || a.type === 'straddle') {
        voluntaryEntries.add(a.playerKey);
      }
      if (a.type === 'raise') preflopRaisers.add(a.playerKey);
    }
    for (const p of voluntaryEntries) {
      if (stats[p]) stats[p].vpipHands++;
    }
    for (const p of preflopRaisers) {
      if (stats[p]) stats[p].pfrHands++;
    }

    // Postflop aggression counters
    for (const a of hand.actions) {
      if (a.street === 'preflop') continue;
      if (!stats[a.playerKey]) continue;
      if (a.type === 'bets') stats[a.playerKey].postflopBets++;
      else if (a.type === 'raise') stats[a.playerKey].postflopRaises++;
      else if (a.type === 'calls') stats[a.playerKey].postflopCalls++;
    }
  }

  return stats;
}

function computeSessionStats(csvText) {
  return computeStatsFromHands(parseHandLog(csvText));
}

// Derive the public-facing percentages for a single counter row.
function derive(c) {
  const af = c.postflopCalls > 0
    ? (c.postflopBets + c.postflopRaises) / c.postflopCalls
    : (c.postflopBets + c.postflopRaises > 0 ? null : 0); // ∞ → null
  return {
    handsDealt: c.handsDealt,
    vpip: c.handsDealt > 0 ? c.vpipHands / c.handsDealt : 0,
    pfr: c.handsDealt > 0 ? c.pfrHands / c.handsDealt : 0,
    af,
    postflopBets: c.postflopBets,
    postflopRaises: c.postflopRaises,
    postflopCalls: c.postflopCalls,
  };
}

module.exports = { computeStatsFromHands, computeSessionStats, derive, initCounters };
