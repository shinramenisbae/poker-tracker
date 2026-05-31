import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSettings } from '../hooks/useStorage';
import { importSpreadsheet, clearImportedSessions } from '../api';
import type { ImportResult } from '../api';

export function Settings() {
  const navigate = useNavigate();
  const { settings, updateSettings } = useSettings();
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);

  const currencies = [
    { code: 'USD', symbol: '$', name: 'US Dollar' },
    { code: 'EUR', symbol: '€', name: 'Euro' },
    { code: 'GBP', symbol: '£', name: 'British Pound' },
    { code: 'NZD', symbol: '$', name: 'New Zealand Dollar' },
  ];

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
          <h1 className="text-xl font-bold text-text-primary">Settings</h1>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 pb-24">
        <div className="space-y-6">
          {/* Currency */}
          <div className="card">
            <h2 className="text-lg font-semibold text-text-primary mb-4">Currency</h2>
            <div className="grid grid-cols-2 gap-3">
              {currencies.map((currency) => (
                <button
                  key={currency.code}
                  onClick={() => updateSettings({ currency: currency.code as typeof settings.currency })}
                  className={`p-4 rounded-xl border-2 transition-all ${
                    settings.currency === currency.code
                      ? 'border-accent-primary bg-accent-primary/5'
                      : 'border-bg-tertiary hover:border-accent-primary-light'
                  }`}
                >
                  <span className="text-2xl">{currency.symbol}</span>
                  <p className="text-sm font-medium text-text-primary mt-1">{currency.code}</p>
                  <p className="text-xs text-text-tertiary">{currency.name}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Default Buy-in */}
          <div className="card">
            <h2 className="text-lg font-semibold text-text-primary mb-4">Default Buy-in</h2>
            <div className="flex gap-2">
              {[50, 100, 200, 500].map((amount) => (
                <button
                  key={amount}
                  onClick={() => updateSettings({ defaultBuyIn: amount })}
                  className={`flex-1 py-3 px-4 rounded-lg font-medium transition-all ${
                    settings.defaultBuyIn === amount
                      ? 'bg-accent-primary text-white'
                      : 'bg-bg-tertiary text-text-secondary hover:bg-bg-secondary'
                  }`}
                >
                  ${amount}
                </button>
              ))}
            </div>
          </div>

          {/* Common Players */}
          <div className="card">
            <h2 className="text-lg font-semibold text-text-primary mb-4">Common Players</h2>
            {settings.commonPlayers.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {settings.commonPlayers.map((player) => (
                  <span
                    key={player}
                    className="px-3 py-1.5 bg-bg-tertiary rounded-full text-sm text-text-secondary"
                  >
                    {player}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-text-tertiary text-sm">No common players yet. Add players when creating a session to see them here.</p>
            )}
          </div>

          {/* Import from Spreadsheet */}
          <div className="card">
            <h2 className="text-lg font-semibold text-text-primary mb-4">Import Historical Data</h2>
            <p className="text-text-secondary text-sm mb-4">
              Import past poker sessions from the Tribe Poker Stats Google Sheet. Each session tab will become a completed session in the tracker.
            </p>

            {importResult && (
              <div className="mb-4 p-3 rounded-lg bg-accent-positive/10 border border-accent-positive/20">
                <p className="text-sm font-medium text-accent-positive">{importResult.message}</p>
                <p className="text-xs text-text-tertiary mt-1">
                  {importResult.imported} imported, {importResult.skipped} skipped, {importResult.total} total tabs
                </p>
                {importResult.errors && importResult.errors.length > 0 && (
                  <p className="text-xs text-accent-negative mt-1">
                    {importResult.errors.length} error(s): {importResult.errors[0]}
                  </p>
                )}
              </div>
            )}

            {importError && (
              <div className="mb-4 p-3 rounded-lg bg-accent-negative/10 border border-accent-negative/20">
                <p className="text-sm text-accent-negative">{importError}</p>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={async () => {
                  setImporting(true);
                  setImportError(null);
                  setImportResult(null);
                  try {
                    const result = await importSpreadsheet();
                    setImportResult(result);
                  } catch (err) {
                    setImportError(err instanceof Error ? err.message : 'Import failed');
                  } finally {
                    setImporting(false);
                  }
                }}
                disabled={importing || clearing}
                className="flex-1 py-3 px-4 rounded-lg font-medium transition-all bg-accent-primary text-white hover:bg-accent-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {importing ? 'Importing...' : 'Import from Spreadsheet'}
              </button>
              <button
                onClick={async () => {
                  if (!confirm('Remove all previously imported sessions?')) return;
                  setClearing(true);
                  setImportError(null);
                  setImportResult(null);
                  try {
                    const result = await clearImportedSessions();
                    setImportResult({ imported: 0, skipped: 0, total: 0, message: result.message });
                  } catch (err) {
                    setImportError(err instanceof Error ? err.message : 'Clear failed');
                  } finally {
                    setClearing(false);
                  }
                }}
                disabled={importing || clearing}
                className="py-3 px-4 rounded-lg font-medium transition-all bg-bg-tertiary text-text-secondary hover:bg-accent-negative/10 hover:text-accent-negative disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {clearing ? 'Clearing...' : 'Clear Imported'}
              </button>
            </div>
          </div>

          {/* About */}
          <div className="card">
            <h2 className="text-lg font-semibold text-text-primary mb-4">About</h2>
            <p className="text-text-secondary text-sm">
              Tribe Poker Tracker v1.0
            </p>
            <p className="text-text-tertiary text-xs mt-2">
              Track poker sessions, manage buy-ins, and calculate settlements automatically.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
