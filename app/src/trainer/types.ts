export type Position = 'UTG' | 'HJ' | 'CO' | 'BTN' | 'SB' | 'BB';
export const ALL_POSITIONS: Position[] = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'];

export type Category = 'rfi' | 'vs-open' | 'vs-3bet' | 'push-fold';
export const CATEGORIES: Category[] = ['rfi', 'vs-open', 'vs-3bet', 'push-fold'];

/** Raw chart action buckets. Preflop never uses 'check'; postflop (Phase 2) adds bet sizes. */
export type Bucket = 'fold' | 'check' | 'call' | 'raise' | 'allin';

export type Rank = 'A' | 'K' | 'Q' | 'J' | 'T' | '9' | '8' | '7' | '6' | '5' | '4' | '3' | '2';
export type Suit = 's' | 'h' | 'd' | 'c';
export interface Card { rank: Rank; suit: Suit; }

/** e.g. 'AA', 'AKs', 'AKo' */
export type HandClass = string;

/** Frequencies (0..1) over raw buckets; omitted buckets are 0. Should sum to ~1. */
export type Strategy = Partial<Record<Bucket, number>>;

export interface ActionOption {
  kind: 'fold' | 'check' | 'call' | 'raise' | 'allin';
  label: string;            // concrete, user-facing: "3-bet to 7.5bb", "Jam 15bb"
  sizeBb?: number;
  bucket: Bucket;           // identity of this button
  covers: Bucket[];         // raw strategy buckets this button aggregates (e.g. raise covers ['raise','allin'])
}

export interface HistoryItem {
  pos: Position;
  state: 'fold' | 'acted' | 'hero' | 'pending';
  label: string;            // 'fold', 'raise 2.5', 'YOU', 'to act'
  amountBb?: number;
  committedBb: number;      // chips this seat has in front this street (blinds + raises)
  live: boolean;            // still in the hand; a chip sprite is drawn only when live && committedBb > 0
}

export interface Spot {
  id: string;
  category: Category;
  format: string;           // "Cash 6-max" | "MTT"
  effStackBb: number;
  heroPos: Position;
  villainPos?: Position;
  actionHistory: HistoryItem[];
  potBb: number;
  toCallBb: number;
  heroHand: [Card, Card];
  handClass: HandClass;
  legalActions: ActionOption[];
  strategy: Strategy;       // raw bucket frequencies for the hero hand
  source: string;           // attribution
}

export type Tier = 'best' | 'correct' | 'inaccuracy' | 'mistake' | 'blunder';
export type TierColor = 'positive' | 'primary' | 'negative';

export interface GradeResult {
  tier: Tier;
  color: TierColor;
  chosen: Bucket;
  bestBucket: Bucket;
  /** Aggregated frequency the user actually had at their chosen button (0..1). */
  chosenFreq: number;
  /** Aggregated frequency per button bucket (button space), for the feedback breakdown. */
  buttonFreq: Partial<Record<Bucket, number>>;
}

export interface CategoryStat { answered: number; best: number; correct: number; inaccuracy: number; mistake: number; }

export interface TrainerStats {
  totalAnswered: number;
  totalCorrect: number;     // best + correct
  currentStreak: number;
  bestStreak: number;
  byCategory: Record<Category, CategoryStat>;
  lastPlayed: string;       // ISO date, '' if never
}

export function emptyStats(): TrainerStats {
  const byCategory = {} as Record<Category, CategoryStat>;
  for (const c of CATEGORIES) byCategory[c] = { answered: 0, best: 0, correct: 0, inaccuracy: 0, mistake: 0 };
  return { totalAnswered: 0, totalCorrect: 0, currentStreak: 0, bestStreak: 0, byCategory, lastPlayed: '' };
}
