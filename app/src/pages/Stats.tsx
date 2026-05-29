import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSessions } from '../hooks/useStorage';
import { getTotalBuyIn, getProfitLoss, formatCurrency, formatDate } from '../utils/calculations';
import { LuckLeaderboard } from '../components/LuckLeaderboard';
import { PlayerStyleChartCard } from '../components/PlayerStyleChartCard';
import { fetchPlayerStats, type PlayerStyleStats } from '../api';

interface PlayerStats {
  name: string;
  totalBuyIn: number;
  totalCashOut: number;
  profitLoss: number;
  sessionsPlayed: number;
  biggestWin: number;
  biggestLoss: number;
  sessionHistory: { date: string; profitLoss: number }[];
}

export function Stats() {
  const navigate = useNavigate();
  const { sessions } = useSessions();
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerStats | null>(null);

  const stats = useMemo(() => {
    const playerMap = new Map<string, PlayerStats>();

    sessions.forEach((session) => {
      session.players.forEach((player) => {
        const key = player.name.toLowerCase();
        const existing = playerMap.get(key);
        const buyIn = getTotalBuyIn(player);
        const cashOut = player.cashOut?.amount || 0;
        const pnl = getProfitLoss(player) ?? 0;

        if (existing) {
          existing.totalBuyIn += buyIn;
          existing.totalCashOut += cashOut;
          existing.profitLoss += pnl;
          existing.sessionsPlayed += 1;
          existing.biggestWin = Math.max(existing.biggestWin, pnl);
          existing.biggestLoss = Math.min(existing.biggestLoss, pnl);
          existing.sessionHistory.push({
            date: session.date,
            profitLoss: pnl,
          });
        } else {
          playerMap.set(key, {
            name: player.name.charAt(0).toUpperCase() + player.name.slice(1).toLowerCase(),
            totalBuyIn: buyIn,
            totalCashOut: cashOut,
            profitLoss: pnl,
            sessionsPlayed: 1,
            biggestWin: Math.max(0, pnl),
            biggestLoss: Math.min(0, pnl),
            sessionHistory: [{ date: session.date, profitLoss: pnl }],
          });
        }
      });
    });

    return Array.from(playerMap.values()).sort((a, b) => b.profitLoss - a.profitLoss);
  }, [sessions]);

  const globalStats = useMemo(() => {
    const totalBuyIns = stats.reduce((sum, p) => sum + p.totalBuyIn, 0);
    const totalCashOuts = stats.reduce((sum, p) => sum + p.totalCashOut, 0);

    let biggestPot = 0;
    let biggestPotDate = '';
    let biggestWin = { name: '', amount: 0, sessionDate: '', sessionNotes: '' };
    let biggestLoss = { name: '', amount: 0, sessionDate: '', sessionNotes: '' };

    sessions.forEach((session) => {
      const pot = session.players.reduce((sum, p) => sum + getTotalBuyIn(p), 0);
      if (pot > biggestPot) {
        biggestPot = pot;
        biggestPotDate = session.date;
      }

      session.players.forEach((player) => {
        const pnl = getProfitLoss(player);
        if (pnl !== null && pnl > biggestWin.amount) {
          biggestWin = {
            name: player.name.charAt(0).toUpperCase() + player.name.slice(1).toLowerCase(),
            amount: pnl,
            sessionDate: session.date,
            sessionNotes: session.notes,
          };
        }
        if (pnl !== null && pnl < biggestLoss.amount) {
          biggestLoss = {
            name: player.name.charAt(0).toUpperCase() + player.name.slice(1).toLowerCase(),
            amount: pnl,
            sessionDate: session.date,
            sessionNotes: session.notes,
          };
        }
      });
    });

    return {
      totalSessions: sessions.length,
      totalBuyIns,
      totalCashOuts,
      biggestWin,
      biggestLoss,
      biggestPot,
      biggestPotDate,
    };
  }, [stats, sessions]);

  if (sessions.length === 0) {
    return (
      <div className="min-h-full bg-bg-primary">
        <header className="sticky top-0 bg-bg-primary/95 backdrop-blur-sm border-b border-bg-tertiary z-10">
          <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-4">
            <button onClick={() => navigate('/')} className="p-2 rounded-full hover:bg-bg-tertiary">
              ←
            </button>
            <h1 className="text-2xl font-bold text-text-primary">📊 Statistics</h1>
          </div>
        </header>
        <main className="max-w-3xl mx-auto px-4 py-20 text-center">
          <p className="text-text-secondary">No sessions yet. Play some poker first!</p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-bg-primary">
      <header className="sticky top-0 bg-bg-primary/95 backdrop-blur-sm border-b border-bg-tertiary z-10">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-4">
          <button onClick={() => navigate('/')} className="p-2 rounded-full hover:bg-bg-tertiary">
            ←
          </button>
          <h1 className="text-2xl font-bold text-text-primary">📊 Statistics</h1>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 pb-24">
        {/* Global Stats */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold text-text-primary mb-4">Overview</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="card">
              <p className="text-2xl font-bold text-text-primary">{globalStats.totalSessions}</p>
              <p className="text-sm text-text-secondary">Total Sessions</p>
            </div>
            <div className="card">
              <p className="text-2xl font-bold text-text-primary">{formatCurrency(globalStats.totalBuyIns)}</p>
              <p className="text-sm text-text-secondary">Total Buy-ins</p>
            </div>
            {globalStats.biggestPot > 0 && (
              <div className="card col-span-2">
                <p className="text-2xl font-bold text-accent-primary">{formatCurrency(globalStats.biggestPot)}</p>
                <p className="text-sm text-text-secondary">Most Money on Table (Single Session)</p>
                {globalStats.biggestPotDate && (
                  <p className="text-xs text-text-tertiary mt-1">{formatDate(globalStats.biggestPotDate)}</p>
                )}
              </div>
            )}
          </div>
        </section>

        {/* Biggest Winner/Loser */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold text-text-primary mb-4">Highlights</h2>
          <div className="space-y-4">
            {globalStats.biggestWin.amount > 0 && (
              <div className="card bg-green-50 border-green-200">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-3xl">🏆</span>
                    <div>
                      <p className="text-sm text-text-secondary">Biggest Single Win</p>
                      <p className="text-xl font-bold text-green-700">{globalStats.biggestWin.name}</p>
                      <p className="text-lg font-semibold text-green-600">+{formatCurrency(globalStats.biggestWin.amount)}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium text-text-secondary">{globalStats.biggestWin.sessionNotes || 'Poker Session'}</p>
                    <p className="text-xs text-text-tertiary">{formatDate(globalStats.biggestWin.sessionDate)}</p>
                  </div>
                </div>
              </div>
            )}

            {globalStats.biggestLoss.amount < 0 && (
              <div className="card bg-red-50 border-red-200">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-3xl">💸</span>
                    <div>
                      <p className="text-sm text-text-secondary">Biggest Single Loss</p>
                      <p className="text-xl font-bold text-red-700">{globalStats.biggestLoss.name}</p>
                      <p className="text-lg font-semibold text-red-600">{formatCurrency(globalStats.biggestLoss.amount)}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium text-text-secondary">{globalStats.biggestLoss.sessionNotes || 'Poker Session'}</p>
                    <p className="text-xs text-text-tertiary">{formatDate(globalStats.biggestLoss.sessionDate)}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Player styles scatter chart (VPIP × PFR across all logged sessions) */}
        <section className="mb-6">
          <PlayerStyleChartCard />
        </section>

        {/* Luck box leaderboard (all-in EV across sessions with hand logs) */}
        <section className="mb-6">
          <LuckLeaderboard />
        </section>

        {/* Leaderboard */}
        <section>
          <h2 className="text-lg font-semibold text-text-primary mb-4">Leaderboard</h2>
          <div className="space-y-3">
            {stats.map((player, index) => (
              <div
                key={player.name}
                onClick={() => setSelectedPlayer(player)}
                className="card cursor-pointer hover:shadow-md transition-shadow"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl font-bold text-text-tertiary w-8">
                      #{index + 1}
                    </span>
                    <div>
                      <p className="font-semibold text-text-primary">{player.name}</p>
                      <p className="text-sm text-text-secondary">{player.sessionsPlayed} sessions</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p
                      className={`text-xl font-bold ${
                        player.profitLoss >= 0 ? 'text-green-600' : 'text-red-600'
                      }`}
                    >
                      {player.profitLoss >= 0 ? '+' : ''}
                      {formatCurrency(player.profitLoss)}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      {/* Player Detail Modal */}
      {selectedPlayer && (
        <PlayerDetailModal
          player={selectedPlayer}
          onClose={() => setSelectedPlayer(null)}
        />
      )}
    </div>
  );
}

function LifetimePnLChart({
  sessionHistory,
}: {
  sessionHistory: { date: string; profitLoss: number }[];
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // Calculate cumulative P&L
  const cumulativeData = useMemo(() => {
    const sorted = [...sessionHistory].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );
    let runningTotal = 0;
    return sorted.map((session, index) => {
      runningTotal += session.profitLoss;
      return {
        sessionNumber: index + 1,
        date: session.date,
        pnl: runningTotal,
      };
    });
  }, [sessionHistory]);

  if (cumulativeData.length === 0) {
    return <p className="text-text-secondary text-center py-8">No session data</p>;
  }

  // Chart dimensions
  const padding = 40;
  const chartWidth = 400 - padding * 2;
  const chartHeight = 200 - padding * 2;

  // Calculate scales
  const pnlValues = cumulativeData.map((d) => d.pnl);
  const minPnL = Math.min(...pnlValues, 0);
  const maxPnL = Math.max(...pnlValues, 0);
  const pnlRange = maxPnL - minPnL || 1;

  const getX = (index: number) =>
    padding + (index / (cumulativeData.length - 1 || 1)) * chartWidth;
  const getY = (pnl: number) =>
    padding + chartHeight - ((pnl - minPnL) / pnlRange) * chartHeight;

  // Line color based on final P&L
  const finalPnL = cumulativeData[cumulativeData.length - 1]?.pnl ?? 0;
  const lineColor = finalPnL >= 0 ? '#16a34a' : '#dc2626'; // green-600 or red-600

  // Create path for the line
  const pathData = cumulativeData
    .map((d, i) => `${i === 0 ? 'M' : 'L'} ${getX(i)} ${getY(d.pnl)}`)
    .join(' ');

  // Grid lines
  const gridLines = 5;
  const gridYPositions = Array.from({ length: gridLines + 1 }, (_, i) =>
    padding + (i / gridLines) * chartHeight
  );

  return (
    <div className="relative" style={{ width: '100%', height: 200 }}>
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 400 200`}
        preserveAspectRatio="xMidYMid meet"
        className="overflow-visible"
      >
        {/* Grid lines */}
        {gridYPositions.map((y, i) => (
          <line
            key={i}
            x1={padding}
            y1={y}
            x2={padding + chartWidth}
            y2={y}
            stroke="#e5e7eb"
            strokeWidth={1}
          />
        ))}

        {/* Zero line if within range */}
        {minPnL < 0 && maxPnL > 0 && (
          <line
            x1={padding}
            y1={getY(0)}
            x2={padding + chartWidth}
            y2={getY(0)}
            stroke="#9ca3af"
            strokeWidth={1}
            strokeDasharray="4,4"
          />
        )}

        {/* X-axis */}
        <line
          x1={padding}
          y1={padding + chartHeight}
          x2={padding + chartWidth}
          y2={padding + chartHeight}
          stroke="#374151"
          strokeWidth={1}
        />

        {/* Y-axis */}
        <line
          x1={padding}
          y1={padding}
          x2={padding}
          y2={padding + chartHeight}
          stroke="#374151"
          strokeWidth={1}
        />

        {/* Y-axis labels */}
        {gridYPositions.map((y, i) => {
          const value = maxPnL - (i / gridLines) * pnlRange;
          return (
            <text
              key={i}
              x={padding - 8}
              y={y + 4}
              textAnchor="end"
              className="text-xs fill-text-tertiary"
              fontSize={10}
            >
              {formatCurrency(value)}
            </text>
          );
        })}

        {/* X-axis label */}
        <text
          x={padding + chartWidth / 2}
          y={padding + chartHeight + 25}
          textAnchor="middle"
          className="text-xs fill-text-secondary"
          fontSize={10}
        >
          Sessions
        </text>

        {/* Data line */}
        <path
          d={pathData}
          fill="none"
          stroke={lineColor}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Data points */}
        {cumulativeData.map((d, i) => (
          <circle
            key={i}
            cx={getX(i)}
            cy={getY(d.pnl)}
            r={hoveredIndex === i ? 6 : 4}
            fill={d.pnl >= 0 ? '#16a34a' : '#dc2626'}
            stroke="#fff"
            strokeWidth={2}
            className="cursor-pointer transition-all"
            onMouseEnter={() => setHoveredIndex(i)}
            onMouseLeave={() => setHoveredIndex(null)}
          />
        ))}
      </svg>

      {/* Tooltip */}
      {hoveredIndex !== null && (
        <div
          className="absolute bg-bg-secondary border border-bg-tertiary rounded-lg px-3 py-2 shadow-lg pointer-events-none z-10"
          style={{
            left: `${(getX(hoveredIndex) / 400) * 100}%`,
            top: `${(getY(cumulativeData[hoveredIndex].pnl) / 200) * 100}%`,
            transform: 'translate(-50%, -120%)',
          }}
        >
          <p className="text-sm font-semibold text-text-primary">
            Session #{cumulativeData[hoveredIndex].sessionNumber}
          </p>
          <p className="text-xs text-text-secondary">
            {new Date(cumulativeData[hoveredIndex].date).toLocaleDateString()}
          </p>
          <p
            className={`text-sm font-bold ${
              cumulativeData[hoveredIndex].pnl >= 0 ? 'text-green-600' : 'text-red-600'
            }`}
          >
            {cumulativeData[hoveredIndex].pnl >= 0 ? '+' : ''}
            {formatCurrency(cumulativeData[hoveredIndex].pnl)}
          </p>
        </div>
      )}
    </div>
  );
}

function PlayerDetailModal({
  player,
  onClose,
}: {
  player: PlayerStats;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'overview' | 'advanced'>('overview');
  const [styleStats, setStyleStats] = useState<PlayerStyleStats | null | 'missing'>(null);

  // Fetch advanced stats once on mount; case-insensitive match against the
  // canonical name. "missing" = endpoint succeeded but no row for this player
  // (no logs uploaded yet that involve them).
  useEffect(() => {
    let active = true;
    fetchPlayerStats()
      .then((rows) => {
        if (!active) return;
        const match = rows.find((r) => r.playerName.toLowerCase() === player.name.toLowerCase());
        setStyleStats(match ?? 'missing');
      })
      .catch(() => { if (active) setStyleStats('missing'); });
    return () => { active = false; };
  }, [player.name]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-bg-primary rounded-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-bold text-text-primary">{player.name}</h2>
            <button onClick={onClose} className="p-2 hover:bg-bg-tertiary rounded-full">
              ✕
            </button>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 border-b border-bg-tertiary mb-5">
            <TabButton active={tab === 'overview'} onClick={() => setTab('overview')}>Overview</TabButton>
            <TabButton active={tab === 'advanced'} onClick={() => setTab('advanced')}>Advanced stats</TabButton>
          </div>

          {tab === 'overview' && (
            <>
              {/* Stats Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
                <SummaryCard
                  value={`${player.profitLoss >= 0 ? '+' : ''}${formatCurrency(player.profitLoss)}`}
                  label="Total P&L"
                  color={player.profitLoss >= 0 ? 'text-green-600' : 'text-red-600'}
                  big
                />
                <SummaryCard value={String(player.sessionsPlayed)} label="Sessions" big />
                <SummaryCard
                  value={`+${formatCurrency(player.biggestWin)}`}
                  label="Biggest Win"
                  color="text-green-600"
                />
                <SummaryCard
                  value={formatCurrency(player.biggestLoss)}
                  label="Biggest Loss"
                  color="text-red-600"
                />
              </div>

              {/* Lifetime P&L Chart */}
              <div className="mb-4">
                <h3 className="text-lg font-semibold text-text-primary mb-3">Lifetime P&L</h3>
                <LifetimePnLChart sessionHistory={player.sessionHistory} />
              </div>
            </>
          )}

          {tab === 'advanced' && (
            <AdvancedStatsPanel data={styleStats} playerName={player.name} />
          )}

          <button onClick={onClose} className="btn-primary w-full mt-4">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
        active ? 'border-yellow-400 text-text-primary' : 'border-transparent text-text-secondary hover:text-text-primary'
      }`}
    >
      {children}
    </button>
  );
}

function SummaryCard({ value, label, color = 'text-text-primary', big = false }: {
  value: string; label: string; color?: string; big?: boolean;
}) {
  return (
    <div className="card">
      <p className={`${big ? 'text-2xl' : 'text-xl'} font-bold ${color}`}>{value}</p>
      <p className="text-sm text-text-secondary mt-1">{label}</p>
    </div>
  );
}

function AdvancedStatsPanel({ data, playerName }: { data: PlayerStyleStats | null | 'missing'; playerName: string }) {
  if (data === null) {
    return <div className="card text-center text-text-secondary text-sm py-8">Loading…</div>;
  }
  if (data === 'missing') {
    return (
      <div className="card text-center text-text-secondary text-sm py-8">
        No PokerNow hand logs uploaded yet that include <span className="font-semibold">{playerName}</span>.
        <br />Upload a log on any session they played in to see VPIP / PFR / AF here.
      </div>
    );
  }

  const pct = (n: number) => (n * 100).toFixed(1) + '%';
  const af = data.af == null ? '∞' : data.af.toFixed(2);
  const vpipPfrRatio = data.vpip > 0 ? ((data.pfr / data.vpip) * 100).toFixed(0) + '%' : '—';
  const style = styleLabel(data.vpip, data.pfr, data.af);

  return (
    <>
      <div className="card mb-4 text-center">
        <p className="text-lg font-semibold text-text-primary">{style}</p>
        <p className="text-xs text-text-secondary mt-1">
          Based on {data.handsDealt.toLocaleString()} hands across {data.sessions ?? 0} logged session{(data.sessions ?? 0) === 1 ? '' : 's'}.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatCard value={pct(data.vpip)} label="VPIP" help="Voluntarily Put $ In Pot" />
        <StatCard value={pct(data.pfr)} label="PFR" help="Pre-Flop Raise %" />
        <StatCard value={vpipPfrRatio} label="PFR / VPIP" help="Higher ratio = more aggressive style" />
        <StatCard value={af} label="AF" help="Postflop (bets + raises) / calls" />
      </div>

      <div className="card">
        <h4 className="text-sm font-semibold text-text-primary mb-2">Postflop breakdown</h4>
        <div className="grid grid-cols-3 gap-2 text-sm">
          <PostflopCell label="Bets" value={data.postflopBets} />
          <PostflopCell label="Raises" value={data.postflopRaises} />
          <PostflopCell label="Calls" value={data.postflopCalls} />
        </div>
      </div>

      <p className="text-xs text-text-tertiary text-center mt-3">
        Stats only count hands from sessions where a PokerNow hand log was uploaded.
        Group-relative quadrant chart is on the main /stats page.
      </p>
    </>
  );
}

function StatCard({ value, label, help }: { value: string; label: string; help: string }) {
  return (
    <div className="card text-center" title={help}>
      <p className="text-2xl font-bold text-text-primary tabular-nums">{value}</p>
      <p className="text-xs font-semibold text-text-secondary mt-1">{label}</p>
      <p className="text-xs text-text-tertiary mt-0.5">{help}</p>
    </div>
  );
}

function PostflopCell({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center bg-bg-secondary rounded p-2">
      <p className="text-lg font-semibold text-text-primary tabular-nums">{value}</p>
      <p className="text-xs text-text-secondary">{label}</p>
    </div>
  );
}

function styleLabel(vpip: number, pfr: number, af: number | null): string {
  // Absolute thresholds for the label here (it's a player-by-player view, not
  // group-relative). Looser conventions than online cash to suit home games.
  const loose = vpip >= 0.35;
  const passive = (af == null ? 0 : af) < 1 || pfr < 0.12;
  if (loose && !passive) return '🔥 Loose Aggressive (LAG)';
  if (loose && passive) return '🤠 Loose Passive (Calling Station)';
  if (!loose && !passive) return '🎯 Tight Aggressive (TAG)';
  return '🪨 Tight Passive (Rock)';
}
