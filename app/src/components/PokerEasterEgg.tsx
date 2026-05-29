// 🎰 Easter-egg heads-up poker mini-game.
// Triggered by clicking the 🎲 in the Home title. Opponent always shoves
// $1M preflop. You see both hole cards face-up; pick call or fold.
//
// Folding silently runs the simulation out and tells you what you would have
// done — adds drama. Calling animates flop → turn → river → winner.

import { useEffect, useMemo, useState } from 'react';
// @ts-expect-error — pokersolver has no types
import { Hand } from 'pokersolver';
import { fetchAliasMappings } from '../api';

type Phase =
  | 'dealing'      // brief intro stagger
  | 'preflop'      // waiting for user to call/fold
  | 'flop'         // flop revealed
  | 'turn'         // turn revealed
  | 'river'        // river revealed, awaiting evaluation
  | 'showdown'     // winner shown, awaiting "Next hand"
  | 'folded';      // user folded; show "would have" result

interface Card {
  rank: string; // '2'..'9','T','J','Q','K','A'
  suit: 's' | 'h' | 'd' | 'c';
}

const RANKS = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'] as const;
const SUITS: Card['suit'][] = ['s', 'h', 'd', 'c'];
const SUIT_SYMBOL: Record<Card['suit'], string> = { s: '♠', h: '♥', d: '♦', c: '♣' };
const SUIT_COLOR: Record<Card['suit'], string> = { s: 'text-slate-900', c: 'text-slate-900', h: 'text-red-600', d: 'text-red-600' };

