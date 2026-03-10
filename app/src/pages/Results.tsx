import { useNavigate, useParams } from 'react-router-dom';
import { useSessions } from '../hooks/useStorage';
import { SettlementView } from '../components/SettlementView';
import {
  getSessionTotals,
  getSettlementSummary,
  formatCurrency,
  formatDate,
} from '../utils/calculations';

export function Results() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { getSession, isLoading } = useSessions();

  const session = getSession(id || '');

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
              {totals.isBalanced ? '✓ Pot is balanced' : `⚠ Pot is off by ${formatCurrency(Math.abs(totals.totalPot - totals.totalCashOut))}`}
            </p>
          </div>
        </div>

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

      {/* Footer */}
      <footer className="fixed bottom-0 left-0 right-0 bg-surface-primary border-t border-bg-tertiary p-4">
        <div className="max-w-3xl mx-auto">
          <button
            onClick={() => navigate('/')}
            className="w-full btn-primary"
          >
            Back to Home
          </button>
        </div>
      </footer>
    </div>
  );
}
