import type { Category, HandClass, Position, Strategy } from '../types';
import { ALL_POSITIONS } from '../types';
import { charts as greenline } from './source/greenline';
import { chartCellStrategy, notationStrategy } from './convert';
import { pushFold, pushFoldKey, PUSH_FOLD_DEPTHS } from './pushfold';

export interface ScenarioRef {
  hero: Position;
  villain?: Position;
  depth?: number;
  source: string;
}

const SCENARIO_TOKEN: Record<Exclude<Category, 'push-fold'>, string> = {
  'rfi': 'RFI',
  'vs-open': 'vs-open',
  'vs-3bet': 'vs-3bet',
};

function parsePosition(s: string): Position | undefined {
  return (ALL_POSITIONS as string[]).includes(s) ? (s as Position) : undefined;
}

/** Greenline chart keys look like 'UTG-RFI' or 'SB-vs-open-BTN'. */
export function availableScenarios(category: Category): ScenarioRef[] {
  if (category === 'push-fold') {
    const out: ScenarioRef[] = [];
    for (const key of Object.keys(pushFold)) {
      const [pos, depthStr] = key.split('-');
      const hero = parsePosition(pos);
      const depth = Number(depthStr);
      if (hero && PUSH_FOLD_DEPTHS.includes(depth as any)) {
        out.push({ hero, depth, source: 'push/fold (GTO-style)' });
      }
    }
    return out;
  }

  const token = SCENARIO_TOKEN[category];
  const out: ScenarioRef[] = [];
  for (const key of Object.keys(greenline)) {
    // hero-RFI  OR  hero-vs-open-villain  OR  hero-vs-3bet-villain
    if (category === 'rfi') {
      const m = key.match(/^([A-Z]{2,3})-RFI$/);
      if (m) {
        const hero = parsePosition(m[1]);
        if (hero) out.push({ hero, source: 'Greenline (MIT)' });
      }
    } else {
      const m = key.match(new RegExp(`^([A-Z]{2,3})-${token}-([A-Z]{2,3})$`));
      if (m) {
        const hero = parsePosition(m[1]);
        const villain = parsePosition(m[2]);
        if (hero && villain) out.push({ hero, villain, source: 'Greenline (MIT)' });
      }
    }
  }
  return out;
}

export function getStrategy(
  category: Category,
  hero: Position,
  hand: HandClass,
  villain?: Position,
  depth?: number,
): Strategy {
  if (category === 'push-fold') {
    const notation = pushFold[pushFoldKey(hero, depth ?? 0)];
    if (!notation) return { fold: 1 };
    return notationStrategy(notation, hand);
  }
  const token = SCENARIO_TOKEN[category];
  const key = villain ? `${hero}-${token}-${villain}` : `${hero}-${token}`;
  return chartCellStrategy(greenline[key], hand);
}
