// One-time migration: import bot/bank-accounts.json into the tracker's
// bank_accounts table via the API, folding Arya→Aarya. Safe to re-run (PUT is
// an upsert). After a successful run the JSON file can be deleted.
//
// Usage (on the VPS, from the bot dir):
//   TRACKER_API_BASE=http://127.0.0.1:5001/api node migrate-bank-accounts.js
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { consolidateBankAccounts } from './bank.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { TRACKER_API_BASE } = process.env;
if (!TRACKER_API_BASE) { console.error('Missing TRACKER_API_BASE'); process.exit(1); }

const raw = JSON.parse(await fs.readFile(path.join(__dirname, 'bank-accounts.json'), 'utf8'));
const rows = consolidateBankAccounts(raw);
console.log(`Importing ${rows.length} bank accounts to ${TRACKER_API_BASE} …`);

let ok = 0;
for (const row of rows) {
  const res = await fetch(`${TRACKER_API_BASE}/bank-accounts/${encodeURIComponent(row.name)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName: row.displayName, account: row.account }),
  });
  if (res.ok) { ok += 1; console.log(`  ✓ ${row.name}`); }
  else { console.error(`  ✗ ${row.name}: HTTP ${res.status} ${await res.text()}`); }
}
console.log(`Done: ${ok}/${rows.length} imported.`);
