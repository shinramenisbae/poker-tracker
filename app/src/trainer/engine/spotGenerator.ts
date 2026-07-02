import type { ActionOption, Category, Spot, Strategy } from '../types';
import { randomCombo, handClassOf } from '../ranges';
import { buildContext, order } from '../sizing';
import { availableScenarios, getStrategy } from '../charts';
import { aggregate } from './grader';

export interface GenerateOptions {
  category: Category;
  depth?: number;          // push-fold only; if omitted, sampled from available depths
}

let counter = 0;

function pick<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}

/**
 * Dealer bias: uniform dealing makes ~75-85% of spots trivial folds, so most deals
 * hunt for a hand with something to think about. The rest stay uniform so clear
 * folds remain part of the drill (never punishing junk teaches over-aggression).
 */
export const INTERESTING_SHARE = 0.6;
const MIXED_TRIES = 25;
const DECISION_TRIES = 12;
const MIX_MIN_FREQ = 0.05;

/** A hand with a visible split: two or more on-screen buttons played >=5% (in button space). */
export function isMixed(actions: ActionOption[], strategy: Strategy): boolean {
  const freqs = Object.values(aggregate(actions, strategy));
  return freqs.filter((f) => (f ?? 0) >= MIX_MIN_FREQ).length >= 2;
}

/** A hand GTO doesn't purely fold — there is an actual decision to make. */
export function isDecision(strategy: Strategy): boolean {
  return (strategy.fold ?? 0) < 0.999;
}

export function generateSpot(opts: GenerateOptions, rng: () => number = Math.random): Spot {
  let scenarios = availableScenarios(opts.category);
  if (opts.category === 'push-fold' && opts.depth) {
    scenarios = scenarios.filter(s => s.depth === opts.depth);
  }
  // Filter out impossible preflop position combos so the table can't show a bad action order.
  if (opts.category === 'vs-open') {
    scenarios = scenarios.filter(s => s.villain && order(s.villain) < order(s.hero));
  } else if (opts.category === 'vs-3bet') {
    scenarios = scenarios.filter(s => s.villain && order(s.villain) > order(s.hero));
  } else if (opts.category === 'rfi') {
    scenarios = scenarios.filter(s => s.hero !== 'BB');
  }
  if (scenarios.length === 0) throw new Error(`No valid scenarios for category ${opts.category}`);
  const sc = pick(scenarios, rng);

  const effStack = opts.category === 'push-fold' ? (sc.depth ?? 15) : 100;
  const ctx = buildContext(opts.category, sc.hero, sc.villain, effStack);

  const deal = () => {
    const [a, b] = randomCombo(rng);
    const handClass = handClassOf(a, b);
    const strategy = getStrategy(opts.category, sc.hero, handClass, sc.villain, sc.depth);
    return { a, b, handClass, strategy };
  };

  let hand = deal();
  if (rng() < INTERESTING_SHARE) {
    // First hunt for a genuinely mixed hand; settle for any non-fold decision.
    for (let i = 0; i < MIXED_TRIES && !isMixed(ctx.legalActions, hand.strategy); i++) hand = deal();
    if (!isMixed(ctx.legalActions, hand.strategy)) {
      for (let i = 0; i < DECISION_TRIES && !isDecision(hand.strategy); i++) hand = deal();
    }
  }
  const { a, b, handClass, strategy } = hand;

  return {
    id: `spot-${++counter}-${Math.floor(rng() * 1e6)}`,
    category: opts.category,
    format: opts.category === 'push-fold' ? 'MTT' : 'MTT 6-max',
    effStackBb: effStack,
    heroPos: sc.hero,
    villainPos: sc.villain,
    actionHistory: ctx.actionHistory,
    potBb: ctx.potBb,
    toCallBb: ctx.toCallBb,
    heroHand: [a, b],
    handClass,
    legalActions: ctx.legalActions,
    strategy,
    source: sc.source,
  };
}

export function randomCategory(rng: () => number, categories: Category[]): Category {
  return categories[Math.floor(rng() * categories.length) % categories.length];
}
