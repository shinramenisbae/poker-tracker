import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useSessions } from '../hooks/useStorage';
import { SettlementView } from '../components/SettlementView';
import {
  getSessionTotals,
  getSettlementSummary,
  formatCurrency,
  formatDate,
} from '../utils/calculations';
import {
  announceSessionToDiscord,
  reannounceSessionToDiscord,
  fetchSessionPayments,
  type SessionMerge,
} from '../api';

export function Results() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { getSession, isLoading, refreshSessions, changeBanker, setSessionRake } = useSessions(id);
  const [paidCount, setPaidCount] = useState<number | null>(null);
  const [showBankerPicker, setShowBankerPicker] = useState(false);
  const [bankerError, setBankerError] = useState<string | null>(null);
  const [bankerSaving, setBankerSaving] = useState(false);
  const [rakeEditing, setRakeEditing] = useState(false);
  const [rakeAmountInput, setRakeAmountInput] = useState('');
  const [rakeHolderInput, setRakeHolderInput] = useState('');
  const [rakeSaving, setRakeSaving] = useState(false);
  const [rakeError, setRakeError] = useState<string | null>(null);
  const [announceState, setAnnounceState] = useState<
    | { kind: 'idle' }
    | { kind: 'posting' }
    | { kind: 'reposting' }
    | { kind: 'done'; threadId?: string; alreadyAnnouncedThreadId?: string; reposted?: boolean }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  const session = getSession(id || '');

  // Handed over by End Session, not stored: it describes what just happened,
  // so it belongs in the navigation and is gone on reload.
  const merges = (useLocation().state as { merges?: SessionMerge[] } | null)?.merges ?? [];

  // Whether anyone has paid yet decides if the banking can still move: once
  // money is heading to the named banker, renaming them strands that payment.
  useEffect(() => {
    if (!id) return;
    let active = true;
    fetchSessionPayments(id)
      .then((res) => { if (active) setPaidCount(Object.keys(res.paid || {}).length); })
      .catch(() => { if (active) setPaidCount(null); });
    return () => { active = false; };
  }, [id]);

  // Detect prior announcement so the button reflects state.
  // Prefer the dedicated column; fall back to the legacy notes marker for
  // sessions announced before the discordThreadId column existed.
  const legacyMatch = session?.notes?.match(/Announced on Discord \(threadId=(\d+)\)/);
  const previousThreadId = session?.discordThreadId ?? legacyMatch?.[1] ?? null;

  async function handleAnnounce() {
    if (!session) return;
    setAnnounceState({ kind: 'posting' });
    try {
      const result = await announceSessionToDiscord(session.id);
      setAnnounceState({ kind: 'done', threadId: result.threadId, alreadyAnnouncedThreadId: result.alreadyAnnouncedThreadId });
    } catch (err) {
      setAnnounceState({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  // Deletes the old Discord thread and posts a fresh one with the current
  // numbers — for when a value turned out to be wrong after posting.
  async function handleRepost() {
    if (!session) return;
    if (!confirm(
      'Delete the existing Discord thread and post a corrected one?\n\n' +
      'The old thread and everything in it is permanently removed.'
    )) return;
    setAnnounceState({ kind: 'reposting' });
    try {
      const result = await reannounceSessionToDiscord(session.id);
      // Pull the new discordThreadId into the cached session so the button
      // state reflects reality without a manual page refresh.
      await refreshSessions();
      setAnnounceState({ kind: 'done', threadId: result.threadId, reposted: true });
    } catch (err) {
      setAnnounceState({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  if (!session) {
    if (isLoading) {
      return (
        <div className="min-h-full bg-bg-primary flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin text-4xl mb-4">🎲</div>
            <p className="text-text-secondary">Loading session...</p>
          </div>
        </div>
      );
    }
    return (
      <div className="min-h-full bg-bg-primary flex items-center justify-center">
        <div className="text-center">
          <p className="text-text-secondary">Session not found</p>
          <button
            onClick={() => navigate('/')}
            className="mt-4 btn-primary"
          >
            Go Home
          </button>
        </div>
      </div>
    );
  }

  const totals = getSessionTotals(session);
  const summary = getSettlementSummary(session);

  const bankerLockedReason = session.settledAt
    ? 'The books are closed on this session — reopen it with /finish first.'
    : paidCount && paidCount > 0
      ? `${paidCount === 1 ? 'Someone has' : `${paidCount} people have`} already paid the current banker — unmark the payment first.`
      : null;

  function openRakeEditor() {
    setRakeAmountInput(String(session!.rakeAmount ?? 0));
    setRakeHolderInput(session!.rakeHolder ?? '');
    setRakeError(null);
    setRakeEditing(true);
  }

  async function handleSaveRake() {
    if (rakeSaving) return;
    const amount = Number(rakeAmountInput);
    if (!Number.isFinite(amount) || amount < 0) {
      setRakeError('Enter $0 or more.');
      return;
    }
    setRakeSaving(true);
    setRakeError(null);
    try {
      await setSessionRake(session!.id, amount, rakeHolderInput.trim() || null);
      setRakeEditing(false);
    } catch (err) {
      setRakeError(err instanceof Error ? err.message : String(err));
    } finally {
      setRakeSaving(false);
    }
  }

  async function handleChangeBanker(playerId: string) {
    if (bankerSaving) return;
    setBankerSaving(true);
    setBankerError(null);
    try {
      await changeBanker(session!.id, playerId);
      setShowBankerPicker(false);
    } catch (err) {
      setBankerError(err instanceof Error ? err.message : String(err));
    } finally {
      setBankerSaving(false);
    }
  }

  return (
    <div className="min-h-full bg-bg-primary">
      {/* Header */}
      <header className="sticky top-0 bg-bg-primary/95 backdrop-blur-sm border-b border-bg-tertiary z-10">
        <div className="max-w-3xl mx-auto px-4 py-4">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate(`/session/${session.id}`)}
              className="p-2 -ml-2 rounded-full hover:bg-bg-tertiary transition-colors"
            >
              ←
            </button>
            <div className="flex-1">
              <h1 className="text-xl font-bold text-text-primary">
                {session.notes || 'Poker Session'}
              </h1>
              <p className="text-sm text-text-secondary">{formatDate(session.date)}</p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 pb-32">
        {/* What ending the session merged — a player who cashed out and came
            back was added as a second row, and is now one player again. */}
        {merges.length > 0 && (
          <div className="card mb-4 border-accent-primary">
            {merges.map((merge) => (
              <p key={merge.keepId} className="text-sm text-text-secondary">
                🔗 Merged {merge.name}&apos;s {merge.entries} entries — {formatCurrency(merge.totalBuyIn)} in,{' '}
                {formatCurrency(merge.totalCashOut)} out
              </p>
            ))}
          </div>
        )}

        {/* Session Summary */}
        <div className="card mb-6">
          <h2 className="text-lg font-semibold text-text-primary mb-4">Session Summary</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="text-center p-4 bg-bg-secondary rounded-xl">
              <p className="text-number-md text-text-primary tabular-nums">
                {formatCurrency(totals.totalPot)}
              </p>
              <p className="text-xs text-text-tertiary mt-1">Total Pot</p>
            </div>
            <div className="text-center p-4 bg-bg-secondary rounded-xl">
              <p className="text-number-md text-text-primary tabular-nums">
                {formatCurrency(totals.totalCashOut)}
              </p>
              <p className="text-xs text-text-tertiary mt-1">Total Cash Out</p>
            </div>
          </div>
          <div className="mt-4 text-center">
            <p className={`text-sm font-medium ${totals.isBalanced ? 'text-accent-positive' : 'text-accent-negative'}`}>
              {totals.isBalanced
                ? '✓ Pot is balanced'
                : `⚠ Pot is off by ${formatCurrency(Math.abs(totals.totalPot - totals.totalCashOut - totals.rake))}`}
            </p>
          </div>
        </div>

        {/* Rake: money that left the table before anyone was paid, owed by the
            bank to whoever is holding it. Editable with no lock — a typo in
            the amount should not be permanent. */}
        <div className="card mb-4">
          {rakeEditing ? (
            <div className="space-y-3">
              <div>
                <label htmlFor="rake-amount" className="block text-sm font-medium text-text-secondary mb-1">
                  Rake amount
                </label>
                <input
                  id="rake-amount"
                  type="number"
                  value={rakeAmountInput}
                  onChange={(e) => setRakeAmountInput(e.target.value)}
                  className="input w-full"
                  autoFocus
                />
              </div>
              <div>
                <label htmlFor="rake-holder" className="block text-sm font-medium text-text-secondary mb-1">
                  Held by
                </label>
                <input
                  id="rake-holder"
                  type="text"
                  value={rakeHolderInput}
                  onChange={(e) => setRakeHolderInput(e.target.value)}
                  placeholder={summary ? `${summary.bankPlayerName} (whoever banks)` : 'Whoever banks'}
                  className="input w-full"
                  list="rake-holder-options"
                />
                <datalist id="rake-holder-options">
                  {session.players.map((p) => <option key={p.id} value={p.name} />)}
                </datalist>
              </div>
              {rakeError && <p className="text-xs text-accent-negative">{rakeError}</p>}
              <div className="flex gap-2">
                <button onClick={() => setRakeEditing(false)} disabled={rakeSaving} className="flex-1 btn-secondary disabled:opacity-50">
                  Cancel
                </button>
                <button onClick={handleSaveRake} disabled={rakeSaving} className="flex-1 btn-primary disabled:opacity-50">
                  {rakeSaving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-text-secondary">
                🧾 Rake:{' '}
                <span className="font-semibold text-text-primary tabular-nums">{formatCurrency(totals.rake)}</span>
                {totals.rake > 0 && summary && (
                  <> — held by <span className="font-semibold text-text-primary">{summary.rake?.holderName}</span></>
                )}
              </p>
              <button onClick={openRakeEditor} className="btn-secondary text-sm px-3 py-1.5">
                Edit rake
              </button>
            </div>
          )}
        </div>

        {/* Who banks. The biggest winner by default, which is sometimes a
            newcomer when the group would rather a regular held the money. */}
        {summary && (
          <div className="card mb-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-text-secondary">
                Banking: <span className="font-semibold text-text-primary">{summary.bankPlayerName}</span>
              </p>
              <button
                onClick={() => { setShowBankerPicker(true); setBankerError(null); }}
                disabled={Boolean(bankerLockedReason) || bankerSaving}
                className="btn-secondary text-sm px-3 py-1.5 disabled:opacity-50"
                title={bankerLockedReason ?? 'Hand the banking to another player'}
              >
                Change banker
              </button>
            </div>
            {bankerLockedReason && (
              <p className="text-xs text-text-tertiary mt-2">{bankerLockedReason}</p>
            )}
            {bankerError && (
              <p className="text-xs text-accent-negative mt-2">{bankerError}</p>
            )}
          </div>
        )}

        {/* Settlement View */}
        {summary ? (
          <SettlementView summary={summary} />
        ) : (
          <div className="card text-center py-12">
            <p className="text-text-secondary">No settlement data available.</p>
            <p className="text-text-tertiary text-sm mt-2">Make sure all players have cashed out.</p>
          </div>
        )}
      </main>

      {/* Banker picker */}
      {showBankerPicker && summary && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
          <div className="bg-surface-primary w-full max-w-md sm:rounded-2xl rounded-t-2xl p-6">
            <h2 className="text-xl font-semibold text-text-primary mb-1">Who is banking?</h2>
            <p className="text-text-secondary text-sm mb-4">
              Everyone pays this player, and they pay the winners out.
            </p>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {session.players.map((p) => {
                const net = (p.cashOut?.amount ?? 0) - p.buyIns.reduce((sum, b) => sum + b.amount, 0);
                const isCurrent = p.id === summary.bankPlayerId;
                return (
                  <button
                    key={p.id}
                    onClick={() => handleChangeBanker(p.id)}
                    disabled={isCurrent || bankerSaving}
                    className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border transition-colors disabled:opacity-60 ${
                      isCurrent ? 'border-accent-primary bg-accent-primary/10' : 'border-bg-tertiary hover:bg-bg-tertiary'
                    }`}
                  >
                    <span className="text-text-primary">
                      {p.name}{isCurrent ? ' 🏦' : ''}
                    </span>
                    <span className={`tabular-nums text-sm ${net >= 0 ? 'text-accent-positive' : 'text-accent-negative'}`}>
                      {net >= 0 ? '+' : '−'}{formatCurrency(Math.abs(net))}
                    </span>
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => setShowBankerPicker(false)}
              disabled={bankerSaving}
              className="w-full btn-secondary mt-4 disabled:opacity-50"
            >
              {bankerSaving ? 'Saving…' : 'Cancel'}
            </button>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="fixed bottom-0 left-0 right-0 bg-surface-primary border-t border-bg-tertiary p-4">
        <div className="max-w-3xl mx-auto space-y-2">
          {(announceState.kind === 'done' || previousThreadId) && (
            <div className="bg-green-500/10 border border-green-500/40 text-green-300 rounded px-3 py-2 text-sm text-center">
              {announceState.kind === 'done' && announceState.alreadyAnnouncedThreadId
                ? `Already announced earlier (thread ${announceState.alreadyAnnouncedThreadId}).`
                : announceState.kind === 'done' && announceState.reposted
                ? `Old thread deleted — corrected results posted (thread ${announceState.threadId}).`
                : announceState.kind === 'done'
                ? `Posted to Discord (thread ${announceState.threadId}).`
                : `Already announced (thread ${previousThreadId}).`}
            </div>
          )}
          {announceState.kind === 'error' && (
            <div className="bg-red-500/10 border border-red-500/40 text-red-300 rounded px-3 py-2 text-sm text-center">
              {announceState.message}
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={handleAnnounce}
              disabled={announceState.kind === 'posting' || announceState.kind === 'reposting' || announceState.kind === 'done' || !!previousThreadId}
              className="flex-1 btn-primary disabled:opacity-50"
            >
              {announceState.kind === 'posting' ? 'Posting…' : previousThreadId ? '✓ Posted to Discord' : '📣 Post to Discord'}
            </button>
            {(previousThreadId || (announceState.kind === 'done' && announceState.threadId)) && (
              <button
                onClick={handleRepost}
                disabled={announceState.kind === 'posting' || announceState.kind === 'reposting'}
                className="flex-1 btn-secondary disabled:opacity-50"
                title="Delete the posted thread and post the corrected results"
              >
                {announceState.kind === 'reposting' ? 'Reposting…' : '♻️ Fix & repost'}
              </button>
            )}
            <button
              onClick={() => navigate('/')}
              className="flex-1 btn-secondary"
            >
              Back to Home
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
