import { useEffect, useState } from 'react';
import { fetchLuckLeaderboard, type LuckLeaderboardEntry } from '../api';

export function LuckLeaderboard() {
  const [rows, setRows] = useState<LuckLeaderboardEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchLuckLeaderboard()
      .then((r) => { if (active) setRows(r); })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : String(err)); });
    return () => { active = false; };
  }, []);

  if (error) return (
    <div className="card border-red-500/40 bg-red-500/10">
      <p className="text-red-300 text-sm">Couldn't load luck leaderboard: {error}</p>
    </div>
  );
  if (!rows) return <div className="card text-center text-text-secondary text-sm">Loading luck box leaderboard…</div>;
  if (rows.length === 0) return (
    <div className="card text-center text-text-secondary text-sm">
      No hand logs uploaded yet. Upload PokerNow logs from a session's "Who's a luck box?" page to populate this.
    </div>
  );

  const fmt = (n: number) => (n >= 0 ? '+' : '−') + '$' + Math.abs(n).toFixed(2);

  return (
    <div className="card">
      <h3 className="text-lg font-semibold text-text-primary mb-3">🎰 Luck box leaderboard</h3>
      <p className="text-xs text-text-secondary mb-3">Sorted by lucky → unlucky. Δ is actual won minus equity-weighted expected on qualifying all-ins.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-text-secondary border-b border-bg-tertiary">
              <th className="text-left py-2 pr-2">Player</th>
              <th className="text-right py-2 px-2">All-ins</th>
              <th className="text-right py-2 px-2">Sessions</th>
              <th className="text-right py-2 px-2">Actual</th>
              <th className="text-right py-2 px-2">Expected</th>
              <th className="text-right py-2 pl-2">Δ luck</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.playerName} className={i % 2 === 0 ? 'bg-bg-primary/40' : ''}>
                <td className="py-2 pr-2 font-medium text-text-primary">{i + 1}. {r.playerName}</td>
                <td className="py-2 px-2 text-right text-text-secondary tabular-nums">{r.allInHands}</td>
                <td className="py-2 px-2 text-right text-text-secondary tabular-nums">{r.sessions}</td>
                <td className={`py-2 px-2 text-right tabular-nums ${r.actualOnAllIns >= 0 ? 'text-green-400' : 'text-red-400'}`}>{fmt(r.actualOnAllIns)}</td>
                <td className={`py-2 px-2 text-right tabular-nums ${r.expectedOnAllIns >= 0 ? 'text-green-400' : 'text-red-400'}`}>{fmt(r.expectedOnAllIns)}</td>
                <td className={`py-2 pl-2 text-right font-semibold tabular-nums ${r.luckDelta >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {fmt(r.luckDelta)}{r.luckDelta >= 0 ? ' 🍀' : ' 🥶'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
