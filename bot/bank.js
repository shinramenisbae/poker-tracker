// Pure helpers for the bot's bank-account handling. No side effects — unit-tested.

// Build the { name → { displayName, account } } map from the tracker's
// GET /api/bank-accounts response, tolerating a missing/malformed body.
export function accountsMapFromResponse(json) {
  const accounts = json && typeof json === 'object' ? json.accounts : null;
  if (!accounts || typeof accounts !== 'object') return {};
  const out = {};
  for (const [name, info] of Object.entries(accounts)) {
    if (!info || typeof info !== 'object') continue;
    out[name] = { displayName: info.displayName || '', account: info.account || '' };
  }
  return out;
}

// Consolidate the legacy bank-accounts.json object into a list of rows to import.
// Drops the "_comment" key and folds "Arya" into "Aarya" (same person; Aarya is
// the canonical name). Aarya's own non-empty values win; any field Aarya is
// missing is filled from Arya.
export function consolidateBankAccounts(raw) {
  const obj = { ...(raw || {}) };
  delete obj._comment;
  if (obj.Arya) {
    const aarya = obj.Aarya || { displayName: '', account: '' };
    const arya = obj.Arya;
    obj.Aarya = {
      displayName: (aarya.displayName || '').trim() || (arya.displayName || '').trim(),
      account: (aarya.account || '').trim() || (arya.account || '').trim(),
    };
    delete obj.Arya;
  }
  return Object.entries(obj).map(([name, info]) => ({
    name,
    displayName: (info && info.displayName) || '',
    account: (info && info.account) || '',
  }));
}
