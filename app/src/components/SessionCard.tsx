import type { Session } from '../types';
import { formatDate, formatCurrency, getSessionTotals } from '../utils/calculations';

interface SessionCardProps {
  session: Session;
  onClick: () => void;
  onDelete?: (e: React.MouseEvent) => void;
  isConfirmingDelete?: boolean;
}

export function SessionCard({ session, onClick, onDelete, isConfirmingDelete }: SessionCardProps) {
  const totals = getSessionTotals(session);
  const playerCount = session.players?.length ?? 0;

  return (
    <div
      onClick={onClick}
      className="card cursor-pointer transition-transform active:scale-[0.99] hover:shadow-lg relative group"
    >
      {/* Delete button */}
      {onDelete && (
        <button
          onClick={onDelete}
          className={`absolute top-3 right-3 p-2 rounded-full transition-all z-10 ${
            isConfirmingDelete
              ? 'bg-red-500 text-white opacity-100'
              : 'text-text-tertiary hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100'
          }`}
          title={isConfirmingDelete ? 'Click again to confirm delete' : 'Delete session'}
        >
          {isConfirmingDelete ? '✓' : '🗑️'}
        </button>
      )}
      
      <div className={`flex items-start justify-between mb-3 ${onDelete ? 'pr-10' : ''}`}>
        <div>
          <h3 className="text-lg font-semibold text-text-primary">
            {session.notes || 'Poker Session'}
          </h3>
          <p className="text-sm text-text-secondary mt-1">
            {formatDate(session.date)}
          </p>
        </div>
        <span
          className={`badge ${
            session.status === 'active' ? 'badge-active' : 'badge-completed'
          }`}
        >
          {session.status === 'active' ? 'Active' : 'Completed'}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-4 mt-4">
        <div className="text-center">
          <p className="text-number-sm text-text-primary">{playerCount}</p>
          <p className="text-xs text-text-tertiary mt-1">Players</p>
        </div>
        <div className="text-center">
          <p className="text-number-sm text-text-primary tabular-nums">
            {formatCurrency(totals.totalPot)}
          </p>
          <p className="text-xs text-text-tertiary mt-1">In Play</p>
        </div>
        <div className="text-center">
          <p className="text-number-sm text-text-primary">
            {session.status === 'completed' ? 'Done' : 'In Progress'}
          </p>
          <p className="text-xs text-text-tertiary mt-1">Status</p>
        </div>
      </div>
    </div>
  );
}
