// Equity calculator for Hold'em and Omaha all-ins.
//
// Given each all-in player's hole cards + the community cards already dealt at
// the moment of the all-in, Monte-Carlo sample the remaining board and count
// how often each player wins (split pots count as fractional wins).
//
// Returns equity percentages (0..1) per player.

const { Hand } = require('pokersolver');

const RANKS = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
const SUITS = ['s','h','d','c'];

function fullDeck() {
  const d = [];
  for (const r of RANKS) for (const s of SUITS) d.push(r + s);
  return d;
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Given used cards, return the remaining deck.
function deckMinus(used) {
  const used_ = new Set(used);
  return fullDeck().filter((c) => !used_.has(c));
}

/**
 * Compute equity for each all-in player.
 * @param {{ holeCards: string[][], communityCards: string[], gameType: 'holdem'|'omaha', samples?: number }} opts
 * @returns {number[]} equity percentages per player (sum ≈ 1)
 */
function computeEquity({ holeCards, communityCards, gameType, samples = 10000 }) {
  const used = communityCards.slice();
  for (const hand of holeCards) used.push(...hand);

  const remainingNeeded = 5 - communityCards.length;
  const deck = deckMinus(used);
  const wins = new Array(holeCards.length).fill(0);
  const variant = gameType === 'omaha' ? 'omaha' : 'standard';

  if (remainingNeeded === 0) {
    // Board fully dealt — exact, deterministic. Caller normally avoids this.
    const result = evaluateBoard(communityCards, holeCards, variant);
    for (const w of result.winners) wins[w] += 1 / result.winners.length;
    return wins;
  }

  for (let i = 0; i < samples; i++) {
    // Draw `remainingNeeded` cards from the deck without replacement
    shuffleInPlace(deck);
    const fill = deck.slice(0, remainingNeeded);
    const board = communityCards.concat(fill);
    const result = evaluateBoard(board, holeCards, variant);
    const share = 1 / result.winners.length;
    for (const w of result.winners) wins[w] += share;
  }

  return wins.map((w) => w / samples);
}

function evaluateBoard(board, holeCards, variant) {
  const hands = holeCards.map((hc) => {
    const allCards = hc.concat(board);
    return Hand.solve(allCards, variant);
  });
  const winners = Hand.winners(hands);
  const winnerIdx = winners.map((w) => hands.indexOf(w));
  return { winners: winnerIdx };
}

/**
 * Equity for run-it-twice: averages equity across the two random boards.
 * For pure EV calculation this is identical to running once — variance differs
 * but expected value doesn't. So we just call computeEquity once.
 */
function computeEquityRunItTwice(opts) {
  return computeEquity(opts);
}

module.exports = { computeEquity, computeEquityRunItTwice };
