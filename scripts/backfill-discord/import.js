import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { TRACKER_API_BASE } = process.env;
if (!TRACKER_API_BASE) { console.error('Missing env var: TRACKER_API_BASE'); process.exit(1); }

const dryRunPath = path.join(__dirname, 'dry-run.json');
const dryRun = JSON.parse(await fs.readFile(dryRunPath, 'utf8'));

const toImport = dryRun.filter((e) => e.willImport);
console.log(`${toImport.length} sessions to import (of ${dryRun.length} in dry-run).`);

let ok = 0, failed = 0;
for (const entry of toImport) {
  const sessionTimestamp = new Date(`${entry.date}T20:00:00Z`).getTime();
  const players = entry.players.map((p) => ({
    id: randomUUID(),
    name: p.name,
    paymentMethod: p.paymentMethod || 'cash',
    cashOut: { amount: p.cashOutAmount, timestamp: sessionTimestamp },
  }));

  const sessionPayload = {
    date: entry.date,
    notes: `Imported from Discord (threadId=${entry.threadId})`,
    gameType: 'online',
    status: 'completed',
    players,
  };

  try {
    const createRes = await fetch(`${TRACKER_API_BASE}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sessionPayload),
    });
    if (!createRes.ok) throw new Error(`POST /sessions HTTP ${createRes.status}: ${await createRes.text()}`);
    const created = await createRes.json();

    for (let i = 0; i < entry.players.length; i++) {
      const buyIn = entry.players[i].buyIn;
      if (!buyIn || buyIn <= 0) continue;
      const playerId = players[i].id;
      const buyInRes = await fetch(`${TRACKER_API_BASE}/sessions/${created.id}/players/${playerId}/buyins`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: buyIn, method: 'cash', isRebuy: false }),
      });
      if (!buyInRes.ok) throw new Error(`POST buyin (player ${players[i].name}) HTTP ${buyInRes.status}: ${await buyInRes.text()}`);
    }

    ok++;
    console.log(`OK  ${entry.date} ${entry.threadName} — ${entry.players.length} players`);
  } catch (err) {
    failed++;
    console.error(`FAIL ${entry.date} ${entry.threadName}: ${err.message}`);
  }
}

console.log(`\nDone. ${ok} imported, ${failed} failed.`);
if (failed > 0) process.exit(1);
