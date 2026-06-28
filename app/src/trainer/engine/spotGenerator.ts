import type { Category, Spot } from '../types';
import { randomCombo, handClassOf } from '../ranges';
import { buildContext, order } from '../sizing';
import { availableScenarios, getStrategy } from '../charts';

export interface GenerateOptions {
  category: Category;
  depth?: number;          // push-fold only; if omitted, sampled from available depths
}

let counter = 0;

function pick<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length) % arr.length];
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

  const [a, b] = randomCombo(rng);
  const handClass = handClassOf(a, b);
  const strategy = getStrategy(opts.category, sc.hero, handClass, sc.villain, sc.depth);

  return {
    id: `spot-${++counter}-${Math.floor(rng() * 1e6)}`,
    category: opts.category,
    format: opts.category === 'push-fold' ? 'MTT' : 'Cash 6-max',
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
