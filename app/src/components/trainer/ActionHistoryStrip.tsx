import type { Spot } from '../../trainer/types';

export function ActionHistoryStrip({ spot }: { spot: Spot }) {
  return (
    <div className="mt-2">
      <div className="text-[10px] uppercase tracking-wide text-text-tertiary mb-1.5">Action this street (preflop)</div>
      <div className="flex gap-1.5">
        {spot.actionHistory.map((h, i) => {
          const isHero = h.state === 'hero' || h.state === 'hero-acted';
          const base = 'flex-1 rounded-lg py-1.5 text-center border';
          const style =
            isHero ? 'bg-text-primary text-text-inverse border-text-primary'
            : h.state === 'acted' ? 'bg-[#EFE6D7] border-[#caa877] text-[#6E5638] font-bold'
            : h.state === 'pending' ? 'bg-surface-secondary border-bg-tertiary border-dashed text-text-tertiary italic'
            : 'bg-surface-secondary border-bg-tertiary text-text-tertiary opacity-40';
          return (
            // key by index: the hero seat appears twice when the action wraps back around to him
            <div key={i} data-strip-cell className={`${base} ${style}`}>
              <div className="text-[11px] font-bold">{isHero ? `${h.pos} · YOU` : h.pos}</div>
              <div className="text-[11px] mt-0.5">{h.label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
