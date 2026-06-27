import { useState } from 'react';
import type { Bucket, GradeResult, Spot } from '../../trainer/types';
import { RangeGrid } from './RangeGrid';

const TIER_LABEL: Record<GradeResult['tier'], string> = {
  best: 'Best ★', correct: 'Correct ✓', inaccuracy: 'Inaccuracy', mistake: 'Mistake', blunder: 'Blunder',
};
const COLOR_CLASS: Record<GradeResult['color'], string> = {
  positive: 'text-accent-positive', primary: 'text-accent-primary', negative: 'text-accent-negative',
};
const BAR_BG: Record<'best' | 'correct' | 'bad', string> = {
  best: 'bg-accent-positive', correct: 'bg-accent-primary', bad: 'bg-accent-negative',
};

function labelFor(spot: Spot, bucket: Bucket): string {
  return spot.legalActions.find((a) => a.bucket === bucket)?.label ?? bucket;
}

interface Props {
  spot: Spot;
  result: GradeResult;
  onNext: () => void;
  stats: { accuracyPct: number; streak: number };
}

export function FeedbackPanel({ spot, result, onNext, stats }: Props) {
  const [showRange, setShowRange] = useState(false);

  // button-space distribution, sorted high→low, classified for the traffic-light bars
  const rows = Object.entries(result.buttonFreq)
    .map(([bucket, freq]) => ({ bucket: bucket as Bucket, freq: freq ?? 0 }))
    .filter((r) => spot.legalActions.some((a) => a.bucket === r.bucket))
    .sort((a, b) => b.freq - a.freq);
  const top = rows[0]?.freq ?? 0;

  return (
    <div className="card mt-4">
      <div className={`text-xl font-extrabold ${COLOR_CLASS[result.color]}`}>{TIER_LABEL[result.tier]}</div>
      <div className="text-sm text-text-secondary mt-1">
        You played <b>{labelFor(spot, result.chosen)}</b> — GTO takes it{' '}
        {(result.chosenFreq * 100).toFixed(0)}% here. Top line: <b>{labelFor(spot, result.bestBucket)}</b>.
      </div>

      <div className="text-[12px] uppercase tracking-wide text-text-tertiary mt-4 mb-2">GTO strategy for {spot.handClass}</div>
      <div className="space-y-1.5">
        {rows.map((r) => {
          const cls = r.freq === top && r.freq > 0 ? 'best' : r.freq >= 0.035 ? 'correct' : 'bad';
          const isChosen = r.bucket === result.chosen;
          return (
            <div key={r.bucket} className="flex items-center gap-2">
              <div className={`w-28 text-sm ${isChosen ? 'font-bold underline' : ''}`}>{labelFor(spot, r.bucket)}</div>
              <div className="flex-1 h-5 rounded bg-bg-tertiary overflow-hidden">
                <div className={`h-full ${BAR_BG[cls]}`} style={{ width: `${Math.max(2, r.freq * 100)}%` }} />
              </div>
              <div className="w-12 text-right text-sm tabular-nums">{(r.freq * 100).toFixed(0)}%</div>
            </div>
          );
        })}
      </div>

      <div className="text-xs text-text-secondary mt-3 bg-surface-secondary border border-bg-tertiary rounded-lg p-2">
        Graded by frequency (the free preflop charts don't carry EV). Per-hand EV-loss arrives with the postflop phase.
      </div>

      <button onClick={() => setShowRange((v) => !v)} className="text-sm text-accent-primary mt-3 hover:underline">
        {showRange ? 'Hide full range ▴' : 'Show full range ▾'}
      </button>
      {showRange && (
        <div className="mt-2">
          <RangeGrid category={spot.category} hero={spot.heroPos} villain={spot.villainPos}
                     depth={spot.category === 'push-fold' ? spot.effStackBb : undefined} highlight={spot.handClass} />
        </div>
      )}

      <div className="flex items-center justify-between mt-4 pt-3 border-t border-bg-tertiary">
        <div className="text-sm text-text-secondary">
          Session: <b className="text-text-primary">{stats.accuracyPct}%</b> · streak <b className="text-text-primary">{stats.streak}</b>
        </div>
        <button onClick={onNext} className="btn-primary">Next spot ▸</button>
      </div>
    </div>
  );
}
