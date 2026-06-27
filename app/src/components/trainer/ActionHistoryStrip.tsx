import type { Spot } from '../../trainer/types';

export function ActionHistoryStrip({ spot }: { spot: Spot }) {
  return (
    <div className="mt-2">
      <div className="text-[10px] uppercase tracking-wide text-text-tertiary mb-1.5">Action this street (preflop)</div>
      <div className="flex gap-1.5">
        {spot.actionHistory.map((h) => {
          const base = 'flex-1 rounded-lg py-1.5 text-center border';
          const style =
            h.state === 'hero' ? 'bg-text-primary text-text-inverse border-text-primary'
            : h.state === 'acted' ? 'bg-[#EFE6D7] border-[#caa877] text-[#6E5638] font-bold'
            : h.state === 'pending' ? 'bg-surface-secondary border-bg-tertiary border-dashed text-text-tertiary italic'
            : 'bg-surface-secondary border-bg-tertiary text-text-tertiary opacity-40';
          return (
            <div key={h.pos} className={`${base} ${style}`}>
              <div className="text-[11px] font-bold">{h.pos}</div>
              <div className="text-[11px] mt-0.5">{h.label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
