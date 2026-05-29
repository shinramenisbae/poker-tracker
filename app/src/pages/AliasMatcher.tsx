import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  fetchAliasMappings,
  setAliasMapping,
  mergePlayers,
  deletePlayer,
  deleteAlias,
  deleteAllUnmappedAliases,
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
  const [mergeSource, setMergeSource] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
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

  async function handleDeleteSingleAlias(alias: string) {
    // Optimistic: remove from local state, then call API.
    setAliases((prev) => prev.filter((a) => a.alias !== alias));
    try {
      await deleteAlias(alias);
      setError(null);
    } catch (err) {
      setError(`Failed to delete alias: ${err instanceof Error ? err.message : String(err)}`);
      // Resync on error
      const fresh = await fetchAliasMappings();
      setAliases(fresh.aliases);
    }
  }

  async function handleClearAllUnmapped() {
    const unmappedCount = aliases.filter((a) => !a.realName).length;
    if (unmappedCount === 0) return;
    if (!window.confirm(`Delete all ${unmappedCount} unmapped aliases? They'll regenerate automatically if they appear in future online sessions.`)) return;
    try {
      await deleteAllUnmappedAliases();
      const fresh = await fetchAliasMappings();
      setAliases(fresh.aliases);
      setError(null);
    } catch (err) {
      setError(`Failed to clear: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget || deleting) return;
    const name = deleteTarget;
    setDeleting(true);
    try {
      await deletePlayer(name);
      const fresh = await fetchAliasMappings();
      setAliases(fresh.aliases);
      setCanonicalPlayers(fresh.canonicalPlayers);
      setDeleteTarget(null);
      setError(null);
    } catch (err) {
      setError(`Delete failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDeleting(false);
    }
  }

  async function handleMergeConfirm(into: string) {
    if (!mergeSource || merging) return;
    const from = mergeSource;
    setMerging(true);
    try {
      await mergePlayers(from, into);
      // Refetch — server state has changed across many rows
      const fresh = await fetchAliasMappings();
      setAliases(fresh.aliases);
      setCanonicalPlayers(fresh.canonicalPlayers);
      setMergeSource(null);
      setError(null);
    } catch (err) {
      setError(`Merge failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setMerging(false);
    }
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
              <h1 className="text-xl font-bold text-text-primary">Manage Players</h1>
              <p className="text-sm text-text-secondary">
                Tap a name on the left, then tap the player it belongs to. Or merge / delete a player from the row buttons on the right. (Drag-and-drop also works on desktop.)
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
            {unmapped.length > 0 && (
              <button
                onClick={(e) => { e.stopPropagation(); handleClearAllUnmapped(); }}
                className="text-xs text-text-secondary hover:text-red-400 px-2 py-1 rounded hover:bg-bg-tertiary"
                title="Delete every unmapped alias (they'll come back if seen again in new sessions)"
              >
                🧹 Clear all
              </button>
            )}
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
                  className={`group pl-3 pr-1 py-1.5 rounded-full text-text-primary text-sm cursor-pointer select-none border transition-colors flex items-center gap-1 ${
                    selectedAlias === alias
                      ? 'bg-yellow-400/20 border-yellow-400 ring-2 ring-yellow-400'
                      : 'bg-bg-tertiary border-bg-tertiary hover:border-yellow-400'
                  } ${savingAlias === alias ? 'opacity-50' : ''}`}
                  title="Tap to select, then tap a player on the right"
                >
                  <span>{alias}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteSingleAlias(alias); }}
                    className="text-text-secondary hover:text-red-400 hover:bg-bg-primary/40 rounded-full w-5 h-5 flex items-center justify-center text-xs ml-0.5"
                    title={`Delete alias "${alias}"`}
                  >
                    ×
                  </button>
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
                    <div className="flex items-center gap-2">
                      <div className="text-xs text-text-secondary">{chips.length} mapped</div>
                      <button
                        onClick={(e) => { e.stopPropagation(); setMergeSource(player); }}
                        className="text-xs text-text-secondary hover:text-yellow-400 px-1.5 py-0.5 rounded hover:bg-bg-tertiary"
                        title={`Merge "${player}" into another player`}
                      >
                        ⤴ merge
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setDeleteTarget(player); }}
                        className="text-xs text-text-secondary hover:text-red-400 px-1.5 py-0.5 rounded hover:bg-bg-tertiary"
                        title={`Delete "${player}" and all their data`}
                      >
                        🗑 delete
                      </button>
                    </div>
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

      {mergeSource && (
        <MergeModal
          source={mergeSource}
          candidates={canonicalPlayers.filter((p) => p !== mergeSource)}
          merging={merging}
          onCancel={() => setMergeSource(null)}
          onConfirm={handleMergeConfirm}
        />
      )}

      {deleteTarget && (
        <DeleteModal
          target={deleteTarget}
          aliasCount={(grouped.get(deleteTarget) ?? []).length}
          deleting={deleting}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={handleDeleteConfirm}
        />
      )}
    </div>
  );
}

function MergeModal({
  source, candidates, merging, onCancel, onConfirm,
}: {
  source: string;
  candidates: string[];
  merging: boolean;
  onCancel: () => void;
  onConfirm: (into: string) => void;
}) {
  const [filter, setFilter] = useState('');
  const [confirmTarget, setConfirmTarget] = useState<string | null>(null);
  const visible = filter
    ? candidates.filter((c) => c.toLowerCase().includes(filter.toLowerCase()))
    : candidates;

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4" onClick={onCancel}>
      <div className="bg-bg-secondary rounded-lg w-full max-w-md max-h-[80vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-bg-tertiary">
          <h2 className="font-semibold text-text-primary">
            Merge <span className="text-yellow-400">{source}</span> into…
          </h2>
          <p className="text-xs text-text-secondary mt-1">
            All aliases, sessions, and stats for "{source}" will move to the player you pick. This can't be undone.
          </p>
        </div>
        <div className="p-3 border-b border-bg-tertiary">
          <input
            autoFocus
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter players…"
            className="w-full px-3 py-1.5 rounded bg-bg-primary border border-bg-tertiary text-text-primary text-sm focus:outline-none focus:border-yellow-400"
          />
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {visible.length === 0 ? (
            <div className="text-text-secondary text-sm italic text-center py-4">No matches.</div>
          ) : (
            visible.map((c) => (
              <button
                key={c}
                onClick={() => setConfirmTarget(c)}
                className={`w-full text-left px-3 py-2 rounded text-text-primary text-sm hover:bg-bg-tertiary ${
                  confirmTarget === c ? 'bg-bg-tertiary' : ''
                }`}
              >
                {c}
              </button>
            ))
          )}
        </div>
        <div className="p-3 border-t border-bg-tertiary flex gap-2 justify-end">
          <button
            onClick={onCancel}
            disabled={merging}
            className="px-3 py-1.5 rounded bg-bg-tertiary text-text-primary text-sm hover:bg-bg-primary disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => confirmTarget && onConfirm(confirmTarget)}
            disabled={!confirmTarget || merging}
            className="px-3 py-1.5 rounded bg-yellow-400 text-bg-primary text-sm font-semibold disabled:opacity-40"
          >
            {merging ? 'Merging…' : confirmTarget ? `Merge into "${confirmTarget}"` : 'Pick a target'}
          </button>
        </div>
      </div>
    </div>
  );
}

function DeleteModal({
  target, aliasCount, deleting, onCancel, onConfirm,
}: {
  target: string;
  aliasCount: number;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [acknowledged, setAcknowledged] = useState(false);

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4" onClick={onCancel}>
      <div className="bg-bg-secondary rounded-lg w-full max-w-md overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-bg-tertiary">
          <h2 className="font-semibold text-text-primary">
            Delete <span className="text-red-400">{target}</span>?
          </h2>
        </div>
        <div className="p-4 space-y-3 text-sm">
          <p className="text-text-primary">
            This removes <span className="font-semibold">{target}</span> from every session, every alias mapping
            ({aliasCount} alias{aliasCount === 1 ? '' : 'es'} currently pointing here will become unmapped), and
            the all-in EV history. Their buy-ins / cash-outs are wiped — sessions they were in will become
            unbalanced.
          </p>
          <p className="text-red-300">This can't be undone.</p>
          <label className="flex items-start gap-2 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="mt-0.5"
            />
            <span className="text-text-primary text-xs">
              I understand this permanently deletes all of <span className="font-semibold">{target}</span>'s data.
            </span>
          </label>
        </div>
        <div className="p-3 border-t border-bg-tertiary flex gap-2 justify-end">
          <button
            onClick={onCancel}
            disabled={deleting}
            className="px-3 py-1.5 rounded bg-bg-tertiary text-text-primary text-sm hover:bg-bg-primary disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={!acknowledged || deleting}
            className="px-3 py-1.5 rounded bg-red-500 text-white text-sm font-semibold hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {deleting ? 'Deleting…' : `Delete ${target}`}
          </button>
        </div>
      </div>
    </div>
  );
}
