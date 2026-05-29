import { useEffect, useMemo, useState, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { fetchSessionEv, uploadHandLog, type EvSeriesResponse } from '../api';
import { useSessions } from '../hooks/useStorage';

export function SessionEv() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { getSession } = useSessions();
  const session = id ? getSession(id) : null;

  const [data, setData] = useState<EvSeriesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [focusedPlayer, setFocusedPlayer] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!id) return;
    let active = true;
    (async () => {
      try {
        const d = await fetchSessionEv(id);
        if (active) setData(d);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [id]);

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !id) return;
    setUploading(true);
    setError(null);
    try {
      const text = await file.text();
      await uploadHandLog(id, text);
      const d = await fetchSessionEv(id);
      setData(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  // Sort players by Δ luck (most lucky first) so the order is meaningful.
  // Must run unconditionally — hook rules.
  const sortedPlayers = useMemo(() => {
    if (!data) return [];
    const totals = new Map<string, number>();
    for (const p of data.players) totals.set(p, 0);
    for (const entry of data.series) {
      for (const [p, v] of Object.entries(entry.perPlayer)) {
        totals.set(p, (totals.get(p) || 0) + (v.actualNet - v.expectedNet));
      }
    }
    return [...data.players].sort((a, b) => (totals.get(b) || 0) - (totals.get(a) || 0));
  }, [data]);

  if (loading) return <div className="p-8 text-text-secondary">Loading…</div>;
  const hasData = data && data.series.length > 0;

  return (
    <div className="min-h-full bg-bg-primary">
      <header className="sticky top-0 bg-bg-primary/95 backdrop-blur-sm border-b border-bg-tertiary z-10">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-3">
          <button onClick={() => navigate(`/session/${id}/results`)} className="p-2 rounded-full hover:bg-bg-tertiary">←</button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-text-primary">🎰 Who's a luck box?</h1>
            <p className="text-sm text-text-secondary">
              {session ? session.date : ''} · {hasData ? `${data!.players.length} players, ${data!.series.length} hands — sorted lucky → unlucky` : ''}
            </p>
          </div>
          {hasData && (
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="text-sm text-yellow-400 hover:underline disabled:opacity-50"
            >
              {uploading ? 'Uploading…' : 'Re-upload log'}
            </button>
          )}
          <input ref={fileInputRef} type="file" accept=".csv,.txt,.log" onChange={handleFileUpload} className="hidden" />
        </div>
      </header>

      {error && (
        <div className="max-w-5xl mx-auto px-4 mt-3">
          <div className="bg-red-500/10 border border-red-500/40 text-red-300 rounded px-3 py-2 text-sm">{error}</div>
        </div>
      )}

      <main className="max-w-5xl mx-auto px-4 py-6">
        {!hasData ? (
          <div className="bg-bg-secondary rounded-lg p-8 text-center">
            <p className="text-text-primary text-lg mb-2">No hand log uploaded for this session yet.</p>
            <p className="text-text-secondary text-sm mb-6">
              Download the log from PokerNow (Ledger → Download log) and upload it here to see all-in EV vs actual.
            </p>
            <input
              type="file"
              accept=".csv,.txt,.log"
              onChange={handleFileUpload}
              disabled={uploading}
              className="block mx-auto text-sm text-text-secondary file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:bg-yellow-400 file:text-bg-primary file:font-semibold file:cursor-pointer disabled:opacity-50"
            />
            {uploading && <p className="text-sm text-text-secondary mt-3">Parsing + computing equity…</p>}
          </div>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
              {focusedPlayer ? (
                <button
                  onClick={() => setFocusedPlayer(null)}
                  className="px-3 py-1 rounded-full bg-yellow-400 text-bg-primary font-semibold hover:bg-yellow-300"
                >
                  ← Show all players
                </button>
              ) : (
                <span className="text-text-secondary">Tap any player to focus.</span>
              )}
              <span className="text-text-secondary ml-auto">
                <span className="text-green-400 font-semibold">Win/loss</span> vs{' '}
                <span className="text-orange-400 font-semibold">All-in EV</span> — gap = luck.
              </span>
            </div>
            <div className="space-y-4">
              {(focusedPlayer ? [focusedPlayer] : sortedPlayers).map((player) => (
                <PlayerChartCard
                  key={player}
                  player={player}
                  data={data!}
                  focused={focusedPlayer === player}
                  onToggleFocus={() => setFocusedPlayer((prev) => (prev === player ? null : player))}
                />
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function PlayerChartCard({
  player, data, focused, onToggleFocus,
}: {
  player: string;
  data: EvSeriesResponse;
  focused: boolean;
  onToggleFocus: () => void;
}) {
  const { chartData, totals } = useMemo(() => {
    let cumA = 0, cumE = 0;
    let allInHands = 0;
    const points: { hand: number; actual: number; expected: number }[] = [];
    for (const entry of data.series) {
      const p = entry.perPlayer[player];
      if (p) {
        cumA += p.actualNet;
        cumE += p.expectedNet;
        if (p.isAllInEv) allInHands++;
      }
      points.push({ hand: entry.handIndex + 1, actual: round2(cumA), expected: round2(cumE) });
    }
    return {
      chartData: points,
      totals: { actual: cumA, expected: cumE, delta: cumA - cumE, allInHands },
    };
  }, [player, data]);

  const fmt = (n: number) => (n >= 0 ? '+' : '−') + '$' + Math.abs(n).toFixed(2);
  const deltaColor = totals.delta >= 0 ? 'text-green-400' : 'text-red-400';
  const deltaEmoji = totals.delta >= 0 ? '🍀' : '🥶';
  const chartHeight = focused ? 420 : 180;

  return (
    <div className={`bg-bg-secondary rounded-lg p-3 ${focused ? 'ring-2 ring-yellow-400' : ''}`}>
      <button
        type="button"
        onClick={onToggleFocus}
        className="w-full flex items-center justify-between mb-2 px-1 cursor-pointer hover:bg-bg-tertiary/30 rounded transition-colors"
        title={focused ? 'Click to unfocus' : 'Click to focus this player'}
      >
        <h3 className="font-semibold text-text-primary flex items-center gap-2">
          {player}
          {focused && <span className="text-xs text-yellow-400">(focused)</span>}
        </h3>
        <div className="flex gap-4 text-xs">
          <span><span className="text-text-secondary">W/L</span> <span className={totals.actual >= 0 ? 'text-green-400' : 'text-red-400'}>{fmt(totals.actual)}</span></span>
          <span><span className="text-text-secondary">EV</span> <span className={totals.expected >= 0 ? 'text-green-400' : 'text-red-400'}>{fmt(totals.expected)}</span></span>
          <span className={`font-semibold ${deltaColor}`}>{fmt(totals.delta)} {deltaEmoji}</span>
          <span className="text-text-secondary">{totals.allInHands} AI</span>
        </div>
      </button>
      <ResponsiveContainer width="100%" height={chartHeight}>
        <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid stroke="#333" strokeDasharray="3 3" />
          <XAxis dataKey="hand" stroke="#999" tick={{ fill: '#888', fontSize: 10 }} interval="preserveStartEnd" />
          <YAxis stroke="#999" tick={{ fill: '#888', fontSize: 10 }} tickFormatter={(v) => `$${v}`} width={60} />
          <Tooltip
            contentStyle={{ background: '#1a1a1a', border: '1px solid #444', borderRadius: 4, color: '#eee', fontSize: 12 }}
            formatter={(value) => `$${Number(value ?? 0).toFixed(2)}`}
            labelFormatter={(label) => `Hand ${label}`}
          />
          <Line type="monotone" dataKey="actual" stroke="#22c55e" strokeWidth={focused ? 2.25 : 1.75} dot={false} name="Win/loss" isAnimationActive={false} />
          <Line type="monotone" dataKey="expected" stroke="#f59e0b" strokeWidth={focused ? 2.25 : 1.75} dot={false} name="All-in EV" isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function round2(n: number) { return Math.round(n * 100) / 100; }