function buildDeck(): Card[] {
  const d: Card[] = [];
  for (const r of RANKS) for (const s of SUITS) d.push({ rank: r, suit: s });
  return d;
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function cardStr(c: Card) { return c.rank + c.suit; }

interface DealtHand {
  user: [Card, Card];
  opp: [Card, Card];
  board: [Card, Card, Card, Card, Card]; // all 5 board cards pre-dealt, revealed over time
}

function dealHand(): DealtHand {
  const d = shuffle(buildDeck());
  return {
    user: [d[0], d[1]],
    opp: [d[2], d[3]],
    board: [d[4], d[5], d[6], d[7], d[8]],
  };
}

type Outcome = 'win' | 'lose' | 'tie';
function evaluate(user: Card[], opp: Card[], board: Card[]): { outcome: Outcome; userHandName: string; oppHandName: string } {
  const u = Hand.solve([...user, ...board].map(cardStr));
  const o = Hand.solve([...opp, ...board].map(cardStr));
  const winners = Hand.winners([u, o]);
  let outcome: Outcome;
  if (winners.length === 2) outcome = 'tie';
  else if (winners[0] === u) outcome = 'win';
  else outcome = 'lose';
  return { outcome, userHandName: u.descr, oppHandName: o.descr };
}

const STAKE = 1_000_000;

export function PokerEasterEgg({ onClose }: { onClose: () => void }) {
  const [hand, setHand] = useState<DealtHand>(() => dealHand());
  const [phase, setPhase] = useState<Phase>('dealing');
  const [outcome, setOutcome] = useState<ReturnType<typeof evaluate> | null>(null);
  const [stats, setStats] = useState({ hands: 0, net: 0, calls: 0, folds: 0, goodFolds: 0, regretFolds: 0 });

  // Pool of real player names from the tracker — used as random opponents.
  // Falls back to a small hardcoded list if the fetch fails so the game still works.
  const [playerPool, setPlayerPool] = useState<string[]>(['Patt', 'Stephen', 'Han', 'Jeremy', 'Nick']);
  useEffect(() => {
    let active = true;
    fetchAliasMappings()
      .then((d) => {
        if (!active) return;
        const named = d.canonicalPlayers.filter((p) => p.length >= 2 && /^[A-Za-z]/.test(p));
        if (named.length > 0) setPlayerPool(named);
      })
      .catch(() => { /* keep fallback */ });
    return () => { active = false; };
  }, []);

  // Random opponent name per hand. Stable per hand object so it doesn't
  // re-roll on every render.
  const opponentName = useMemo(
    () => playerPool[Math.floor(Math.random() * playerPool.length)] ?? 'Opponent',
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hand, playerPool]
  );

  // On hand start: brief delay for "dealing", then go to preflop decision.
  useEffect(() => {
    setPhase('dealing');
    setOutcome(null);
    const t = setTimeout(() => setPhase('preflop'), 500);
    return () => clearTimeout(t);
  }, [hand]);

  function nextHand() {
    setHand(dealHand());
  }

  function onFold() {
    // Run the simulation silently; tell the user what they would have done.
    const res = evaluate(hand.user, hand.opp, hand.board);
    setOutcome(res);
    setPhase('folded');
    setStats((s) => ({
      hands: s.hands + 1,
      net: s.net, // no chip change on fold
      calls: s.calls,
      folds: s.folds + 1,
      goodFolds: s.goodFolds + (res.outcome === 'lose' ? 1 : 0),
      regretFolds: s.regretFolds + (res.outcome === 'win' ? 1 : 0),
    }));
  }

  function onCall() {
    setPhase('flop');
    setTimeout(() => setPhase('turn'), 1100);
    setTimeout(() => setPhase('river'), 2200);
    setTimeout(() => {
      const res = evaluate(hand.user, hand.opp, hand.board);
      setOutcome(res);
      setPhase('showdown');
      setStats((s) => ({
        hands: s.hands + 1,
        net: s.net + (res.outcome === 'win' ? STAKE : res.outcome === 'lose' ? -STAKE : 0),
        calls: s.calls + 1,
        folds: s.folds,
        goodFolds: s.goodFolds,
        regretFolds: s.regretFolds,
      }));
    }, 3100);
  }

  // How much of the board is currently visible
  const boardVisible = useMemo(() => {
    if (phase === 'flop') return 3;
    if (phase === 'turn') return 4;
    if (phase === 'river' || phase === 'showdown' || phase === 'folded') return 5;
    return 0;
  }, [phase]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <div
        className="relative w-full max-w-3xl rounded-2xl p-6 sm:p-8 shadow-2xl overflow-hidden"
        style={{ background: 'radial-gradient(ellipse at top, #0f5132 0%, #052e16 100%)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 w-9 h-9 rounded-full bg-black/30 text-white text-lg hover:bg-black/50 z-10"
          title="Close"
        >
          ✕
        </button>

        {/* Header: stats strip */}
        <div className="flex items-center justify-between text-white text-xs sm:text-sm mb-3 mr-12">
          <div>🎰 <span className="font-semibold">Heads-Up Shove</span></div>
          <div className="flex gap-3 sm:gap-4 tabular-nums">
            <span>Hands: <span className="font-semibold">{stats.hands}</span></span>
            <span>
              Net:{' '}
              <span className={stats.net >= 0 ? 'text-green-300' : 'text-red-300'}>
                {stats.net >= 0 ? '+' : '−'}${Math.abs(stats.net).toLocaleString()}
              </span>
            </span>
          </div>
        </div>

        {/* Opponent — cards stay face-down until user decides */}
        <PlayerRow
          label={`${opponentName} (shoves)`}
          cards={hand.opp}
          reveal={phase !== 'dealing' && phase !== 'preflop'}
          highlight={(phase === 'showdown' || phase === 'folded') && outcome?.outcome === 'lose'}
        />

        {/* Pot + board */}
        <div className="my-4 sm:my-6 flex flex-col items-center gap-3">
          <div className="bg-black/40 text-yellow-300 rounded-full px-4 py-1.5 text-sm font-bold shadow-lg">
            Pot · ${ (phase === 'preflop' || phase === 'dealing' ? STAKE : STAKE * 2).toLocaleString() }
          </div>
          <BoardRow board={hand.board} visible={boardVisible} />
        </div>

        {/* User */}
        <PlayerRow
          label="You"
          cards={hand.user}
          reveal={true}
          highlight={(phase === 'showdown' || phase === 'folded') && outcome?.outcome === 'win'}
        />

        {/* Action area */}
        <div className="mt-6 min-h-[88px] flex flex-col items-center justify-center gap-2">
          {phase === 'dealing' && <div className="text-white/70 text-sm">Dealing…</div>}

          {phase === 'preflop' && (
            <>
              <div className="text-white/80 text-sm mb-1">Opponent shoves <span className="font-bold text-yellow-300">${STAKE.toLocaleString()}</span>.</div>
              <div className="flex gap-3">
                <button
                  onClick={onFold}
                  className="px-6 py-3 rounded-lg bg-slate-700 hover:bg-slate-600 text-white font-semibold shadow"
                >
                  Fold
                </button>
                <button
                  onClick={onCall}
                  className="px-6 py-3 rounded-lg bg-yellow-400 hover:bg-yellow-300 text-slate-900 font-bold shadow"
                >
                  Call ${STAKE.toLocaleString()}
                </button>
              </div>
            </>
          )}

          {(phase === 'flop' || phase === 'turn' || phase === 'river') && (
            <div className="text-white/70 text-sm">Running it out…</div>
          )}

          {phase === 'showdown' && outcome && (
            <ResultBanner outcome={outcome} folded={false} onNext={nextHand} />
          )}
          {phase === 'folded' && outcome && (
            <ResultBanner outcome={outcome} folded={true} onNext={nextHand} />
          )}
        </div>

        {(stats.calls > 0 || stats.folds > 0) && (
          <div className="mt-4 text-xs text-white/50 text-center">
            {stats.calls} calls · {stats.folds} folds
            {stats.goodFolds > 0 && ` · ${stats.goodFolds} good folds 👍`}
            {stats.regretFolds > 0 && ` · ${stats.regretFolds} regrettable folds 😬`}
          </div>
        )}
      </div>
    </div>
  );
}

function PlayerRow({
  label, cards, reveal, highlight,
}: {
  label: string;
  cards: [Card, Card];
  reveal: boolean;
  highlight: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className={`text-xs sm:text-sm ${highlight ? 'text-yellow-300 font-bold' : 'text-white/70'}`}>
        {label} {highlight && '🏆'}
      </div>
      <div className="flex gap-2">
        {cards.map((c, i) => (
          <CardView key={i} card={c} faceUp={reveal} dealIdx={i} highlight={highlight} />
        ))}
      </div>
    </div>
  );
}

function BoardRow({ board, visible }: { board: Card[]; visible: number }) {
  return (
    <div className="flex gap-2">
      {board.map((c, i) => (
        <CardView key={i} card={c} faceUp={i < visible} dealIdx={i} />
      ))}
    </div>
  );
}

function CardView({
  card, faceUp, dealIdx, highlight = false,
}: {
  card: Card;
  faceUp: boolean;
  dealIdx: number;
  highlight?: boolean;
}) {
  const display = card.rank === 'T' ? '10' : card.rank;
  return (
    <div
      className={`relative w-14 h-20 sm:w-16 sm:h-24 rounded-md shadow-md select-none transition-all duration-300 overflow-hidden ${
        faceUp ? 'bg-white' : 'bg-gradient-to-br from-blue-600 to-blue-900'
      } ${highlight ? 'ring-2 ring-yellow-400 shadow-yellow-400/40 scale-105' : ''}`}
      style={{
        animation: faceUp ? `cardFlip 320ms ease-out ${dealIdx * 80}ms both` : undefined,
      }}
    >
      {faceUp && (
        <>
          {/* Top-left rank + suit */}
          <div className={`absolute top-0.5 left-1 leading-none ${SUIT_COLOR[card.suit]}`}>
            <div className="text-sm sm:text-base font-bold">{display}</div>
            <div className="text-xs sm:text-sm leading-none">{SUIT_SYMBOL[card.suit]}</div>
          </div>
          {/* Bottom-right rank + suit, rotated 180. Use absolute positioning
              so the rotation doesn't push it out of the card. */}
          <div
            className={`absolute bottom-0.5 right-1 leading-none ${SUIT_COLOR[card.suit]}`}
            style={{ transform: 'rotate(180deg)', transformOrigin: 'center' }}
          >
            <div className="text-sm sm:text-base font-bold">{display}</div>
            <div className="text-xs sm:text-sm leading-none">{SUIT_SYMBOL[card.suit]}</div>
          </div>
          {/* Big centred suit for visual heft */}
          <div className={`absolute inset-0 flex items-center justify-center ${SUIT_COLOR[card.suit]} opacity-30`}>
            <span className="text-2xl sm:text-3xl">{SUIT_SYMBOL[card.suit]}</span>
          </div>
        </>
      )}
      {!faceUp && (
        <div className="w-full h-full rounded-md border-2 border-blue-800/60 flex items-center justify-center text-blue-200/40 text-xl">
          ♠
        </div>
      )}
    </div>
  );
}

function ResultBanner({
  outcome, folded, onNext,
}: {
  outcome: { outcome: Outcome; userHandName: string; oppHandName: string };
  folded: boolean;
  onNext: () => void;
}) {
  let headline: string;
  let sub: string;
  let color: string;

  if (folded) {
    if (outcome.outcome === 'win') {
      headline = '😬 You would have WON';
      sub = `Your ${outcome.userHandName} beat opponent's ${outcome.oppHandName}. Regret level: high.`;
      color = 'text-red-300';
    } else if (outcome.outcome === 'lose') {
      headline = '👍 Good fold';
      sub = `Opponent's ${outcome.oppHandName} beat your ${outcome.userHandName}. You saved $${STAKE.toLocaleString()}.`;
      color = 'text-green-300';
    } else {
      headline = '🤝 Would have chopped';
      sub = `Both made ${outcome.userHandName}.`;
      color = 'text-yellow-200';
    }
  } else {
    if (outcome.outcome === 'win') {
      headline = `🏆 You win $${STAKE.toLocaleString()}!`;
      sub = `${outcome.userHandName} beats ${outcome.oppHandName}.`;
      color = 'text-green-300';
    } else if (outcome.outcome === 'lose') {
      headline = `💀 Lost $${STAKE.toLocaleString()}`;
      sub = `Opponent's ${outcome.oppHandName} beats your ${outcome.userHandName}.`;
      color = 'text-red-300';
    } else {
      headline = '🤝 Chopped';
      sub = `Both made ${outcome.userHandName}. Pot split.`;
      color = 'text-yellow-200';
    }
  }

  return (
    <div className="flex flex-col items-center gap-2 animate-fade-in">
      <div className={`text-lg sm:text-xl font-bold ${color}`}>{headline}</div>
      <div className="text-xs sm:text-sm text-white/70 text-center">{sub}</div>
      <button
        onClick={onNext}
        className="mt-1 px-5 py-2 rounded-lg bg-yellow-400 hover:bg-yellow-300 text-slate-900 font-bold text-sm shadow"
      >
        Deal next hand →
      </button>
    </div>
  );
}
