import type { Category, Tier, TrainerStats } from './types';

export const TRAINER_STATS_KEY = 'poker-tracker-trainer-stats';

export function applyResult(prev: TrainerStats, category: Category, tier: Tier, isoDate: string): TrainerStats {
  const isCorrect = tier === 'best' || tier === 'correct';
  const cat = prev.byCategory[category];
  const updatedCat = {
    answered: cat.answered + 1,
    best: cat.best + (tier === 'best' ? 1 : 0),
    correct: cat.correct + (tier === 'correct' ? 1 : 0),
    inaccuracy: cat.inaccuracy + (tier === 'inaccuracy' ? 1 : 0),
    mistake: cat.mistake + (tier === 'mistake' || tier === 'blunder' ? 1 : 0),
  };
  const currentStreak = isCorrect ? prev.currentStreak + 1 : 0;
  return {
    totalAnswered: prev.totalAnswered + 1,
    totalCorrect: prev.totalCorrect + (isCorrect ? 1 : 0),
    currentStreak,
    bestStreak: Math.max(prev.bestStreak, currentStreak),
    byCategory: { ...prev.byCategory, [category]: updatedCat },
    lastPlayed: isoDate,
  };
}
