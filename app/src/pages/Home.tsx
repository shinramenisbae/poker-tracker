import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSessions } from '../hooks/useStorage';
import { SessionCard } from '../components/SessionCard';

export function Home() {
  console.log('HOME: Rendering');
  const navigate = useNavigate();
  const { sessions, deleteSession, isLoading, error, refreshSessions } = useSessions();
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  console.log('HOME: sessions=', sessions.length, 'isLoading=', isLoading, 'error=', error);

  const activeSessions = sessions.filter((s) => s.status === 'active');
  const completedSessions = sessions.filter((s) => s.status === 'completed');

  const handleDelete = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    if (deleteConfirm === sessionId) {
      try {
        setDeleteError(null);
        await deleteSession(sessionId);
        setDeleteConfirm(null);
      } catch (err) {
        setDeleteError('Failed to delete session. Please try again.');
        setDeleteConfirm(null);
      }
    } else {
      setDeleteConfirm(sessionId);
      // Auto-clear confirm after 3 seconds
      setTimeout(() => setDeleteConfirm((prev) => prev === sessionId ? null : prev), 3000);
    }
  };

  return (
    <div className="min-h-full bg-bg-primary">
      {/* Header */}
      <header className="sticky top-0 bg-bg-primary/95 backdrop-blur-sm border-b border-bg-tertiary z-10">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-text-primary">🎲 Tribe Poker Tracker</h1>
          <div className="flex items-center gap-2">
            {sessions.length > 0 && (
              <button
                onClick={() => navigate('/stats')}
                className="p-2 rounded-full hover:bg-bg-tertiary transition-colors"
                title="Statistics & Leaderboard"
              >
                📊
              </button>
            )}
            <button
              onClick={() => navigate('/settings')}
              className="p-2 rounded-full hover:bg-bg-tertiary transition-colors"
            >
              ⚙️
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 pb-24">
        {/* Loading State */}
        {isLoading && sessions.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="animate-spin text-4xl mb-4">🎲</div>
            <p className="text-text-secondary">Loading sessions...</p>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="card border-accent-negative mb-6">
            <p className="text-accent-negative font-medium">⚠️ {error}</p>
            <button
              onClick={refreshSessions}
              className="mt-2 text-sm text-accent-primary hover:underline"
            >
              Try again
            </button>
          </div>
        )}

        {/* Delete Error */}
        {deleteError && (
          <div className="card border-accent-negative mb-6">
            <p className="text-accent-negative font-medium">⚠️ {deleteError}</p>
          </div>
        )}

        {!isLoading && sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="text-6xl mb-4">🎲</div>
            <h2 className="text-xl font-semibold text-text-primary mb-2">
              No Sessions Yet
            </h2>
            <p className="text-text-secondary mb-6 max-w-xs">
              Start tracking your poker games and calculate settlements automatically
            </p>
            <button
              onClick={() => navigate('/session/new')}
              className="btn-primary px-8"
            >
              Start Your First Game
            </button>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Active Sessions */}
            {activeSessions.length > 0 && (
              <section>
                <h2 className="text-lg font-semibold text-text-primary mb-4">
                  Active Sessions
                </h2>
                <div className="space-y-4">
                  {activeSessions.map((session) => (
                    <SessionCard
                      key={session.id}
                      session={session}
                      onClick={() => navigate(`/session/${session.id}`)}
                      onDelete={(e) => handleDelete(e, session.id)}
                      isConfirmingDelete={deleteConfirm === session.id}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Completed Sessions */}
            {completedSessions.length > 0 && (
              <section>
                <h2 className="text-lg font-semibold text-text-primary mb-4">
                  Completed Sessions
                </h2>
                <div className="space-y-4">
                  {completedSessions.map((session) => (
                    <SessionCard
                      key={session.id}
                      session={session}
                      onClick={() => navigate(`/session/${session.id}`)}
                      onDelete={(e) => handleDelete(e, session.id)}
                      isConfirmingDelete={deleteConfirm === session.id}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </main>

      {/* Floating Action Button */}
      <button
        onClick={() => navigate('/session/new')}
        className="fixed bottom-6 right-6 w-14 h-14 bg-accent-primary text-white rounded-full shadow-lg flex items-center justify-center text-2xl hover:bg-accent-primary/90 active:scale-95 transition-all z-20"
      >
        +
      </button>
    </div>
  );
}
