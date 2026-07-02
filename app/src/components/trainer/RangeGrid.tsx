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

// Action palette, separate from the green/red grading palette.
const RAISE_C = '#8B7355';  // accent-primary (brown)
const CALL_C = '#9aa77f';   // muted olive
const FOLD_C = '#E5DED4';   // bg-tertiary (grey)

/**
 * Cell background reflects the hand's actual action split: pure cells are solid,
 * mixed cells show proportional color segments (raise | call | fold).
 */
function cellStyle(strat: ReturnType<typeof getStrategy>): { className: string; style?: React.CSSProperties } {
  const raise = (strat.raise ?? 0) + (strat.allin ?? 0);
  const call = strat.call ?? 0;
  const fold = Math.max(0, 1 - raise - call);
  if (fold >= 0.95) return { className: 'bg-bg-tertiary text-text-tertiary' };
  if (raise >= 0.95) return { className: 'bg-accent-primary text-text-inverse' };
  if (call >= 0.95) return { className: 'bg-[#9aa77f] text-text-inverse' };
  const r = raise * 100, c = (raise + call) * 100;
  return {
    className: fold >= 0.5 ? 'text-text-secondary' : 'text-text-inverse',
    style: {
      background: `linear-gradient(to right, ${RAISE_C} 0% ${r}%, ${CALL_C} ${r}% ${c}%, ${FOLD_C} ${c}% 100%)`,
    },
  };
}

export function RangeGrid({ category, hero, villain, depth, highlight }: Props) {
  const hands = allHandClasses();
  return (
    <div className="grid grid-cols-13 gap-[2px] max-w-[560px]">
      {hands.map((hc) => {
        const strat = getStrategy(category, hero, hc, villain, depth);
        const isHero = hc === highlight;
        const cell = cellStyle(strat);
        return (
          <div
            key={hc}
            data-hand={hc}
            data-hero={isHero ? 'true' : 'false'}
            title={hc}
            className={[
              'aspect-square rounded-[3px] text-[9px] font-bold flex items-center justify-center',
              cell.className,
              isHero ? 'outline outline-2 outline-text-primary z-10' : '',
            ].join(' ')}
            style={cell.style}
          >
            {hc}
          </div>
        );
      })}
    </div>
  );
}
