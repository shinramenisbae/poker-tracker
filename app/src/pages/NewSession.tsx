import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSessions, useSettings } from '../hooks/useStorage';
import { generateId } from '../utils/id';
import type { Session } from '../types';

export function NewSession() {
  const navigate = useNavigate();
  const { addSession, isLoading } = useSessions();
  const { settings, addCommonPlayer } = useSettings();

  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [initialPlayers, setInitialPlayers] = useState<string[]>([]);
  const [newPlayerName, setNewPlayerName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const handleAddPlayer = () => {
    if (newPlayerName.trim()) {
      setInitialPlayers([...initialPlayers, newPlayerName.trim()]);
      addCommonPlayer(newPlayerName.trim());
      setNewPlayerName('');
    }
  };

  const handleRemovePlayer = (index: number) => {
    setInitialPlayers(initialPlayers.filter((_, i) => i !== index));
  };

  const handleCreateSession = async () => {
    if (isCreating || isLoading) return;

    setIsCreating(true);
    setError(null);

    try {
      const session: Omit<Session, 'id' | 'createdAt' | 'updatedAt'> = {
        date,
        status: 'active',
        notes,
        bankPlayerId: null,
        players: initialPlayers.map((name) => ({
          id: generateId(),
          name,
          buyIns: [],
          cashOut: null,
          paymentMethod: 'cash',
        })),
      };

      const newSession = await addSession(session);
      navigate(`/session/${newSession.id}`);
    } catch (err) {
      setError('Failed to create session. Please try again.');
      setIsCreating(false);
    }
  };

  const isSubmitting = isCreating || isLoading;

  return (
    <div className="min-h-full bg-bg-primary">
      {/* Header */}
      <header className="sticky top-0 bg-bg-primary/95 backdrop-blur-sm border-b border-bg-tertiary z-10">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-4">
          <button
            onClick={() => navigate('/')}
            className="p-2 -ml-2 rounded-full hover:bg-bg-tertiary transition-colors"
          >
            ←
          </button>
          <h1 className="text-xl font-bold text-text-primary">New Session</h1>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 pb-32">
        {/* Error Display */}
        {error && (
          <div className="card border-accent-negative mb-6">
            <p className="text-accent-negative font-medium">⚠️ {error}</p>
          </div>
        )}

        <div className="space-y-6">
          {/* Date */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Date
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="input w-full"
              disabled={isSubmitting}
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Notes (Optional)
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g., Friday Night Poker"
              className="input w-full"
              disabled={isSubmitting}
            />
          </div>

          {/* Add Players */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Add Players
            </label>

            {/* Player Input */}
            <div className="flex gap-2">
              <input
                type="text"
                value={newPlayerName}
                onChange={(e) => setNewPlayerName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddPlayer();
                }}
                placeholder="Player name"
                className="input flex-1"
                disabled={isSubmitting}
              />
              <button
                onClick={handleAddPlayer}
                disabled={!newPlayerName.trim() || isSubmitting}
                className="btn-primary px-6 disabled:opacity-50"
              >
                Add
              </button>
            </div>

            {/* Common Players */}
            {settings.commonPlayers.length > 0 && (
              <div className="mt-3">
                <p className="text-xs text-text-tertiary mb-2">Quick add:</p>
                <div className="flex flex-wrap gap-2">
                  {settings.commonPlayers
                    .filter((p) => !initialPlayers.some(ip => ip.toLowerCase() === p.toLowerCase()))
                    .map((player) => (
                      <button
                        key={player}
                        onClick={() => setInitialPlayers([...initialPlayers, player])}
                        disabled={isSubmitting}
                        className="px-3 py-1.5 bg-bg-tertiary rounded-full text-sm text-text-secondary hover:bg-accent-primary-light transition-colors disabled:opacity-50"
                      >
                        + {player}
                      </button>
                    ))}
                </div>
              </div>
            )}
          </div>

          {/* Player List */}
          {initialPlayers.length > 0 && (
            <div className="card">
              <h3 className="text-sm font-semibold text-text-secondary mb-3">
                Players ({initialPlayers.length})
              </h3>
              <div className="space-y-2">
                {initialPlayers.map((player, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between py-2 px-3 bg-bg-tertiary rounded-lg"
                  >
                    <div>
                      <span className="font-medium text-text-primary">{player}</span>
                    </div>
                    <button
                      onClick={() => handleRemovePlayer(index)}
                      disabled={isSubmitting}
                      className="text-accent-negative hover:bg-accent-negative/10 px-2 py-1 rounded transition-colors disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="fixed bottom-0 left-0 right-0 bg-surface-primary border-t border-bg-tertiary p-4">
        <div className="max-w-3xl mx-auto">
          <button
            onClick={handleCreateSession}
            disabled={isSubmitting}
            className="w-full btn-primary disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isSubmitting && <span className="animate-spin">🎲</span>}
            {isSubmitting ? 'Creating Session...' : 'Create Session'}
          </button>
        </div>
      </footer>
    </div>
  );
}
