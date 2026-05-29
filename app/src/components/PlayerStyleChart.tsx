import { useMemo } from 'react';
import {
  ScatterChart, Scatter, XAxis, YAxis, Tooltip,
  ReferenceLine, ResponsiveContainer,
} from 'recharts';
import type { PlayerStyleStats } from '../api';

interface Props {
  data: PlayerStyleStats[];
  minHands?: number; // qualifying threshold for the group medians + axis range
  title?: string;
  subtitle?: string;
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[m - 1] + sorted[m]) / 2 : sorted[m];
}

export function PlayerStyleChart({ data, minHands = 50, title, subtitle }: Props) {
  const { points, vpipMid, pfrMid, xDomain, yDomain } = useMemo(() => {
    const points = data.map((d) => ({
      name: d.playerName,
      vpip: +(d.vpip * 100).toFixed(1),
      pfr: +(d.pfr * 100).toFixed(1),
      hands: d.handsDealt,
      af: d.af == null ? null : +d.af.toFixed(2),
      sessions: d.sessions,
      faded: d.handsDealt < minHands,
    }));

    // Medians use only the qualifying (full-opacity) players so a single
    // low-sample outlier (e.g. a guest who played 12 hands at 100% VPIP)
    // doesn't drag the centre line.
    const qualifying = points.filter((p) => !p.faded);
    const vpipMid = median(qualifying.map((p) => p.vpip)) || median(points.map((p) => p.vpip));
    const pfrMid = median(qualifying.map((p) => p.pfr)) || median(points.map((p) => p.pfr));

    // Fit the axes to the group's actual range, with 8-percentage-point padding
    // on every side. Falls back to a sane window when there's only one point.
    const xs = points.map((p) => p.vpip);
    const ys = points.map((p) => p.pfr);
    const xMin = Math.max(0, Math.floor(Math.min(...xs) - 8));
    const xMax = Math.min(100, Math.ceil(Math.max(...xs) + 8));
    const yMin = Math.max(0, Math.floor(Math.min(...ys) - 6));
    const yMax = Math.min(100, Math.ceil(Math.max(...ys) + 6));

    return {
      points,
      vpipMid,
      pfrMid,
      xDomain: [xMin, xMax] as [number, number],
      yDomain: [yMin, yMax] as [number, number],
    };
  }, [data, minHands]);

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
        <div className="text-left">🎯 Tighter & more aggressive (TAG)</div>
        <div className="text-right">🔥 Looser & more aggressive (LAG)</div>
      </div>

      <ResponsiveContainer width="100%" height={460}>
        <ScatterChart margin={{ top: 16, right: 60, bottom: 32, left: 16 }}>
          {/* No CartesianGrid — keeps the chart clean. The only lines are the
              two solid quadrant dividers at the group medians. */}
          <XAxis
            type="number" dataKey="vpip" name="VPIP"
            domain={xDomain}
            ticks={[xDomain[0], vpipMid, xDomain[1]]}
            stroke="#666" tick={{ fill: '#999', fontSize: 11 }}
            tickFormatter={(v) => `${Math.round(v)}%`}
            label={{ value: 'VPIP →  (looser)', position: 'insideBottom', offset: -10, fill: '#999', fontSize: 11 }}
          />
          <YAxis
            type="number" dataKey="pfr" name="PFR"
            domain={yDomain}
            ticks={[yDomain[0], pfrMid, yDomain[1]]}
            stroke="#666" tick={{ fill: '#999', fontSize: 11 }}
            tickFormatter={(v) => `${Math.round(v)}%`}
            label={{ value: 'PFR ↑  (more aggressive)', angle: -90, position: 'insideLeft', fill: '#999', fontSize: 11 }}
          />

          {/* Quadrant dividers — solid, brighter than the axes so they read as
              the meaningful lines on the chart. */}
          <ReferenceLine
            x={vpipMid} stroke="#facc15" strokeWidth={1.5} strokeOpacity={0.55}
            label={{ value: `median ${vpipMid.toFixed(0)}%`, position: 'top', fill: '#facc15', fontSize: 10 }}
          />
          <ReferenceLine
            y={pfrMid} stroke="#facc15" strokeWidth={1.5} strokeOpacity={0.55}
            label={{ value: `median ${pfrMid.toFixed(0)}%`, position: 'insideRight', fill: '#facc15', fontSize: 10 }}
          />

          <Tooltip
            cursor={false}
            content={({ payload }) => {
              if (!payload || payload.length === 0) return null;
              const p: any = payload[0].payload;
              const style = styleLabel(p.vpip, p.pfr, vpipMid, pfrMid);
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

          <Scatter
            data={points}
            shape={(props: any) => {
              const { cx, cy, payload } = props;
              if (cx == null || cy == null) return null;
              const faded = payload.faded;
              return (
                <g>
                  <circle
                    cx={cx} cy={cy} r={7}
                    fill={faded ? '#facc1566' : '#facc15'}
                    stroke={faded ? '#facc1599' : '#facc15'}
                    strokeWidth={1.5}
                  />
                  <text
                    x={cx + 10} y={cy + 4}
                    fill={faded ? '#aaa' : '#fff'}
                    fontSize={11}
                    fontWeight={faded ? 400 : 600}
                    style={{ pointerEvents: 'none' }}
                  >
                    {payload.name}
                  </text>
                </g>
              );
            }}
          />
        </ScatterChart>
      </ResponsiveContainer>

      <div className="grid grid-cols-2 gap-1 text-xs text-text-secondary mt-1 px-12">
        <div className="text-left">🪨 Tighter & more passive</div>
        <div className="text-right">🤠 Looser & more passive (calling station)</div>
      </div>
      <p className="text-xs text-text-tertiary text-center mt-3">
        Quadrants split at the group's median VPIP / PFR — so a player at the centre plays an average style for this group.
        Faded markers = small sample (&lt;{minHands} hands). All dots are the same size; hover for hand count.
      </p>
    </div>
  );
}

function styleLabel(vpip: number, pfr: number, vpipMid: number, pfrMid: number): string {
  const loose = vpip >= vpipMid;
  const aggressive = pfr >= pfrMid;
  if (loose && aggressive) return '🔥 Looser + more aggressive than group';
  if (loose && !aggressive) return '🤠 Looser + more passive than group';
  if (!loose && aggressive) return '🎯 Tighter + more aggressive than group';
  return '🪨 Tighter + more passive than group';
}
