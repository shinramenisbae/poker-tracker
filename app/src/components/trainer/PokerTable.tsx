import type { Card, Position, Spot } from '../../trainer/types';
import { ALL_POSITIONS } from '../../trainer/types';

const SEAT_POS: Record<Position, { top: string; left: string }> = {
  UTG: { top: '13%', left: '25%' },
  HJ:  { top: '13%', left: '50%' },
  CO:  { top: '30%', left: '84%' },
  BTN: { top: '84%', left: '62%' },
  SB:  { top: '84%', left: '38%' },
  BB:  { top: '30%', left: '16%' },
};

function CardView({ card }: { card: Card }) {
  const red = card.suit === 'h' || card.suit === 'd';
  const suit = { s: '♠', h: '♥', d: '♦', c: '♣' }[card.suit];
  return (
    <div className="flex flex-col items-center justify-center w-[52px] h-[72px] rounded-lg bg-white border border-[#E0D9CD] shadow font-extrabold text-2xl leading-none"
         style={{ color: red ? '#B85450' : '#2D2A26' }}>
      <span>{card.rank}</span>
      <small className="text-[13px] mt-0.5">{suit}</small>
    </div>
  );
}

export function PokerTable({ spot }: { spot: Spot }) {
  return (
    <div className="relative mx-auto my-4" style={{ height: 340 }}>
      <div className="absolute inset-0 border-[8px] border-[#2F4638]"
           style={{ borderRadius: 170, background: 'radial-gradient(ellipse at 50% 42%, #496b55 0%, #3E5C4A 60%, #355140 100%)', boxShadow: 'inset 0 0 60px rgba(0,0,0,.28)' }} />
      {ALL_POSITIONS.map((pos) => {
        const p = SEAT_POS[pos];
        const isHero = pos === spot.heroPos;
        const isAggr = pos === spot.villainPos;
        const folded = !isHero && !isAggr;
        return (
          <div key={pos} className="absolute -translate-x-1/2 -translate-y-1/2 text-center w-24" style={{ top: p.top, left: p.left }}>
            <div className={[
              'rounded-lg py-1.5 text-xs font-bold border',
              isHero ? 'bg-white text-text-primary border-white'
              : isAggr ? 'bg-[#6E5638] text-white border-[#caa877]'
              : 'bg-white/10 text-[#EDEAE3] border-white/20',
              folded ? 'opacity-40' : '',
            ].join(' ')}>
              {isHero ? `${pos} · YOU` : pos}
            </div>
            <div className="text-[10px] mt-0.5" style={{ color: '#cdbfa6' }}>{spot.effStackBb}bb</div>
          </div>
        );
      })}
      <div className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 text-center" style={{ top: '42%' }}>
        <div className="text-[10px] uppercase tracking-wider" style={{ color: '#cdbfa6' }}>Pot</div>
        <div className="text-xl font-extrabold text-white">{spot.potBb}bb</div>
      </div>
      <div className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 flex gap-2" style={{ top: '88%' }}>
        <CardView card={spot.heroHand[0]} />
        <CardView card={spot.heroHand[1]} />
      </div>
    </div>
  );
}
