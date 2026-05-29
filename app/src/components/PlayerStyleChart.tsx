import { useMemo } from 'react';
import {
  ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, Cell, LabelList,
} from 'recharts';
import type { PlayerStyleStats } from '../api';

interface Props {
  data: PlayerStyleStats[];
  minHands?: number; // marker fades below this; default 50 for per-session, 100 for aggregate
  title?: string;
  subtitle?: string;
}

// VPIP/PFR thresholds for quadrant lines. Tuned for low-stakes home games (looser
// than online cash). Tweak via the props if you want.
const VPIP_CUTOFF = 25;
const PFR_CUTOFF = 15;

export function PlayerStyleChart({ data, minHands = 50, title, subtitle }: Props) {
  const points = useMemo(
    () => data.map((d) => ({
      name: d.playerName,
      vpip: +(d.vpip * 100).toFixed(1),
      pfr: +(d.pfr * 100).toFixed(1),
      hands: d.handsDealt,
      af: d.af == null ? null : +d.af.toFixed(2),
      sessions: d.sessions,
      faded: d.handsDealt < minHands,
    })),
    [data, minHands]
  );

  if (data.length === 0) {
    return (
      <div className="card text-center text-text-secondary text-sm">
        No player stats yet. Upload a PokerNow hand log on a session to populate this.
      </div>
    );
  }

  return (
    <div className="card">
      {title && <h3 className="text-lg font-semibold text-text-primary mb-1">{title}</h3>}
      {subtitle && <p className="text-xs text-text-secondary mb-3">{subtitle}</p>}

      <div className="grid grid-cols-2 gap-1 text-xs text-text-secondary mb-2 px-12">
        <div className="text-left">🪨 Tight passive</div>
        <div className="text-right">🤠 Loose passive</div>
      </div>

      <ResponsiveContainer width="100%" height={420}>
        <ScatterChart margin={{ top: 8, right: 24, bottom: 24, left: 8 }}>
          <CartesianGrid stroke="#333" strokeDasharray="3 3" />
          <XAxis
            type="number" dataKey="vpip" name="VPIP"
            domain={[0, 100]} ticks={[0, 25, 50, 75, 100]}
            stroke="#999" tick={{ fill: '#999', fontSize: 11 }}
            tickFormatter={(v) => `${v}%`}
            label={{ value: 'VPIP →  (looser)', position: 'insideBottom', offset: -10, fill: '#999', fontSize: 11 }}
          />
          <YAxis
            type="number" dataKey="pfr" name="PFR"
            domain={[0, 60]} ticks={[0, 15, 30, 45, 60]}
            stroke="#999" tick={{ fill: '#999', fontSize: 11 }}
            tickFormatter={(v) => `${v}%`}
            label={{ value: 'PFR ↑  (more aggressive)', angle: -90, position: 'insideLeft', fill: '#999', fontSize: 11 }}
          />
          <ZAxis type="number" dataKey="hands" range={[60, 600]} name="hands" />

          {/* Quadrant divider lines */}
          <ReferenceLine x={VPIP_CUTOFF} stroke="#666" strokeDasharray="4 4" />
          <ReferenceLine y={PFR_CUTOFF} stroke="#666" strokeDasharray="4 4" />

          <Tooltip
            cursor={{ strokeDasharray: '3 3' }}
            content={({ payload }) => {
              if (!payload || payload.length === 0) return null;
              const p: any = payload[0].payload;
              const style = styleLabel(p.vpip, p.pfr);
              return (
                <div className="bg-bg-primary border border-bg-tertiary rounded p-2 text-xs">
                  <div className="font-semibold text-text-primary">{p.name}</div>
                  <div className="text-text-secondary mt-1">{style}</div>
                  <div className="mt-1 grid grid-cols-2 gap-x-3 text-text-primary tabular-nums">
                    <span>VPIP</span><span className="text-right">{p.vpip}%</span>
                    <span>PFR</span><span className="text-right">{p.pfr}%</span>
                    <span>AF</span><span className="text-right">{p.af == null ? '∞' : p.af}</span>
                    <span>Hands</span><span className="text-right">{p.hands}</span>
                    {p.sessions != null && <><span>Sessions</span><span className="text-right">{p.sessions}</span></>}
                  </div>
                </div>
              );
            }}
          />

          <Scatter data={points} fill="#facc15">
            {points.map((p, i) => (
              <Cell key={i} fill={p.faded ? '#facc1566' : '#facc15'} stroke={p.faded ? '#facc1599' : '#facc15'} />
            ))}
            <LabelList
              dataKey="name"
              position="top"
              content={({ x, y, value, index }: any) => {
                const p = points[index];
                if (!p) return null;
                return (
                  <text x={x} y={y - 6} fill={p.faded ? '#aaa' : '#fff'} textAnchor="middle" fontSize={11}>
                    {value}
                  </text>
                );
              }}
            />
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>

      <div className="grid grid-cols-2 gap-1 text-xs text-text-secondary mt-1 px-12">
        <div className="text-left">🎯 Tight aggressive (TAG)</div>
        <div className="text-right">🔥 Loose aggressive (LAG)</div>
      </div>
      <p className="text-xs text-text-tertiary text-center mt-3">
        Quadrants split at VPIP {VPIP_CUTOFF}% / PFR {PFR_CUTOFF}%. Marker size = hands dealt; faded markers = small sample (&lt;{minHands} hands).
      </p>
    </div>
  );
}

function styleLabel(vpip: number, pfr: number): string {
  const loose = vpip >= VPIP_CUTOFF;
  const aggressive = pfr >= PFR_CUTOFF;
  if (loose && aggressive) return '🔥 Loose aggressive';
  if (loose && !aggressive) return '🤠 Loose passive (calling station)';
  if (!loose && aggressive) return '🎯 Tight aggressive';
  return '🪨 Tight passive (rock)';
}
