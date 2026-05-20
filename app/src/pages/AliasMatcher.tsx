import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  fetchAliasMappings,
  setAliasMapping,
  type AliasMapping,
} from '../api';

const UNMAPPED_BUCKET = '__UNMAPPED__';

export function AliasMatcher() {
  const navigate = useNavigate();
  const [aliases, setAliases] = useState<AliasMapping[]>([]);
  const [canonicalPlayers, setCanonicalPlayers] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [newPlayer, setNewPlayer] = useState('');
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [selectedAlias, setSelectedAlias] = useState<string | null>(null);
  const [savingAlias, setSavingAlias] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Load data on mount and refresh every 15s so multiple friends see each other's progress.
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const data = await fetchAliasMappings();
        if (!active) return;
        setAliases(data.aliases);
        setCanonicalPlayers(data.canonicalPlayers);
        setError(null);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Failed to load aliases');
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    const interval = setInterval(load, 15000);
    return () => { active = false; clearInterval(interval); };
  }, []);

  // Group aliases by their target (or UNMAPPED_BUCKET for null)
  const grouped = useMemo(() => {
    const groups = new Map<string, string[]>();
    groups.set(UNMAPPED_BUCKET, []);
    for (const player of canonicalPlayers) groups.set(player, []);
    for (const a of aliases) {
      const key = a.realName ?? UNMAPPED_BUCKET;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(a.alias);
    }
    return groups;
  }, [aliases, canonicalPlayers]);

  const unmapped = grouped.get(UNMAPPED_BUCKET) ?? [];
  const visibleUnmapped = filter
    ? unmapped.filter((a) => a.toLowerCase().includes(filter.toLowerCase()))
    : unmapped;

  const totalMapped = aliases.filter((a) => a.realName).length;
  const totalAliases = aliases.length;

  // Single source of truth for "move this alias to this bucket". Used by both
  // drag-and-drop (desktop) and tap-to-select/tap-to-assign (mobile).
  async function assignAlias(alias: string, bucket: string) {
    const realName = bucket === UNMAPPED_BUCKET ? null : bucket;
    // optimistic update
    setAliases((prev) => prev.map((a) => (a.alias === alias ? { ...a, realName } : a)));
    setSavingAlias(alias);
    try {
      await setAliasMapping(alias, realName);
      setError(null);
    } catch (err) {
      setError(`Failed to save: ${err instanceof Error ? err.message : String(err)}`);
      const fresh = await fetchAliasMappings();
      setAliases(fresh.aliases);
    } finally {
      setSavingAlias(null);
    }
  }

  // --- drag/drop handlers (desktop) ---
  function handleDragStart(e: React.DragEvent, alias: string) {
    e.dataTransfer.setData('text/plain', alias);
    e.dataTransfer.effectAllowed = 'move';
  }
  function handleDragOver(e: React.DragEvent, bucket: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOver !== bucket) setDragOver(bucket);
  }
  function handleDragLeave(e: React.DragEvent) {
    if (e.currentTarget === e.target) setDragOver(null);
  }
  async function handleDrop(e: React.DragEvent, bucket: string) {
    e.preventDefault();
    setDragOver(null);
    const alias = e.dataTransfer.getData('text/plain');
    if (!alias) return;
    await assignAlias(alias, bucket);
  }

  // --- tap-to-select / tap-to-assign handlers (mobile + desktop) ---
  function handleAliasTap(alias: string) {
    setSelectedAlias((prev) => (prev === alias ? null : alias));
  }
  async function handleBucketTap(bucket: string) {
    if (!selectedAlias) return;
    const alias = selectedAlias;
    setSelectedAlias(null);
    await assignAlias(alias, bucket);
  }

  function handleAddPlayer() {
    const name = newPlayer.trim();
    if (!name) return;
    if (!canonicalPlayers.some((p) => p.toLowerCase() === name.toLowerCase())) {
      setCanonicalPlayers((prev) => [...prev, name].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })));
    }
    setNewPlayer('');
  }

  if (loading) {
    return <div className="p-8 text-text-secondary">Loading aliases…</div>;
  }

  return (
    <div className="min-h-full bg-bg-primary">
      <header className="sticky top-0 bg-bg-primary/95 backdrop-blur-sm border-b border-bg-tertiary z-10">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/')}
              className="p-2 rounded-full hover:bg-bg-tertiary"
              title="Back"
            >
              ←
            </button>
            <div>
              <h1 className="text-xl font-bold text-text-primary">Match Aliases</h1>
              <p className="text-sm text-text-secondary">
                Tap a name on the left, then tap the player it belongs to. (Or drag-and-drop on desktop.) Progress saves automatically.
              </p>
            </div>
          </div>
          <div className="text-right text-sm">
            <div className="text-text-primary font-semibold">{totalMapped} / {totalAliases}</div>
            <div className="text-text-secondary">mapped</div>
          </div>
        </div>
      </header>

      {error && (
        <div className="max-w-7xl mx-auto px-4 mt-3">
          <div className="bg-red-500/10 border border-red-500/40 text-red-300 rounded px-3 py-2 text-sm">{error}</div>
        </div>
      )}

      {selectedAlias && (
        <div className="sticky top-[72px] z-10 max-w-7xl mx-auto px-4 mt-3">
          <div className="bg-yellow-400/10 border border-yellow-400/60 rounded px-3 py-2 text-sm text-text-primary flex items-center justify-between gap-3">
            <span>
              Selected: <span className="font-semibold">{selectedAlias}</span>
              <span className="text-text-secondary"> — tap a player to assign, or tap the Unmapped area to remove.</span>
            </span>
            <button
              onClick={() => setSelectedAlias(null)}
              className="px-2 py-0.5 rounded bg-bg-tertiary text-text-primary text-xs hover:bg-bg-primary"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 py-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* LEFT: unmapped aliases */}
        <section
          className={`bg-bg-secondary rounded-lg p-4 border-2 transition-colors ${
            dragOver === UNMAPPED_BUCKET || (selectedAlias && grouped.get(UNMAPPED_BUCKET)?.indexOf(selectedAlias) === -1)
              ? 'border-yellow-400'
              : 'border-transparent'
          } ${selectedAlias && grouped.get(UNMAPPED_BUCKET)?.indexOf(selectedAlias) === -1 ? 'cursor-pointer' : ''}`}
          onDragOver={(e) => handleDragOver(e, UNMAPPED_BUCKET)}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, UNMAPPED_BUCKET)}
          onClick={() => handleBucketTap(UNMAPPED_BUCKET)}
        >
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-text-primary">
              Unmapped ({visibleUnmapped.length}{filter ? ` of ${unmapped.length}` : ''})
            </h2>
          </div>
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            placeholder="Filter…"
            className="w-full mb-3 px-3 py-1.5 rounded bg-bg-primary border border-bg-tertiary text-text-primary text-sm focus:outline-none focus:border-yellow-400"
          />
          <div className="flex flex-wrap gap-2 max-h-[70vh] overflow-y-auto pr-1">
            {visibleUnmapped.length === 0 ? (
              <div className="text-text-secondary text-sm italic">
                {filter ? 'No matches.' : '🎉 Nothing left to map!'}
              </div>
            ) : (
              visibleUnmapped.map((alias) => (
                <div
                  key={alias}
                  draggable
                  onDragStart={(e) => handleDragStart(e, alias)}
                  onClick={(e) => { e.stopPropagation(); handleAliasTap(alias); }}
                  className={`px-3 py-1.5 rounded-full text-text-primary text-sm cursor-pointer select-none border transition-colors ${
                    selectedAlias === alias
                      ? 'bg-yellow-400/20 border-yellow-400 ring-2 ring-yellow-400'
                      : 'bg-bg-tertiary border-bg-tertiary hover:border-yellow-400'
                  } ${savingAlias === alias ? 'opacity-50' : ''}`}
                  title="Tap to select, then tap a player on the right"
                >
                  {alias}
                </div>
              ))
            )}
          </div>
        </section>

        {/* RIGHT: canonical players */}
        <section className="bg-bg-secondary rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-text-primary">Players ({canonicalPlayers.length})</h2>
          </div>
          <div className="flex gap-2 mb-3">
            <input
              type="text"
              value={newPlayer}
              onChange={(e) => setNewPlayer(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddPlayer(); }}
              placeholder="Add a player not in the list…"
              className="flex-1 px-3 py-1.5 rounded bg-bg-primary border border-bg-tertiary text-text-primary text-sm focus:outline-none focus:border-yellow-400"
            />
            <button
              onClick={handleAddPlayer}
              disabled={!newPlayer.trim()}
              className="px-3 py-1.5 rounded bg-yellow-400 text-bg-primary text-sm font-semibold disabled:opacity-40"
            >
              Add
            </button>
          </div>
          <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
            {canonicalPlayers.map((player) => {
              const chips = grouped.get(player) ?? [];
              const isOver = dragOver === player;
              const isAssignTarget = selectedAlias != null;
              return (
                <div
                  key={player}
                  className={`rounded-lg border-2 p-3 transition-colors ${
                    isOver || isAssignTarget ? 'border-yellow-400 bg-bg-tertiary' : 'border-bg-tertiary bg-bg-primary'
                  } ${isAssignTarget ? 'cursor-pointer' : ''}`}
                  onDragOver={(e) => handleDragOver(e, player)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, player)}
                  onClick={() => handleBucketTap(player)}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-medium text-text-primary">{player}</div>
                    <div className="text-xs text-text-secondary">{chips.length} mapped</div>
                  </div>
                  <div className="flex flex-wrap gap-1.5 min-h-[2rem]">
                    {chips.length === 0 ? (
                      <div className="text-text-secondary text-xs italic self-center">
                        {isAssignTarget ? 'Tap to assign here' : 'Drop here'}
                      </div>
                    ) : (
                      chips.map((chip) => (
                        <div
                          key={chip}
                          draggable
                          onDragStart={(e) => handleDragStart(e, chip)}
                          onClick={(e) => { e.stopPropagation(); handleAliasTap(chip); }}
                          className={`px-2 py-0.5 rounded-full text-text-primary text-xs cursor-pointer select-none border transition-colors ${
                            selectedAlias === chip
                              ? 'bg-yellow-400/20 border-yellow-400 ring-2 ring-yellow-400'
                              : 'bg-bg-tertiary border-transparent hover:border-yellow-400'
                          } ${savingAlias === chip ? 'opacity-50' : ''}`}
                          title="Tap to select, then tap Unmapped to remove (or tap another player to re-assign)"
                        >
                          {chip}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}
