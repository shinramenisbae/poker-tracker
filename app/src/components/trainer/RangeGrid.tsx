import type { Category, HandClass, Position } from '../../trainer/types';
import { allHandClasses } from '../../trainer/ranges';
import { getStrategy } from '../../trainer/charts';

interface Props {
  category: Category;
  hero: Position;
  villain?: Position;
  depth?: number;
  highlight: HandClass;
}

/** Action color, separate from the green/red grading palette. */
function cellColor(strat: ReturnType<typeof getStrategy>): string {
  const raise = (strat.raise ?? 0) + (strat.allin ?? 0);
  const call = strat.call ?? 0;
  const fold = strat.fold ?? 0;
  if (fold >= 0.999) return 'bg-bg-tertiary text-text-tertiary';      // fold
  if (raise > 0 && call > 0) return 'bg-accent-primary/70 text-text-inverse'; // mixed
  if (raise >= call) return 'bg-accent-primary text-text-inverse';    // raise
  return 'bg-[#9aa77f] text-text-inverse';                            // call (muted olive)
}

export function RangeGrid({ category, hero, villain, depth, highlight }: Props) {
  const hands = allHandClasses();
  return (
    <div className="grid grid-cols-13 gap-[2px] max-w-[560px]">
      {hands.map((hc) => {
        const strat = getStrategy(category, hero, hc, villain, depth);
        const isHero = hc === highlight;
        return (
          <div
            key={hc}
            data-hand={hc}
            data-hero={isHero ? 'true' : 'false'}
            title={hc}
            className={[
              'aspect-square rounded-[3px] text-[9px] font-bold flex items-center justify-center',
              cellColor(strat),
              isHero ? 'outline outline-2 outline-text-primary z-10' : '',
            ].join(' ')}
          >
            {hc}
          </div>
        );
      })}
    </div>
  );
}
