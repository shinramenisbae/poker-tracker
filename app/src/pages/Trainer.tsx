import { useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Bucket, Category, GradeResult, Spot } from '../trainer/types';
import { CATEGORIES, emptyStats } from '../trainer/types';
import { useLocalStorage } from '../hooks/useStorage';
import { generateSpot, randomCategory } from '../trainer/engine/spotGenerator';
import { grade } from '../trainer/engine/grader';
import { applyResult, TRAINER_STATS_KEY } from '../trainer/stats';
import { PUSH_FOLD_DEPTHS, type PushFoldDepth } from '../trainer/charts/pushfold';
import { PokerTable } from '../components/trainer/PokerTable';
import { ActionHistoryStrip } from '../components/trainer/ActionHistoryStrip';
import { ActionButtons } from '../components/trainer/ActionButtons';
import { FeedbackPanel } from '../components/trainer/FeedbackPanel';

const CATEGORY_LABEL: Record<Category, string> = {
  'rfi': 'RFI', 'vs-open': 'Facing open', 'vs-3bet': 'Facing 3-bet', 'push-fold': 'Push/fold',
};

type CatFilter = Category | 'mixed';

function makeSpot(filter: CatFilter, depth: PushFoldDepth | 'mixed'): Spot {
  const category = filter === 'mixed' ? randomCategory(Math.random, CATEGORIES) : filter;
  const d = category === 'push-fold'
    ? (depth === 'mixed' ? PUSH_FOLD_DEPTHS[Math.floor(Math.random() * PUSH_FOLD_DEPTHS.length)] : depth)
    : undefined;
  return generateSpot({ category, depth: d });
}

export function Trainer() {
  const navigate = useNavigate();
  const [stats, setStats] = useLocalStorage(TRAINER_STATS_KEY, emptyStats());
  const [filter, setFilter] = useState<CatFilter>('mixed');
  const [depth, setDepth] = useState<PushFoldDepth | 'mixed'>('mixed');
  const [spot, setSpot] = useState<Spot>(() => makeSpot('mixed', 'mixed'));
  const [result, setResult] = useState<GradeResult | null>(null);

  const next = useCallback(() => {
    setResult(null);
    setSpot(makeSpot(filter, depth));
  }, [filter, depth]);

  const choose = useCallback((bucket: Bucket) => {
    if (result) return;
    const r = grade(spot.legalActions, spot.strategy, bucket);
    setResult(r);
    setStats((prev) => applyResult(prev, spot.category, r.tier, new Date().toISOString().slice(0, 10)));
  }, [result, spot, setStats]);

  const accuracyPct = stats.totalAnswered ? Math.round((stats.totalCorrect / stats.totalAnswered) * 100) : 0;

  const showDepthRow = filter === 'push-fold';
  const chips = useMemo(() => (['mixed', ...CATEGORIES] as CatFilter[]), []);

  return (
    <div className="min-h-full bg-bg-primary">
      <header className="sticky top-0 bg-bg-primary/95 backdrop-blur-sm border-b border-bg-tertiary z-10">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-text-primary">🎯 GTO Trainer</h1>
          <button onClick={() => navigate('/')} className="p-2 rounded-full hover:bg-bg-tertiary" title="Home">🏠</button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 pb-24">
        {/* category chips */}
        <div className="flex gap-2 flex-wrap mb-2">
          {chips.map((c) => (
            <button key={c}
              onClick={() => { setFilter(c); setResult(null); setSpot(makeSpot(c, depth)); }}
              className={`px-3 py-1.5 rounded-full text-sm border ${filter === c ? 'bg-text-primary text-text-inverse border-text-primary' : 'bg-surface-secondary border-accent-primary-light text-text-secondary'}`}>
              {c === 'mixed' ? 'Mixed' : CATEGORY_LABEL[c as Category]}
            </button>
          ))}
        </div>

        {/* depth chips (push/fold only) */}
        {showDepthRow && (
          <div className="flex gap-2 flex-wrap mb-4">
            {(['mixed', ...PUSH_FOLD_DEPTHS] as (PushFoldDepth | 'mixed')[]).map((d) => (
              <button key={d}
                onClick={() => { setDepth(d); setResult(null); setSpot(makeSpot('push-fold', d)); }}
                className={`px-3 py-1 rounded-full text-xs border ${depth === d ? 'bg-accent-primary text-text-inverse border-accent-primary' : 'bg-surface-secondary border-accent-primary-light text-text-secondary'}`}>
                {d === 'mixed' ? 'Mixed' : `${d}bb`}
              </button>
            ))}
          </div>
        )}

        <div className="card">
          <div className="text-[11px] uppercase tracking-wide text-text-tertiary">
            {spot.format} · {spot.effStackBb}bb · Hero: {spot.heroPos}
          </div>
          <ActionHistoryStrip spot={spot} />
          <PokerTable spot={spot} />
          {!result && <ActionButtons actions={spot.legalActions} disabled={false} onChoose={choose} />}
        </div>

        {result && (
          <FeedbackPanel spot={spot} result={result} onNext={next}
            stats={{ accuracyPct, streak: stats.currentStreak }} />
        )}
      </main>
    </div>
  );
}
