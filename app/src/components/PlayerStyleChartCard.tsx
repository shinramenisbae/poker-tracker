import { useEffect, useState } from 'react';
import { fetchPlayerStats, fetchSessionPlayerStats, type PlayerStyleStats } from '../api';
import { PlayerStyleChart } from './PlayerStyleChart';

// Two flavors of the same chart that fetch their own data — one aggregated
// across every session with a hand log uploaded, one for a single session.

export function PlayerStyleChartCard() {
  const [data, setData] = useState<PlayerStyleStats[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    fetchPlayerStats()
      .then((d) => { if (active) setData(d); })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : String(err)); });
    return () => { active = false; };
  }, []);
  if (error) return <div className="card border-red-500/40 bg-red-500/10 text-red-300 text-sm">{error}</div>;
  if (!data) return <div className="card text-text-secondary text-sm text-center">Loading player styles…</div>;
  return (
    <PlayerStyleChart
      data={data}
      minHands={100}
      title="🎯 Player styles"
      subtitle="VPIP vs PFR across every session with a hand log. Dividers sit at your group's median, so the centre is the average style for your group. Faded dot = small sample."
    />
  );
}

export function SessionPlayerStyleChartCard({ sessionId }: { sessionId: string }) {
  const [data, setData] = useState<PlayerStyleStats[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    fetchSessionPlayerStats(sessionId)
      .then((d) => { if (active) setData(d); })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : String(err)); });
    return () => { active = false; };
  }, [sessionId]);
  if (error) return <div className="card border-red-500/40 bg-red-500/10 text-red-300 text-sm">{error}</div>;
  if (!data || data.length === 0) return null;
  return (
    <PlayerStyleChart
      data={data}
      minHands={50}
      title="🎯 Player styles this session"
      subtitle="VPIP vs PFR for this session only. Single-session samples are noisy; cross-session view on /stats is more reliable."
    />
  );
}
