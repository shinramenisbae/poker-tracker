import { useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useSessions } from '../hooks/useStorage';
import type { Player } from '../types';
import type { NameRedirect } from '../api';
import { PlayerRow } from '../components/PlayerRow';
import { CashOutModal } from '../components/CashOutModal';
import { BuyInsModal } from '../components/BuyInsModal';
import {
  getTotalBuyIn,
  getSessionTotals,
  getLiveBalance,
  formatCurrency,
  formatDate,
} from '../utils/calculations';

export function SessionDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { getSession, endSession, setSessionRake, addPlayerToSession, addPlayerBuyIn, updatePlayerBuyIn, deletePlayerBuyIn, cashOutPlayer: cashOutPlayerApi, error, isLoading } = useSessions(id);

  const session = getSession(id || '');

  // Names the server added as someone else because of a merge — from the
  // starting roster (handed over by New Session) or from Add Player. Shown so
  // a wrong merge is caught at the table rather than weeks later.
  const location = useLocation();
  const [redirects, setRedirects] = useState<NameRedirect[]>(
    () => (location.state as { renamed?: NameRedirect[] } | null)?.renamed ?? []
  );

  const [showAddPlayer, setShowAddPlayer] = useState(false);
  const [newPlayerName, setNewPlayerName] = useState('');
  const [cashOutPlayer, setCashOutPlayer] = useState<Player | null>(null);
  const [customBuyInPlayer, setCustomBuyInPlayer] = useState<Player | null>(null);
  const [customBuyInAmount, setCustomBuyInAmount] = useState('');
  const [customBuyInMethod, setCustomBuyInMethod] = useState<'cash' | 'bank'>('cash');
  // Rebuy prompt: any buy-in after a player's first opens a confirm step asking
  // whether it's a top-up or a full-stack rebuy (optionally: with what hand).
  // Doubles as double-tap protection on the quick +$ buttons.
  const [rebuyPrompt, setRebuyPrompt] = useState<{ player: Player; amount: number; method: 'cash' | 'bank' } | null>(null);
  const [rebuyType, setRebuyType] = useState<'top-up' | 'stacked'>('top-up');
  const [stackedHand, setStackedHand] = useState('');
  const [editBuyInsPlayer, setEditBuyInsPlayer] = useState<Player | null>(null);
  const [showEndSession, setShowEndSession] = useState(false);
  // The rake is counted with the stacks at the end of the night, so it is
  // entered here while the session is live and saved straight away — anyone's
  // phone then shows whether the night adds up. null means showing what is
  // saved; otherwise it holds what is being typed.
  const [rakeDraft, setRakeDraft] = useState<{ amount: string; holder: string } | null>(null);
  const rakeInputRef = useRef<HTMLInputElement>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

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
  const balance = getLiveBalance(session);
  const allCashedOut = session.players.length > 0 && session.players.every((p) => p.cashOut !== null);
  const isLive = session.status === 'active';
  const savedRake = session.rakeAmount ?? 0;
  const rakeAmountShown = rakeDraft ? rakeDraft.amount : savedRake > 0 ? String(savedRake) : '';
  const rakeHolderShown = rakeDraft ? rakeDraft.holder : session.rakeHolder ?? '';
  const rakeChanged = rakeDraft !== null
    && ((Number(rakeDraft.amount) || 0) !== savedRake || (rakeDraft.holder.trim() || null) !== (session.rakeHolder ?? null));

  // Re-resolve the cash-out target from the live session on every render, so the
  // modal reflects the latest stored cash-out (the same pattern the buy-ins
  // modal already uses). `cashOutPlayer` is only a handle to which row is open.
  const cashOutTarget = cashOutPlayer
    ? session.players.find((p) => p.id === cashOutPlayer.id) ?? cashOutPlayer
    : null;

  const handleAddPlayer = async () => {
    if (!newPlayerName.trim() || actionLoading) return;

    setActionLoading(true);
    setActionError(null);

    try {
      const updated = await addPlayerToSession(session.id, {
        name: newPlayerName.trim(),
        buyIns: [],
        cashOut: null,
        paymentMethod: 'cash',
      });
      if (updated.renamed?.length) setRedirects(updated.renamed);

      setNewPlayerName('');
      setShowAddPlayer(false);
    } catch {
      setActionError('Failed to add player. Please try again.');
    } finally {
      setActionLoading(false);
    }
  };

  // Returns whether the buy-in was actually saved, so callers keep their modal
  // (and the user's typed input) open on failure instead of closing as if it
  // succeeded — a silently-unlogged rebuy is exactly the audit gap this
  // feature exists to close.
  const handleAddBuyIn = async (
    playerId: string,
    amount: number,
    method: 'cash' | 'bank' = 'cash',
    rebuy: { isRebuy?: boolean; rebuyType?: 'top-up' | 'stacked'; stackedHand?: string } = {}
  ): Promise<boolean> => {
    if (actionLoading) return false;

    setActionLoading(true);
    setActionError(null);

    try {
      await addPlayerBuyIn(session.id, playerId, amount, method, rebuy);
      return true;
    } catch {
      setActionError('Failed to add buy-in. Please try again.');
      return false;
    } finally {
      setActionLoading(false);
    }
  };

  // Quick +$ buttons: the first buy-in logs instantly; anything after that is a
  // rebuy, so open the top-up/stacked prompt instead of logging immediately.
  const handleQuickBuyIn = (player: Player, amount: number, method: 'cash' | 'bank') => {
    if (player.buyIns.length === 0) {
      handleAddBuyIn(player.id, amount, method);
      return;
    }
    setRebuyType('top-up');
    setStackedHand('');
    setRebuyPrompt({ player, amount, method });
  };

  const confirmRebuy = async () => {
    if (!rebuyPrompt || actionLoading) return;
    const saved = await handleAddBuyIn(rebuyPrompt.player.id, rebuyPrompt.amount, rebuyPrompt.method, {
      isRebuy: true,
      rebuyType,
      stackedHand: rebuyType === 'stacked' && stackedHand.trim() ? stackedHand.trim() : undefined,
    });
    // On failure, keep the prompt (and typed hand) open so the rebuy isn't
    // silently dropped — the error banner explains what happened.
    if (saved) {
      setRebuyPrompt(null);
      setStackedHand('');
    }
  };

  const handleCashOut = async (playerId: string, amount: number) => {
    if (actionLoading) return;

    setActionLoading(true);
    setActionError(null);

    try {
      await cashOutPlayerApi(session.id, playerId, amount);
      setCashOutPlayer(null);
    } catch {
      setActionError('Failed to cash out player. Please try again.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleCustomBuyIn = async () => {
    if (!customBuyInPlayer || !customBuyInAmount || actionLoading) return;

    const amount = parseFloat(customBuyInAmount);
    if (isNaN(amount) || amount <= 0) return;

    // A custom amount after the first buy-in is a rebuy: carry the top-up/
    // stacked choice made inline in the custom modal.
    const isRebuy = customBuyInPlayer.buyIns.length > 0;
    const saved = await handleAddBuyIn(customBuyInPlayer.id, amount, customBuyInMethod, isRebuy ? {
      isRebuy: true,
      rebuyType,
      stackedHand: rebuyType === 'stacked' && stackedHand.trim() ? stackedHand.trim() : undefined,
    } : {});
    // Keep the modal (amount + hand intact) open on failure.
    if (saved) {
      setCustomBuyInPlayer(null);
      setCustomBuyInAmount('');
      setStackedHand('');
    }
  };

  const handleUpdateBuyIn = async (playerId: string, buyInId: string, amount: number, method: 'cash' | 'bank') => {
    if (actionLoading) return;
    setActionLoading(true);
    setActionError(null);
    try {
      await updatePlayerBuyIn(session.id, playerId, buyInId, amount, method);
    } catch {
      setActionError('Failed to update buy-in. Please try again.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteBuyIn = async (playerId: string, buyInId: string) => {
    if (actionLoading) return;
    setActionLoading(true);
    setActionError(null);
    try {
      await deletePlayerBuyIn(session.id, playerId, buyInId);
    } catch {
      setActionError('Failed to delete buy-in. Please try again.');
    } finally {
      setActionLoading(false);
    }
  };

  // Returns whether the rake is now saved, so End Session can wait on it.
  const handleSaveRake = async (): Promise<boolean> => {
    if (!rakeDraft || actionLoading) return !rakeChanged;
    const amount = Number(rakeDraft.amount);
    if (rakeDraft.amount.trim() !== '' && (Number.isNaN(amount) || amount < 0)) {
      setActionError('Rake must be $0 or more.');
      return false;
    }
    setActionLoading(true);
    setActionError(null);
    try {
      await setSessionRake(session.id, amount || 0, rakeDraft.holder.trim() || null);
      setRakeDraft(null);
      return true;
    } catch {
      setActionError('Failed to save the rake. Please try again.');
      return false;
    } finally {
      setActionLoading(false);
    }
  };

  // A rake typed but not saved yet is saved first, so End Session never ends
  // the night on a different figure from the one on screen.
  const openEndSession = async () => {
    setActionError(null);
    if (rakeChanged && !(await handleSaveRake())) return;
    setRakeDraft(null);
    setShowEndSession(true);
  };

  const editRakeFromEndSession = () => {
    setShowEndSession(false);
    rakeInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    rakeInputRef.current?.focus();
  };

  const handleEndSession = async () => {
    if (actionLoading) return;

    setActionLoading(true);
    setActionError(null);

    try {
      // The server merges any duplicate entries — a player who cashed out and
      // rejoined is one person — picks the banker from the merged results, and
      // records the rake saved during the session in the ledger.
      const { merges, rake } = await endSession(session.id);
      setShowEndSession(false);
      navigate(`/session/${session.id}/results`, { state: { merges, rake } });
    } catch {
      setActionError('Failed to end session. Please try again.');
    } finally {
      // Was only cleared on the error path; on success the page relied on
      // navigate() unmounting it, so any nav hiccup left it stuck "Processing…".
      setActionLoading(false);
    }
  };

  return (
    <div className="min-h-full bg-bg-primary">
      {/* Header */}
      <header className="sticky top-0 bg-bg-primary/95 backdrop-blur-sm border-b border-bg-tertiary z-10">
        <div className="max-w-3xl mx-auto px-4 py-4">
          <div className="flex items-center gap-4 mb-2">
            <button
              onClick={() => navigate('/')}
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
            <button
              onClick={() => navigate(`/session/${session.id}/ev`)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full hover:bg-bg-tertiary transition-colors text-sm text-text-primary"
              title="All-in EV chart"
            >
              🎰 <span className="hidden sm:inline">Luck box</span>
            </button>
            <span
              className={`badge ${
                session.status === 'active' ? 'badge-active' : 'badge-completed'
              }`}
            >
              {session.status === 'active' ? 'Active' : 'Completed'}
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 pb-32">
        {/* Error Display */}
        {(error || actionError) && (
          <div className="card border-accent-negative mb-4">
            <p className="text-accent-negative font-medium">⚠️ {error || actionError}</p>
          </div>
        )}

        {/* A typed name added as someone else. Usually right — Dre is Jeremy —
            but a wrong merge would otherwise relabel a player silently. */}
        {redirects.length > 0 && (
          <div role="status" className="card border-accent-amber mb-4 flex items-start gap-3">
            <div className="flex-1 text-sm text-text-primary">
              {redirects.map((r) => (
                <p key={r.from}>
                  “{r.from}” was added as <span className="font-semibold">{r.to}</span>.
                </p>
              ))}
              <p className="text-text-secondary mt-1">
                {redirects.length === 1 ? 'The two names were' : 'Those names were'} merged on the aliases page.
                If that isn't the same person, the merge was a mistake and needs undoing.
              </p>
            </div>
            <button
              onClick={() => setRedirects([])}
              aria-label="Dismiss"
              className="p-1 -m-1 rounded-full text-text-tertiary hover:text-text-primary"
            >
              ✕
            </button>
          </div>
        )}

        {/* Loading Overlay for Actions */}
        {actionLoading && (
          <div className="card mb-4 bg-accent-primary/5">
            <p className="text-accent-primary font-medium flex items-center gap-2">
              <span className="animate-spin">🎲</span>
              Processing...
            </p>
          </div>
        )}

        {/* Session Summary */}
        <div className="card mb-6">
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center">
              <p className="text-number-sm text-text-primary tabular-nums">
                {formatCurrency(totals.totalPot)}
              </p>
              <p className="text-xs text-text-tertiary mt-1">Total Pot</p>
            </div>
            <div className="text-center">
              <p className="text-number-sm text-text-primary tabular-nums">
                {formatCurrency(totals.totalCashOut + totals.rake)}
              </p>
              <p className="text-xs text-text-tertiary mt-1">
                Cashed Out{totals.rake > 0 ? ` + ${formatCurrency(totals.rake)} rake` : ''}
              </p>
            </div>
            {/* While anyone still holds chips the gap is just money in play;
                once every stack and the rake are in, it is the check. */}
            <div className="text-center" data-testid="live-balance">
              {balance.state === 'playing' && (
                <>
                  <p className="text-number-sm text-text-primary tabular-nums">{formatCurrency(balance.onTable)}</p>
                  <p className="text-xs text-text-tertiary mt-1">Still on the table</p>
                </>
              )}
              {balance.state === 'balanced' && (
                <>
                  <p className="text-number-sm text-accent-positive">✓</p>
                  <p className="text-xs text-accent-positive mt-1">Balanced</p>
                </>
              )}
              {(balance.state === 'short' || balance.state === 'over') && (
                <>
                  <p className="text-number-sm text-accent-negative tabular-nums">{formatCurrency(balance.by)}</p>
                  <p className="text-xs text-accent-negative mt-1">
                    {balance.state === 'short' ? 'Short — missing' : 'Over — too much counted'}
                  </p>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Players */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-text-primary">Players</h2>
            <span className="text-sm text-text-secondary">
              {session.players.filter((p) => p.cashOut !== null).length} / {session.players.length} cashed out
            </span>
          </div>

          {session.players.map((player) => (
            <PlayerRow
              key={player.id}
              player={player}
              onAddBuyIn={(amount, method) => handleQuickBuyIn(player, amount, method)}
              onCashOut={() => setCashOutPlayer(player)}
              onEditBuyIns={() => setEditBuyInsPlayer(player)}
              showCustomBuyIn={(method) => {
                setCustomBuyInPlayer(player);
                setCustomBuyInMethod(method);
                setRebuyType('top-up');
                setStackedHand('');
              }}
              disabled={actionLoading}
            />
          ))}

          {/* Add Player Button */}
          <button
            onClick={() => setShowAddPlayer(true)}
            disabled={actionLoading}
            className="w-full py-4 border-2 border-dashed border-accent-primary-light rounded-xl text-accent-primary font-medium hover:bg-accent-primary/5 transition-colors disabled:opacity-50"
          >
            + Add Player
          </button>

          {/* Rake: counted with the stacks, so it sits with them. Saving only
              records the number — ending the session is what credits whoever
              holds it and tells the rake channel. */}
          {isLive && (
            <div className="card">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold text-text-primary">Rake</h2>
                {!rakeChanged && savedRake > 0 && (
                  <span className="text-sm text-text-secondary">Saved</span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="live-rake-amount" className="block text-xs font-medium text-text-secondary mb-1">
                    Amount
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary">$</span>
                    <input
                      id="live-rake-amount"
                      ref={rakeInputRef}
                      type="number"
                      inputMode="decimal"
                      min="0"
                      value={rakeAmountShown}
                      onChange={(e) => setRakeDraft({ amount: e.target.value, holder: rakeHolderShown })}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleSaveRake(); }}
                      placeholder="0.00"
                      className="input w-full pl-7 tabular-nums"
                      disabled={actionLoading}
                    />
                  </div>
                </div>
                <div>
                  <label htmlFor="live-rake-holder" className="block text-xs font-medium text-text-secondary mb-1">
                    Held by
                  </label>
                  <input
                    id="live-rake-holder"
                    type="text"
                    value={rakeHolderShown}
                    onChange={(e) => setRakeDraft({ amount: rakeAmountShown, holder: e.target.value })}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSaveRake(); }}
                    placeholder="The banker"
                    className="input w-full"
                    list="live-rake-holder-options"
                    disabled={actionLoading}
                  />
                  <datalist id="live-rake-holder-options">
                    {session.players.map((p) => <option key={p.id} value={p.name} />)}
                  </datalist>
                </div>
              </div>
              <p className="text-xs text-text-tertiary mt-2">
                Leave "Held by" empty and it goes to whoever ends up banking.
              </p>
              {rakeChanged && (
                <div className="flex gap-3 mt-3">
                  <button
                    onClick={() => { setRakeDraft(null); setActionError(null); }}
                    disabled={actionLoading}
                    className="flex-1 btn-secondary disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveRake}
                    disabled={actionLoading}
                    className="flex-1 btn-primary disabled:opacity-50"
                  >
                    {actionLoading ? 'Saving…' : 'Save rake'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="fixed bottom-0 left-0 right-0 bg-surface-primary border-t border-bg-tertiary p-4">
        <div className="max-w-3xl mx-auto flex gap-3">
          <button
            onClick={() => navigate(`/session/${session.id}/results`)}
            className="flex-1 btn-secondary"
          >
            View Results
          </button>
          <button
            onClick={openEndSession}
            disabled={!allCashedOut || session.status === 'completed' || actionLoading}
            className="flex-1 btn-primary disabled:opacity-50"
          >
            {actionLoading 
              ? 'Processing...' 
              : session.status === 'completed' 
                ? 'Session Ended' 
                : 'End Session'}
          </button>
        </div>
      </footer>

      {/* End Session: the rake was entered with the stacks, so this only
          confirms it. A night that doesn't add up is flagged, not blocked —
          sometimes a chip is simply gone and the night still has to close. */}
      {showEndSession && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
          <div className="bg-surface-primary w-full max-w-md sm:rounded-2xl rounded-t-2xl p-6">
            <h2 className="text-xl font-semibold text-text-primary mb-4">End the session</h2>

            <div className="flex items-center justify-between bg-bg-tertiary rounded-xl px-4 py-3 mb-4">
              <p className="text-text-primary">
                {savedRake > 0
                  ? <>Rake <span className="font-semibold tabular-nums">{formatCurrency(savedRake)}</span>, held by {session.rakeHolder || 'the banker'}</>
                  : 'No rake entered'}
              </p>
              <button onClick={editRakeFromEndSession} className="text-sm font-medium text-accent-primary">
                Edit
              </button>
            </div>

            {(balance.state === 'short' || balance.state === 'over') && (
              <p className="text-sm text-accent-negative mb-4">
                ⚠ The pot is {balance.state} by {formatCurrency(balance.by)}. You can still end the session,
                but it's worth recounting first.
              </p>
            )}
            {balance.state === 'balanced' && (
              <p className="text-sm text-accent-positive mb-4">✓ The pot balances.</p>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setShowEndSession(false)}
                disabled={actionLoading}
                className="flex-1 btn-secondary disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleEndSession}
                disabled={actionLoading}
                className="flex-1 btn-primary disabled:opacity-50"
              >
                {actionLoading ? 'Ending…' : 'End session'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Player Modal */}
      {showAddPlayer && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
          <div className="bg-surface-primary w-full max-w-md sm:rounded-2xl rounded-t-2xl p-6">
            <h2 className="text-xl font-semibold text-text-primary mb-4">Add Player</h2>

            <div className="mb-6">
              <label className="block text-sm font-medium text-text-secondary mb-2">
                Name
              </label>
              <input
                type="text"
                value={newPlayerName}
                onChange={(e) => setNewPlayerName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddPlayer();
                }}
                placeholder="Player name"
                className="input w-full"
                autoFocus
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowAddPlayer(false);
                  setNewPlayerName('');
                }}
                className="flex-1 btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleAddPlayer}
                disabled={!newPlayerName.trim() || actionLoading}
                className="flex-1 btn-primary disabled:opacity-50"
              >
                {actionLoading ? 'Adding...' : 'Add Player'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cash Out Modal — always driven off the LIVE player from session.players,
          never the object captured when the button was tapped, so re-opening
          after an edit shows the stored value rather than stale/blank data.
          Keyed by player id so the amount field re-seeds per player. */}
      {cashOutTarget && (
        <CashOutModal
          key={cashOutTarget.id}
          playerName={cashOutTarget.name}
          currentBuyIn={getTotalBuyIn(cashOutTarget)}
          initialAmount={cashOutTarget.cashOut?.amount ?? null}
          onConfirm={(amount) => handleCashOut(cashOutTarget.id, amount)}
          onCancel={() => { setCashOutPlayer(null); setActionError(null); }}
          isLoading={actionLoading}
          error={actionError}
        />
      )}

      {/* Custom Buy-in Modal */}
      {customBuyInPlayer && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
          <div className="bg-surface-primary w-full max-w-md sm:rounded-2xl rounded-t-2xl p-6">
            <h2 className="text-xl font-semibold text-text-primary mb-2">
              Custom Buy-in
            </h2>
            <p className="text-text-secondary mb-4">For {customBuyInPlayer.name}</p>

            <div className="flex gap-1 bg-bg-tertiary rounded-lg p-0.5 mb-4">
              <button
                onClick={() => setCustomBuyInMethod('cash')}
                className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
                  customBuyInMethod === 'cash'
                    ? 'bg-accent-amber text-white shadow-sm'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                Cash
              </button>
              <button
                onClick={() => setCustomBuyInMethod('bank')}
                className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
                  customBuyInMethod === 'bank'
                    ? 'bg-accent-primary text-white shadow-sm'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                Bank
              </button>
            </div>

            <div className="mb-6">
              <label className="block text-sm font-medium text-text-secondary mb-2">
                Amount
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-text-tertiary text-lg">$</span>
                <input
                  type="number"
                  value={customBuyInAmount}
                  onChange={(e) => setCustomBuyInAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full h-16 pl-10 pr-4 text-2xl font-semibold bg-bg-tertiary rounded-xl border border-transparent focus:border-accent-primary focus:outline-none tabular-nums"
                  autoFocus
                />
              </div>
            </div>

            {/* Rebuy context — only after the player's first buy-in */}
            {customBuyInPlayer.buyIns.length > 0 && (
              <div className="mb-6">
                <label className="block text-sm font-medium text-text-secondary mb-2">
                  Rebuy type
                </label>
                <div className="flex gap-1 bg-bg-tertiary rounded-lg p-0.5 mb-3">
                  <button
                    onClick={() => setRebuyType('top-up')}
                    className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
                      rebuyType === 'top-up'
                        ? 'bg-accent-primary text-white shadow-sm'
                        : 'text-text-secondary hover:text-text-primary'
                    }`}
                  >
                    Top-up
                  </button>
                  <button
                    onClick={() => setRebuyType('stacked')}
                    className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
                      rebuyType === 'stacked'
                        ? 'bg-accent-negative text-white shadow-sm'
                        : 'text-text-secondary hover:text-text-primary'
                    }`}
                  >
                    Got stacked
                  </button>
                </div>
                {rebuyType === 'stacked' && (
                  <input
                    type="text"
                    value={stackedHand}
                    onChange={(e) => setStackedHand(e.target.value)}
                    placeholder="Hand they lost with (optional), e.g. AA"
                    className="input w-full"
                  />
                )}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setCustomBuyInPlayer(null);
                  setCustomBuyInAmount('');
                  setStackedHand('');
                }}
                disabled={actionLoading}
                className="flex-1 btn-secondary disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleCustomBuyIn}
                disabled={!customBuyInAmount || parseFloat(customBuyInAmount) <= 0 || actionLoading}
                className="flex-1 btn-primary disabled:opacity-50"
              >
                {actionLoading ? 'Adding...' : 'Add Buy-in'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rebuy Prompt (quick +$ buttons after the first buy-in) */}
      {rebuyPrompt && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
          <div className="bg-surface-primary w-full max-w-md sm:rounded-2xl rounded-t-2xl p-6">
            <h2 className="text-xl font-semibold text-text-primary mb-2">
              Rebuy — {formatCurrency(rebuyPrompt.amount)} {rebuyPrompt.method}
            </h2>
            <p className="text-text-secondary mb-4">For {rebuyPrompt.player.name}</p>

            <div className="flex gap-1 bg-bg-tertiary rounded-lg p-0.5 mb-4">
              <button
                onClick={() => setRebuyType('top-up')}
                disabled={actionLoading}
                className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
                  rebuyType === 'top-up'
                    ? 'bg-accent-primary text-white shadow-sm'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                Top-up
              </button>
              <button
                onClick={() => setRebuyType('stacked')}
                disabled={actionLoading}
                className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
                  rebuyType === 'stacked'
                    ? 'bg-accent-negative text-white shadow-sm'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                Got stacked
              </button>
            </div>

            {rebuyType === 'stacked' && (
              <div className="mb-4">
                <input
                  type="text"
                  value={stackedHand}
                  onChange={(e) => setStackedHand(e.target.value)}
                  placeholder="Hand they lost with (optional), e.g. AA"
                  className="input w-full"
                  disabled={actionLoading}
                />
              </div>
            )}

            <div className="flex gap-3">
              {/* Cancel is disabled while the POST is in flight: a mid-flight
                  "cancel" can't abort the request, so allowing it invites a
                  re-tap and a duplicate buy-in (same pattern as CashOutModal). */}
              <button
                onClick={() => {
                  setRebuyPrompt(null);
                  setStackedHand('');
                }}
                disabled={actionLoading}
                className="flex-1 btn-secondary disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmRebuy}
                disabled={actionLoading}
                className="flex-1 btn-primary disabled:opacity-50"
              >
                {actionLoading ? 'Adding...' : 'Log Rebuy'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Buy-ins Modal */}
      {editBuyInsPlayer && (
        <BuyInsModal
          player={session.players.find(p => p.id === editBuyInsPlayer.id) || editBuyInsPlayer}
          onUpdateBuyIn={(buyInId, amount, method) =>
            handleUpdateBuyIn(editBuyInsPlayer.id, buyInId, amount, method)
          }
          onDeleteBuyIn={(buyInId) =>
            handleDeleteBuyIn(editBuyInsPlayer.id, buyInId)
          }
          onClose={() => setEditBuyInsPlayer(null)}
          isLoading={actionLoading}
        />
      )}
    </div>
  );
}
