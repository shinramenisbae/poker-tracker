import { useEffect, useMemo, useState, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
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
  const [selectedPlayer, setSelectedPlayer] = useState<string>('');
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!id) return;
    let active = true;
    (async () => {
      try {
        const d = await fetchSessionEv(id);
        if (!active) return;
        setData(d);
        if (d.players.length > 0 && !selectedPlayer) setSelectedPlayer(d.players[0]);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const chartData = useMemo(() => {
    if (!data || !selectedPlayer) return [];
    let cumActual = 0;
    let cumExpected = 0;
    const points: { hand: number; actual: number; expected: number; allInHere: boolean }[] = [];
    for (const entry of data.series) {
      const p = entry.perPlayer[selectedPlayer];
      if (p) {
        cumActual += p.actualNet;
        cumExpected += p.expectedNet;
      }
      points.push({
        hand: entry.handIndex + 1,
        actual: round2(cumActual),
        expected: round2(cumExpected),
        allInHere: !!(p && p.isAllInEv),
      });
    }
    return points;
  }, [data, selectedPlayer]);

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !id) return;
    setUploading(true);
    setError(null);
    try {
      const text = await file.text();
      const result = await uploadHandLog(id, text);
      // Refresh
      const d = await fetchSessionEv(id);
      setData(d);
      if (d.players.length > 0) setSelectedPlayer(d.players[0]);
      console.log('Uploaded', result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  if (loading) return <div className="p-8 text-text-secondary">Loading…</div>;

  const hasData = data && data.series.length > 0;

  return (
    <div className="min-h-full bg-bg-primary">
      <header className="sticky top-0 bg-bg-primary/95 backdrop-blur-sm border-b border-bg-tertiary z-10">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-3">
          <button onClick={() => navigate(`/session/${id}/results`)} className="p-2 rounded-full hover:bg-bg-tertiary">←</button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-text-primary">🎰 Who's a luck box?</h1>
            <p className="text-sm text-text-secondary">{session ? session.date : ''}</p>
          </div>
          {hasData && (
            <select
              value={selectedPlayer}
              onChange={(e) => setSelectedPlayer(e.target.value)}
              className="px-3 py-1.5 rounded bg-bg-secondary border border-bg-tertiary text-text-primary text-sm focus:outline-none focus:border-yellow-400"
            >
              {data!.players.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          )}
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
              ref={fileInputRef}
              type="file"
              accept=".csv,.txt,.log"
              onChange={handleFileUpload}
              disabled={uploading}
              className="block mx-auto text-sm text-text-secondary file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:bg-yellow-400 file:text-bg-primary file:font-semibold file:cursor-pointer disabled:opacity-50"
            />
            {uploading && <p className="text-sm text-text-secondary mt-3">Parsing + computing equity… (may take a few seconds for big sessions)</p>}
          </div>
        ) : (
          <>
            <div className="bg-bg-secondary rounded-lg p-4 mb-4">
              <ResponsiveContainer width="100%" height={420}>
                <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                  <CartesianGrid stroke="#333" strokeDasharray="3 3" />
                  <XAxis dataKey="hand" stroke="#999" tick={{ fill: '#999', fontSize: 12 }} />
                  <YAxis stroke="#999" tick={{ fill: '#999', fontSize: 12 }} tickFormatter={(v) => `$${v}`} />
                  <Tooltip
                    contentStyle={{ background: '#1a1a1a', border: '1px solid #444', borderRadius: 4, color: '#eee' }}
                    formatter={(value) => `$${Number(value ?? 0).toFixed(2)}`}
                    labelFormatter={(label) => `Hand ${label}`}
                  />
                  <Legend wrapperStyle={{ color: '#ccc' }} />
                  <Line type="monotone" dataKey="actual" stroke="#22c55e" strokeWidth={2} dot={false} name="Win/loss" />
                  <Line type="monotone" dataKey="expected" stroke="#f59e0b" strokeWidth={2} dot={false} name="All-in EV" />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <SummaryStrip data={data!} selectedPlayer={selectedPlayer} />

            <div className="mt-4 text-xs text-text-secondary text-center">
              <p>
                <span className="text-green-400 font-semibold">Win/loss</span> = actual chip change per hand.
                <span className="text-orange-400 font-semibold ml-2">All-in EV</span> = same, but all-in outcomes replaced by their equity-weighted expected value.
                Difference between the lines = how lucky/unlucky you ran on all-ins.
              </p>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="mt-3 text-yellow-400 hover:underline disabled:opacity-50"
              >
                Re-upload log
              </button>
              <input ref={fileInputRef} type="file" accept=".csv,.txt,.log" onChange={handleFileUpload} className="hidden" />
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function round2(n: number) { return Math.round(n * 100) / 100; }

function SummaryStrip({ data, selectedPlayer }: { data: EvSeriesResponse; selectedPlayer: string }) {
  const totals = useMemo(() => {
    let actual = 0, expected = 0, allInHands = 0;
    for (const entry of data.series) {
      const p = entry.perPlayer[selectedPlayer];
      if (!p) continue;
      actual += p.actualNet;
      expected += p.expectedNet;
      if (p.isAllInEv) allInHands++;
    }
    return { actual, expected, delta: actual - expected, allInHands };
  }, [data, selectedPlayer]);

  const card = (label: string, value: string, color = 'text-text-primary') => (
    <div className="flex-1 bg-bg-secondary rounded-lg p-3 text-center">
      <div className={`text-lg font-semibold ${color}`}>{value}</div>
      <div className="text-xs text-text-secondary mt-1">{label}</div>
    </div>
  );

  const fmt = (n: number) => (n >= 0 ? '+' : '−') + '$' + Math.abs(n).toFixed(2);
  const deltaColor = totals.delta >= 0 ? 'text-green-400' : 'text-red-400';
  const deltaLabel = totals.delta >= 0 ? 'Lucky 🍀' : 'Unlucky 🥶';

  return (
    <div className="flex gap-2 mb-2">
      {card('Win/loss', fmt(totals.actual), totals.actual >= 0 ? 'text-green-400' : 'text-red-400')}
      {card('All-in EV', fmt(totals.expected), totals.expected >= 0 ? 'text-green-400' : 'text-red-400')}
      {card(deltaLabel, fmt(totals.delta), deltaColor)}
      {card('All-in hands', String(totals.allInHands))}
    </div>
  );
}
