// Tribe Poker Bot
//
// Two flows:
//   1. ONLINE: friend creates a thread in the watched #poker-sessions channel
//      and posts an online ledger screenshot. Bot OCRs it, validates aliases,
//      imports into the tracker, and posts a results message (winners,
//      losers, bank player + account).
//   2. IN-PERSON: tracker UI fires POST /announce/:sessionId on this bot's
//      localhost HTTP server when the user clicks "Post to Discord" on the
//      Results page. Bot creates a thread in the channel and posts results
//      using the existing session data.
//
// State is intentionally minimal — idempotency comes from markers in the
// session's `notes` field:
//   - "Imported from Discord (threadId=X)"        → online session already imported
//   - "Announced on Discord (threadId=X)"         → session already announced
import 'dotenv/config';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Client, GatewayIntentBits, ChannelType, ThreadAutoArchiveDuration, REST, Routes, SlashCommandBuilder, MessageFlags } from 'discord.js';
import { GoogleGenAI, Type } from '@google/genai';
import { classifyAttachment, attachmentTrigger } from './triage.js';
import { createKeyedSerializer } from './serialize.js';
import { accountsMapFromResponse } from './bank.js';
import { calculateSettlements, identifyBankPlayer } from './settlement.js';
import { unpaidDebtors } from './unpaid.js';
import { msUntilNextLocalHour } from './schedule.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const {
  DISCORD_TOKEN,
  DISCORD_CHANNEL_ID,
  TRACKER_API_BASE,
  TRACKER_UI_BASE,
  GEMINI_API_KEY,
  GEMINI_MODEL = 'gemini-2.5-flash',
  BOT_HTTP_PORT = '6300',
  // Optional: a Discord role ID to @mention on each results post, so everyone
  // in the role gets pulled into the thread. Leave unset to disable mentions.
  DISCORD_POKER_ROLE_ID = '',
  // Discord application (client) id — required to register the /paid slash
  // command. Found in the Developer Portal; same as the bot user id.
  DISCORD_APP_ID = '',
  // Hour (0-23) and timezone for the daily unpaid-debt reminder.
  PAYMENT_REMINDER_HOUR = '10',
  PAYMENT_REMINDER_TZ = 'Pacific/Auckland',
} = process.env;

for (const [k, v] of Object.entries({ DISCORD_TOKEN, DISCORD_CHANNEL_ID, TRACKER_API_BASE, TRACKER_UI_BASE, GEMINI_API_KEY })) {
  if (!v) { console.error(`Missing env var: ${k}`); process.exit(1); }
}

const genai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// -------- in-memory caches (rebuilt on restart, that's fine) --------
const imageClassificationCache = new Map(); // url -> {type, rows}

// -------- Gemini vision --------
const VISION_SYSTEM = `You analyze poker session screenshots and return strict JSON.

Classify the image as one of:
- "online_ledger": white background, header "Session Ledger", columns Player / Buy-In / Buy-Out / Stack / Net.
- "in_person_summary": shows "Session Summary", bank player, Winners/Owes Money, "Who Pays Who".
- "unknown": anything else (table photos, hand snapshots, memes, chat shots).

If online_ledger, extract every player row. "name" is the bold player name; "handle" is the lighter text after "@" (may be empty). buyIn/buyOut/stack/net are numbers — preserve sign on net (negative for losers). Skip any total/footer rows. If not online_ledger, return an empty rows array.`;

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    type: { type: Type.STRING, enum: ['online_ledger', 'in_person_summary', 'unknown'] },
    rows: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          handle: { type: Type.STRING },
          buyIn: { type: Type.NUMBER },
          buyOut: { type: Type.NUMBER },
          stack: { type: Type.NUMBER },
          net: { type: Type.NUMBER },
        },
        required: ['name', 'handle', 'buyIn', 'buyOut', 'stack', 'net'],
      },
    },
  },
  required: ['type', 'rows'],
};

async function classifyImage(url) {
  if (imageClassificationCache.has(url)) return imageClassificationCache.get(url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Discord attachment HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const mediaType = (res.headers.get('content-type') || 'image/png').split(';')[0].trim();
  const resp = await genai.models.generateContent({
    model: GEMINI_MODEL,
    contents: [{
      role: 'user',
      parts: [
        { inlineData: { mimeType: mediaType, data: buf.toString('base64') } },
        { text: 'Classify and extract per the schema.' },
      ],
    }],
    config: { systemInstruction: VISION_SYSTEM, responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA },
  });
  let parsed;
  try { parsed = JSON.parse(resp.text); }
  catch { parsed = { type: 'unknown', rows: [] }; }
  imageClassificationCache.set(url, parsed);
  return parsed;
}

// -------- tracker API helpers --------
async function trackerGet(path) {
  const res = await fetch(`${TRACKER_API_BASE}${path}`);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}
async function trackerPost(path, body) {
  const res = await fetch(`${TRACKER_API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}
async function trackerPut(path, body) {
  const res = await fetch(`${TRACKER_API_BASE}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PUT ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}
async function trackerDelete(path) {
  const res = await fetch(`${TRACKER_API_BASE}${path}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`DELETE ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

// -------- Discord links + payment state (via tracker API) --------
async function getDiscordLinks() {
  try { return (await trackerGet('/discord-links')).links || {}; }
  catch (err) { console.error('getDiscordLinks failed:', err.message); return {}; }
}
async function linkDiscordUser(discordUserId, playerName) {
  return trackerPut(`/discord-links/${encodeURIComponent(discordUserId)}`, { playerName });
}
async function getSessionPayments(sessionId) {
  try { return (await trackerGet(`/sessions/${sessionId}/payments`)).paid || {}; }
  catch (err) { console.error('getSessionPayments failed:', err.message); return {}; }
}
async function markPaid(sessionId, playerName, paidBy) {
  return trackerPut(`/sessions/${sessionId}/payments/${encodeURIComponent(playerName)}`, { paidBy });
}
async function markUnpaid(sessionId, playerName) {
  return trackerDelete(`/sessions/${sessionId}/payments/${encodeURIComponent(playerName)}`);
}

// Gemini OCR is non-deterministic on aliases with weird whitespace/emoji.
// Same image reads as "Simon \n\n\n\n🥵" one run, "Simon 🥵" the next,
// "simon 🤮" the run after that. Normalize hard: lowercase, drop anything
// that isn't a word/space/hyphen/dot/apostrophe (so emoji + punctuation
// vanish), collapse whitespace. Two aliases that visually differ only by
// emoji decoration end up the same canonical key.
function normalizeAliasKey(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[^\w\s\-'.]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchAliasLookup() {
  const { aliases } = await trackerGet('/alias-mappings');
  const lookup = new Map();
  for (const { alias, realName } of aliases) {
    if (realName && realName.trim()) lookup.set(normalizeAliasKey(alias), realName.trim());
  }
  return lookup;
}

async function findSessionByImportMarker(threadId) {
  const sessions = await trackerGet('/sessions');
  // Prefer the new dedicated column; fall back to the legacy notes marker so
  // sessions imported before the column existed are still detected.
  return sessions.find((s) =>
    s.discordThreadId === threadId
    || (s.notes || '').includes(`threadId=${threadId}`)
  );
}

// -------- Discord helpers --------
async function priorBlockedAliasSet(thread, botUserId) {
  // Scan recent messages for a prior "🛑" message from this bot;
  // returns the set of aliases (between backticks) listed in it, or null.
  // Used to dedup "Can't import yet" posts across bot restarts.
  const messages = await thread.messages.fetch({ limit: 20 });
  for (const msg of messages.values()) {
    if (msg.author?.id !== botUserId) continue;
    if (!msg.content?.startsWith('🛑')) continue;
    const matches = [...msg.content.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    if (matches.length === 0) continue;
    return new Set(matches);
  }
  return null;
}

async function collectThreadAttachments(thread) {
  // Single pass over all messages; returns images, ledger CSVs, and hand log CSVs.
  // PokerNow filename conventions: ledger CSVs start with "ledger_",
  // hand logs start with "poker_now_log_". Both are .csv.
  const images = [];
  const ledgerCsvs = [];
  const handLogCsvs = [];
  let before;
  while (true) {
    const batch = await thread.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (batch.size === 0) break;
    for (const msg of batch.values()) {
      for (const att of msg.attachments.values()) {
        const kind = classifyAttachment(att);
        if (kind === 'handlog') {
          handLogCsvs.push({ url: att.url, name: att.name || '', createdAt: msg.createdTimestamp });
        } else if (kind === 'ledger') {
          ledgerCsvs.push({ url: att.url, name: att.name || '', createdAt: msg.createdTimestamp });
        } else if (kind === 'image') {
          images.push({ url: att.url, createdAt: msg.createdTimestamp });
        }
      }
    }
    if (batch.size < 100) break;
    before = batch.last().id;
  }
  images.sort((a, b) => a.createdAt - b.createdAt);
  ledgerCsvs.sort((a, b) => b.createdAt - a.createdAt); // newest first
  handLogCsvs.sort((a, b) => b.createdAt - a.createdAt);
  return { images, csvs: ledgerCsvs, handLogCsvs };
}

// -------- PokerNow CSV --------
function parseCsvLine(line) {
  const out = [];
  let inQuotes = false;
  let current = '';
  for (const c of line) {
    if (c === '"') inQuotes = !inQuotes;
    else if (c === ',' && !inQuotes) { out.push(current); current = ''; }
    else current += c;
  }
  out.push(current);
  return out;
}

// PokerNow CSV gives one row per "session window" — every time a player
// joins, leaves, or rebuys creates a fresh row. Same player across multiple
// windows must be aggregated, or they show up N times in the results.
// player_id is unique-per-session even for guests, so aggregate by that.
// Values are in chips; divide by POKERNOW_CHIP_DIVISOR (default 100) for $.
function parsePokernowCsv(text) {
  const divisor = Number(process.env.POKERNOW_CHIP_DIVISOR || '100');
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return { rows: [], dateOverride: null };
  const headers = parseCsvLine(lines[0]).map((h) => h.trim());
  const required = ['player_nickname', 'buy_in', 'stack', 'net'];
  if (!required.every((h) => headers.includes(h))) {
    return { rows: [], dateOverride: null, error: 'CSV headers do not match PokerNow format' };
  }
  const records = lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const r = {};
    headers.forEach((h, i) => { r[h] = (values[i] ?? '').trim(); });
    return r;
  });

  // Aggregate by player_id (or nickname if id missing). Sum buy_in, buy_out, net in chips.
  const byPlayer = new Map();
  for (const r of records) {
    if (!r.player_nickname) continue;
    const key = r.player_id || `__name__:${r.player_nickname}`;
    if (!byPlayer.has(key)) {
      byPlayer.set(key, {
        name: r.player_nickname,
        handle: r.player_id || '',
        buyInChips: 0,
        buyOutChips: 0,
        netChips: 0,
      });
    }
    const agg = byPlayer.get(key);
    agg.buyInChips += parseFloat(r.buy_in) || 0;
    agg.buyOutChips += parseFloat(r.buy_out) || 0;
    agg.netChips += parseFloat(r.net) || 0;
  }

  // Convert chips → dollars, and synthesize stack so that buyOut + stack = correct cashOut.
  // (cashOut for a player = buy_outs + final_stack across all windows, which is also
  //  buy_in + net by definition.)
  const rows = [...byPlayer.values()].map((a) => {
    const buyIn = a.buyInChips / divisor;
    const buyOut = a.buyOutChips / divisor;
    const net = a.netChips / divisor;
    return {
      name: a.name,
      handle: a.handle,
      buyIn,
      buyOut,
      stack: buyIn + net - buyOut, // makes buyOut + stack - buyIn = net (parser invariant)
      net,
    };
  });

  const starts = records
    .map((r) => r.session_start_at)
    .filter((s) => s && s.length >= 10)
    .sort();
  const dateOverride = starts[0] ? new Date(starts[0]).toISOString().slice(0, 10) : null;
  return { rows, dateOverride };
}

async function downloadCsvText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CSV download HTTP ${res.status}`);
  return res.text();
}

// -------- Hand log upload / prompt --------

async function isHandLogUploaded(sessionId) {
  try {
    const ev = await trackerGet(`/sessions/${sessionId}/ev`);
    return Array.isArray(ev.series) && ev.series.length > 0;
  } catch { return false; }
}

async function priorBotMessageStartsWith(thread, botUserId, prefix) {
  const messages = await thread.messages.fetch({ limit: 20 });
  for (const msg of messages.values()) {
    if (msg.author?.id !== botUserId) continue;
    if (msg.content?.startsWith(prefix)) return true;
  }
  return false;
}

// Is the bot's most recent *status* message in this thread a "🛑 can't import
// yet" block? Used so an attachment-less message (e.g. "ok mapped them") only
// re-triggers an import when there's actually a pending alias block to clear —
// not on every line of chatter. Newer status messages (🎲 results, 🎰 hand log)
// mean the block was already resolved. One bounded fetch, no full scan.
async function latestBotStatusIsBlock(thread, botUserId) {
  const messages = await thread.messages.fetch({ limit: 20 }); // newest first
  for (const msg of messages.values()) {
    if (msg.author?.id !== botUserId) continue;
    const c = msg.content || '';
    if (c.startsWith('🛑')) return true;
    if (c.startsWith('🎲') || c.startsWith('🎰')) return false;
  }
  return false;
}

// Has the bot ever posted a "🎲 Session results" message in this thread? A true
// result means the thread was successfully imported at least once. Used by the
// startup catch-up scan to distinguish a never-imported thread (safe to import)
// from one whose session was deliberately deleted (must NOT be resurrected).
// Paginates fully so an old results post beyond the 20-message window isn't missed.
async function threadHasResultsPost(thread, botUserId) {
  let before;
  while (true) {
    const batch = await thread.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (batch.size === 0) break;
    for (const msg of batch.values()) {
      if (msg.author?.id === botUserId && (msg.content || '').startsWith('🎲')) return true;
    }
    if (batch.size < 100) break;
    before = batch.last().id;
  }
  return false;
}

async function processHandLogIfNeeded(thread, sessionId, handLogCsvs) {
  if (await isHandLogUploaded(sessionId)) return;

  // Skip in-person sessions — PokerNow logs don't exist for those.
  try {
    const session = await trackerGet(`/sessions/${sessionId}`);
    if (session.gameType !== 'online') return;
  } catch { return; }

  if (handLogCsvs && handLogCsvs.length > 0) {
    // Upload it.
    try {
      const text = await (await fetch(handLogCsvs[0].url)).text();
      const res = await fetch(`${TRACKER_API_BASE}/sessions/${sessionId}/handlog`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawLog: text }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      const result = await res.json();
      await thread.send(
        `🎰 Hand log parsed: ${result.eligibleEvHands} qualifying all-in EV hands across ${result.totalHands} hands.\n` +
        `See who's a luck box: ${TRACKER_UI_BASE}/#/session/${sessionId}/ev`
      );
    } catch (err) {
      console.error(`Hand log upload failed for ${sessionId}:`, err.message);
      await thread.send(`⚠️ Couldn't parse the hand log: ${err.message}`);
    }
    return;
  }

  // No log attached — prompt once.
  if (await priorBotMessageStartsWith(thread, client.user.id, '🎰 Drop the PokerNow hand log')) return;
  await thread.send(
    `🎰 Drop the PokerNow hand log here (from the Ledger → Download log button) if you want to see all-in EV vs actual — who got coolered, who sucked out, etc.`
  );
}

// -------- per-thread serialization --------
// processThreadUnlocked has several awaits between "does a session already exist
// for this thread?" and "create the session". Two messages in the same thread
// arriving within that window would both pass the existence check and both
// import → duplicate sessions (seen in the logs as two imports ~1s apart).
// Serialize work per thread: the second call runs only after the first settles,
// by which point it finds the session the first just created and short-circuits.
const runExclusive = createKeyedSerializer();

// -------- Core: process a thread that may have an online ledger --------
//
// `trigger` says why we're processing the thread and gates whether a brand-new
// session may be created (the source of the duplicate-import bug):
//   'upload'  → a ledger/screenshot was just posted: import is allowed
//   'handlog' → only a hand log was posted: attach to an existing session, never create
//   'retry'   → attachment-less message clearing a pending 🛑 alias block: import allowed
//   'scan'    → startup catch-up: import only threads never imported before, so a
//               deliberately deleted session is not silently resurrected
function processThread(thread, trigger) {
  return runExclusive(thread.id, () => processThreadUnlocked(thread, trigger));
}

async function processThreadUnlocked(thread, trigger) {
  const threadId = thread.id;

  // 1. If already imported, just handle the hand-log side and return.
  const existingSession = await findSessionByImportMarker(threadId);
  if (existingSession) {
    const { handLogCsvs } = await collectThreadAttachments(thread);
    await processHandLogIfNeeded(thread, existingSession.id, handLogCsvs);
    return;
  }

  // 1b. No linked session — decide whether we're allowed to create one.
  // This is the guard that stops unrelated chatter, or a restart, from
  // re-importing a thread whose session was deleted out from under us.
  let allowImport;
  if (trigger === 'scan') {
    allowImport = !(await threadHasResultsPost(thread, client.user.id));
  } else {
    allowImport = trigger === 'upload' || trigger === 'retry';
  }
  if (!allowImport) return;

  // 2. Collect attachments and decide source.
  const { images, csvs, handLogCsvs } = await collectThreadAttachments(thread);
  let ledgerRows = [];
  let dateOverride = null;
  let source = 'none';

  // Prefer CSV when present (deterministic, exact, no Gemini calls).
  if (csvs.length > 0) {
    try {
      const text = await downloadCsvText(csvs[0].url); // newest CSV in thread
      const parsed = parsePokernowCsv(text);
      if (parsed.rows.length > 0) {
        ledgerRows = parsed.rows;
        dateOverride = parsed.dateOverride;
        source = 'csv';
      }
    } catch (err) {
      console.error(`CSV parse failed in thread ${threadId}:`, err.message);
    }
  }

  // Fall back to OCR if no CSV or CSV unusable.
  if (ledgerRows.length === 0) {
    if (images.length === 0) return;
    for (const img of images) {
      const result = await classifyImage(img.url);
      if (result.type === 'online_ledger') ledgerRows.push(...(result.rows || []));
    }
    if (ledgerRows.length === 0) return;
    source = 'ocr';
  }
  console.log(`Thread ${threadId} (${thread.name}): ${ledgerRows.length} rows from ${source}`);

  // 3. Alias check
  const aliasLookup = await fetchAliasLookup();
  const unmapped = [];
  const mappedRows = [];
  for (const row of ledgerRows) {
    const real = aliasLookup.get(normalizeAliasKey(row.name));
    if (!real) {
      // Use the normalized form so OCR variance doesn't spawn duplicate DB rows.
      unmapped.push(normalizeAliasKey(row.name) || row.name);
    } else {
      mappedRows.push({ ...row, name: real, originalAlias: row.name });
    }
  }

  // 3b. Aggregate again by canonical name. Reason: a single person often
  // shows up with multiple PokerNow player_ids in one session (logged-in
  // account + guest, or multiple guest joins). The CSV parser correctly
  // splits those into separate rows by player_id, but they should collapse
  // into one tracker Player after alias mapping resolves them to the same
  // real person.
  const byCanonical = new Map();
  for (const r of mappedRows) {
    if (!byCanonical.has(r.name)) {
      byCanonical.set(r.name, { name: r.name, handle: r.handle, buyIn: 0, buyOut: 0, stack: 0, net: 0 });
    }
    const agg = byCanonical.get(r.name);
    agg.buyIn += Number(r.buyIn) || 0;
    agg.buyOut += Number(r.buyOut) || 0;
    agg.net += Number(r.net) || 0;
    agg.stack = agg.buyIn + agg.net - agg.buyOut; // maintain invariant
  }
  const aggregatedRows = [...byCanonical.values()];

  if (unmapped.length > 0) {
    // Block import; tell humans to map.
    const uniqueUnmapped = [...new Set(unmapped)].sort();

    // Register them in the tracker so they appear in the /aliases UI.
    // PUT is an upsert; null realName means "unmapped, please someone fill in".
    for (const a of uniqueUnmapped) {
      try { await trackerPut(`/alias-mappings/${encodeURIComponent(a)}`, { realName: null }); }
      catch (err) { console.error(`Failed to register alias "${a}":`, err.message); }
    }

    // Dedup: check the thread for a prior "🛑" message from us listing the same
    // alias set. Survives bot restarts (no in-memory state needed). Normalize
    // both sides so emoji-variance in the prior message text doesn't break the
    // comparison.
    const priorSet = await priorBlockedAliasSet(thread, client.user.id);
    const priorNormalized = priorSet
      ? new Set([...priorSet].map(normalizeAliasKey).filter(Boolean))
      : null;
    const same = priorNormalized && priorNormalized.size === uniqueUnmapped.length
      && uniqueUnmapped.every((a) => priorNormalized.has(a));
    if (!same) {
      const list = uniqueUnmapped.map((a) => `\`${a}\``).join(', ');
      await thread.send(
        `🛑 Can't import yet — need someone to identify these aliases first:\n${list}\n\n` +
        `Map them at ${TRACKER_UI_BASE}/#/aliases then post any message in this thread and I'll retry.`
      );
    }
    return;
  }

  // 4. All aliases mapped — import. CSV's session_start_at beats the thread's
  // creation timestamp (more accurate, especially for late-evening sessions
  // that cross midnight UTC).
  const sessionDate = dateOverride
    || new Date(thread.createdTimestamp ?? Date.now()).toISOString().slice(0, 10);
  const sessionTimestamp = new Date(`${sessionDate}T20:00:00Z`).getTime();
  const players = aggregatedRows.map((r) => ({
    id: randomUUID(),
    name: r.name,
    paymentMethod: 'cash',
    cashOut: { amount: (Number(r.buyOut) || 0) + (Number(r.stack) || 0), timestamp: sessionTimestamp },
  }));
  const created = await trackerPost('/sessions', {
    date: sessionDate,
    notes: `Online session (${sessionDate})`,
    gameType: 'online',
    status: 'completed',
    discordThreadId: threadId,
    players,
  });
  for (let i = 0; i < aggregatedRows.length; i++) {
    const buyIn = Number(aggregatedRows[i].buyIn) || 0;
    if (buyIn <= 0) continue;
    await trackerPost(`/sessions/${created.id}/players/${players[i].id}/buyins`, {
      amount: buyIn, method: 'cash', isRebuy: false,
    });
  }

  // 5. Post results message.
  const full = await trackerGet(`/sessions/${created.id}`);
  await postResultsMessage(thread, full);

  // 6. Hand log: upload if attached, else prompt for it.
  await processHandLogIfNeeded(thread, created.id, handLogCsvs);
}

// -------- Results message --------

function computePerPlayerResults(session) {
  // Returns [{name, profit}] sorted by profit desc
  return (session.players || [])
    .map((p) => {
      const buyIn = (p.buyIns || []).reduce((s, b) => s + (Number(b.amount) || 0), 0);
      const cashOut = p.cashOut ? Number(p.cashOut.amount) || 0 : Number(p.cashOutAmount) || 0;
      return { name: p.name, profit: cashOut - buyIn };
    })
    .sort((a, b) => b.profit - a.profit);
}

function formatMoney(n) {
  const sign = n >= 0 ? '+' : '−';
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

function formatResultsMessage(session, results, bankAccounts) {
  const winners = results.filter((r) => r.profit > 0.005);
  const losers = results.filter((r) => r.profit < -0.005);
  const evens = results.filter((r) => Math.abs(r.profit) <= 0.005);

  const bankPlayer = winners[0]; // biggest winner
  const bankInfo = bankPlayer ? bankAccounts[bankPlayer.name] : null;

  // Settlement rows (cash vs bank split), keyed by player name for lookup. This
  // mirrors the Results page exactly, so e.g. a loser who paid partly in cash
  // shows what's already covered on the table vs still owed via bank transfer.
  const settlements = calculateSettlements(session);
  const settleByName = new Map(settlements.map((s) => [s.playerName, s]));

  let msg = `🎲 **Session results — ${session.date}**\n`;
  msg += session.gameType === 'online' ? '🌐 _Online session_\n\n' : '🪑 _In-person session_\n\n';

  if (winners.length > 0) {
    msg += '🏆 **Winners**\n';
    for (const w of winners) {
      const isBank = w === bankPlayer;
      msg += `• ${w.name}: **${formatMoney(w.profit)}**`;
      if (isBank) {
        msg += `  🏦 _(bank player — collects from losers)_\n`;
      } else {
        // Show bank info inline so the bank player can transfer winnings.
        const info = bankAccounts[w.name];
        if (info) {
          msg += ` → ${info.displayName} \`${info.account}\`\n`;
        } else {
          msg += ` → _(no account on file)_\n`;
        }
      }
    }
    msg += '\n';
  }

  if (losers.length > 0) {
    msg += `💸 **Losers** _(pay ${bankPlayer ? bankPlayer.name : 'the bank player'})_\n`;
    for (const l of losers) {
      msg += `• ${l.name}: ${formatMoney(l.profit)}`;
      // Annotate how the loss settles: cash already on the table vs bank transfer
      // still owed. Only show when there's a meaningful cash component, so the
      // common all-bank loser stays a clean one-liner.
      const s = settleByName.get(l.name);
      if (s && s.cashBuyIn > 0.005) {
        const owed = s.bankOwed || 0;
        if (owed > 0.005) {
          msg += `  _(paid ${formatCash(s.cashBuyIn)} cash, owes ${formatCash(owed)} via bank)_`;
        } else {
          msg += `  _(paid in cash on the table)_`;
        }
      }
      msg += '\n';
    }
    msg += '\n';
  }

  if (evens.length > 0) {
    msg += `⚖️ **Even**: ${evens.map((e) => e.name).join(', ')}\n\n`;
  }

  if (bankPlayer) {
    msg += `🏦 **Bank player: ${bankPlayer.name}**\n`;
    if (bankInfo) {
      msg += `   ${bankInfo.displayName}\n`;
      msg += `   \`${bankInfo.account}\`\n`;
    } else {
      msg += `   _(no bank account on file — losers, please ask ${bankPlayer.name} for their details)_\n`;
    }
  }

  return msg;
}

// Plain dollar amount (no +/- sign), for cash/bank annotations.
function formatCash(n) {
  return `$${Math.abs(Number(n) || 0).toFixed(2)}`;
}

// Bank accounts live in the tracker DB. Fetch on demand so edits made in the
// Manage Players UI take effect immediately. Returns {} on any failure, which
// makes formatResultsMessage fall back to "no account on file".
async function fetchBankAccounts() {
  try {
    return accountsMapFromResponse(await trackerGet('/bank-accounts'));
  } catch (err) {
    console.error('Failed to fetch bank accounts:', err.message);
    return {};
  }
}

// Delete the bot's own prior results posts in a thread (those starting with the
// 🎲 results marker). Returns how many were deleted. Used by /repost?clean=true
// so refreshing a session's results doesn't leave stale duplicate posts behind.
// Paginates fully so an older post beyond the first page is still removed.
async function deletePriorResultsPosts(thread, botUserId) {
  let deleted = 0;
  let before;
  while (true) {
    const batch = await thread.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (batch.size === 0) break;
    for (const msg of batch.values()) {
      if (msg.author?.id === botUserId && (msg.content || '').startsWith('🎲')) {
        try { await msg.delete(); deleted++; }
        catch (err) { console.error(`Could not delete message ${msg.id}:`, err.message); }
      }
    }
    if (batch.size < 100) break;
    before = batch.last().id;
  }
  return deleted;
}

async function postResultsMessage(thread, session) {
  const results = computePerPlayerResults(session);
  const bankAccounts = await fetchBankAccounts();
  const text = formatResultsMessage(session, results, bankAccounts);

  // Mention the poker role (if configured) so everyone gets pulled into the
  // thread. allowedMentions must explicitly list the role id or Discord
  // suppresses the ping. When unset, send a plain message with no mentions.
  if (DISCORD_POKER_ROLE_ID) {
    await thread.send({
      content: `<@&${DISCORD_POKER_ROLE_ID}>\n${text}`,
      allowedMentions: { roles: [DISCORD_POKER_ROLE_ID] },
    });
  } else {
    await thread.send({ content: text, allowedMentions: { parse: [] } });
  }
}

// -------- /paid slash command --------
//
// Resolves which session thread the command was used in, maps the Discord user
// to a canonical player (or uses the named target), and marks them paid for
// that session. First-time users are auto-linked to the player name they claim.

const PAID_COMMAND = new SlashCommandBuilder()
  .setName('paid')
  .setDescription('Mark a player as having paid their debt for this session.')
  .addStringOption((o) =>
    o.setName('player')
      .setDescription("Player name (defaults to you). The bank player can mark anyone.")
      .setRequired(false)
  )
  .addUserOption((o) =>
    o.setName('user')
      .setDescription('Link this Discord user to the named player (requires player).')
      .setRequired(false)
  );

async function registerSlashCommands() {
  if (!DISCORD_APP_ID) {
    console.warn('DISCORD_APP_ID unset — skipping /paid slash command registration.');
    return;
  }
  try {
    const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
    await rest.put(Routes.applicationCommands(DISCORD_APP_ID), { body: [PAID_COMMAND.toJSON()] });
    console.log('Registered /paid slash command.');
  } catch (err) {
    console.error('Slash command registration failed:', err.message);
  }
}

// Find the session linked to a given thread id (column first, notes fallback).
async function findSessionByThreadId(threadId) {
  const sessions = await trackerGet('/sessions');
  return sessions.find((s) =>
    s.discordThreadId === threadId || (s.notes || '').includes(`threadId=${threadId}`)
  );
}

async function handlePaidCommand(interaction) {
  // Must be used inside a session results thread.
  const ch = interaction.channel;
  const isThread = ch && [ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.AnnouncementThread].includes(ch.type);
  if (!isThread || ch.parentId !== DISCORD_CHANNEL_ID) {
    return interaction.reply({ content: '⚠️ Use `/paid` inside a session results thread.', flags: MessageFlags.Ephemeral });
  }

  const session = await findSessionByThreadId(ch.id);
  if (!session) {
    return interaction.reply({ content: "⚠️ Couldn't find a session for this thread.", flags: MessageFlags.Ephemeral });
  }

  const settlements = calculateSettlements(session);
  // Debtors = players who owe a bank transfer.
  const debtorNames = new Set(
    settlements.filter((s) => (s.bankOwed || 0) > 0.005).map((s) => s.playerName)
  );
  const allNames = settlements.map((s) => s.playerName);

  const links = await getDiscordLinks();
  const requesterName = links[interaction.user.id];
  const named = interaction.options.getString('player');
  const linkUser = interaction.options.getUser('user');

  if (linkUser && !named) {
    return interaction.reply({
      content: '⚠️ `user:` requires `player:` — specify which player to link them to.',
      flags: MessageFlags.Ephemeral,
    });
  }

  // Determine the target player.
  let targetName;
  if (named) {
    // Resolve a named target case-insensitively against this session's players.
    targetName = allNames.find((n) => n.toLowerCase() === named.trim().toLowerCase());
    if (!targetName) {
      return interaction.reply({ content: `⚠️ No player named **${named}** in this session.`, flags: MessageFlags.Ephemeral });
    }
  } else {
    // No name → the requester marks themselves. Requires a known link.
    if (!requesterName) {
      return interaction.reply({
        content: '⚠️ I don’t know who you are yet. Run `/paid player:<your name>` once and I’ll remember you.',
        flags: MessageFlags.Ephemeral,
      });
    }
    targetName = requesterName;
  }

  // Link the named Discord user → targetName (caller is linking someone else).
  // Otherwise: first-time self-link when an unknown user runs "/paid player:<name>".
  let linkNote = '';
  if (linkUser) {
    const prev = links[linkUser.id];
    try { await linkDiscordUser(linkUser.id, targetName); } catch { /* non-fatal */ }
    linkNote = prev && prev !== targetName
      ? `🔗 Re-linked <@${linkUser.id}> from **${prev}** to **${targetName}**. `
      : `🔗 Linked <@${linkUser.id}> to **${targetName}**. `;
  } else if (named && !requesterName) {
    try { await linkDiscordUser(interaction.user.id, targetName); } catch { /* non-fatal */ }
  }

  if (!debtorNames.has(targetName)) {
    return interaction.reply({
      content: `${linkNote}ℹ️ **${targetName}** has no outstanding bank transfer for this session (nothing to mark).`,
      flags: MessageFlags.Ephemeral,
    });
  }

  try {
    await markPaid(session.id, targetName, links[interaction.user.id] || interaction.user.username);
  } catch (err) {
    return interaction.reply({ content: `⚠️ Failed to record payment: ${err.message}`, flags: MessageFlags.Ephemeral });
  }

  // Public confirmation in-thread, plus remaining unpaid count.
  const payments = await getSessionPayments(session.id);
  const paidSet = new Set(Object.keys(payments));
  const remaining = unpaidDebtors(session, paidSet);
  let msg = `${linkNote}✅ **${targetName}** marked as paid.`;
  if (remaining.length > 0) {
    msg += ` Still owing: ${remaining.map((r) => r.playerName).join(', ')}.`;
  } else {
    msg += ' 🎉 Everyone has paid!';
  }
  return interaction.reply({ content: msg });
}

// -------- Daily unpaid-debt reminder --------
//
// Each day at PAYMENT_REMINDER_HOUR in PAYMENT_REMINDER_TZ, scan every session
// that still has unpaid debtors and post one reminder per thread, @mentioning
// the linked Discord users (falling back to plain names when unmapped).
//
// The copy is intentionally sarcastic / shitposty — it's a tribe poker group,
// not a corporate dunning notice. Variants are picked randomly each run so the
// reminders don't go stale.

const TROLL_TAUNTS = [
  'are you too broke to pay this, need a loan?',
  "tap-to-pay isn't rocket science, even your nan can do it",
  'lost in transit between your couch cushions, was it?',
  'we have screenshots. and patience. but not forever.',
  "pretending you forgot? we don't have amnesia.",
  'the longer you wait, the funnier the next reminder gets',
  "I'd accept apology in the form of an instant transfer",
  'skill issue at the felt AND at internet banking? rough',
  'your credit score is watching this thread, just so you know',
  'three business days of dignity left, then we go nuclear',
  'send the money or we tell the group chat about that hand',
  'this is embarrassing for both of us, mostly you',
];

const BANK_BEGGAR_REASONS = [
  'really needs this for an emergency penis-enlargement consult 🥺',
  'is one bowl of two-minute noodles away from bankruptcy',
  "has rent due tomorrow and the landlord doesn't accept poker chips",
  'is saving for a hair transplant and every dollar counts',
  'needs to refill the vape supply before withdrawals kick in',
  'has a parking fine he can\'t afford because of YOU specifically',
  'started a GoFundMe — first donor gets a thank-you note',
  'is using this thread as collateral for his next loan',
  'owns three investment properties and is still mad about this $',
  'has a goldfish in critical condition, vet bills are insane',
  'is one missed transfer away from selling plasma',
  "wife threatened to leave if rent's late again",
];

const FOOTER_SNARKS = [
  "_Reply `/paid` once you've sent it. or don't, we love drama._",
  "_Hit `/paid` after the transfer. it's 5 seconds, what's your excuse?_",
  '_Use `/paid` when the funds clear. failure to comply triggers more memes._',
  '_Smash `/paid` when done. silence will be interpreted as guilt._',
  '_`/paid` when sent. the reminder gets meaner each day, fyi._',
];

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function buildReminderMessage({ session, unpaidLines, bankMention }) {
  const reason = pickRandom(BANK_BEGGAR_REASONS);
  const footer = pickRandom(FOOTER_SNARKS);
  return (
    `⏰ **Payment reminder — ${session.date}**\n` +
    `${unpaidLines.join('\n')}\n` +
    `\n🏦 ${bankMention} ${reason}\n` +
    `\n${footer}`
  );
}

// Posts reminders for sessions with unpaid debtors. If sessionId is given, only
// that session is processed (and a missing session id throws). Always throws on
// failure so HTTP callers can surface errors; the daily timer wraps + swallows.
async function runPaymentReminders({ sessionId = null } = {}) {
  const [allSessions, links] = await Promise.all([
    trackerGet('/sessions'),
    getDiscordLinks(),
  ]);
  const sessions = sessionId ? allSessions.filter((s) => s.id === sessionId) : allSessions;
  if (sessionId && sessions.length === 0) {
    throw new Error(`Session ${sessionId} not found`);
  }

  // Invert links: playerName → discordUserId (first match wins).
  const nameToUser = {};
  for (const [uid, name] of Object.entries(links)) {
    if (!(name in nameToUser)) nameToUser[name] = uid;
  }

  const reminded = [];
  const skipped = [];
  for (const session of sessions) {
    const threadId = session.discordThreadId
      || ((session.notes || '').match(/threadId=(\d+)/) || [])[1];
    if (!threadId) { skipped.push({ sessionId: session.id, reason: 'no thread' }); continue; }

    const payments = await getSessionPayments(session.id);
    const unpaid = unpaidDebtors(session, new Set(Object.keys(payments)));
    if (unpaid.length === 0) { skipped.push({ sessionId: session.id, reason: 'no unpaid' }); continue; }

    const thread = await client.channels.fetch(threadId).catch(() => null);
    if (!thread) { skipped.push({ sessionId: session.id, reason: 'thread fetch failed' }); continue; }

    const mentions = [];
    const unpaidLines = unpaid.map((u) => {
      const uid = nameToUser[u.playerName];
      const who = uid ? `<@${uid}>` : `**${u.playerName}**`;
      if (uid) mentions.push(uid);
      return `• ${who} — owes $${u.owes.toFixed(2)}. ${pickRandom(TROLL_TAUNTS)}`;
    });

    // Bank player → mention if linked, otherwise bold name.
    const bankId = session.bankPlayerId || identifyBankPlayer(session);
    const bankPlayer = (session.players || []).find((p) => p.id === bankId);
    const bankName = bankPlayer ? bankPlayer.name : 'the bank player';
    const bankUid = nameToUser[bankName];
    if (bankUid) mentions.push(bankUid);
    const bankMention = bankUid ? `<@${bankUid}>` : `**${bankName}**`;

    const content = buildReminderMessage({ session, unpaidLines, bankMention });
    await thread.send({ content, allowedMentions: { users: mentions } });
    reminded.push(session.id);
  }
  console.log(`Payment reminders: pinged ${reminded.length} thread(s)${sessionId ? ` (session ${sessionId})` : ''}.`);
  return { reminded, skipped };
}

// Self-rescheduling daily timer (setTimeout, not setInterval, so DST shifts are
// recomputed each day). Swallows errors so a transient failure doesn't kill the
// loop — the next day still runs.
function scheduleDailyReminders() {
  const hour = Number(PAYMENT_REMINDER_HOUR);
  const tz = PAYMENT_REMINDER_TZ;
  const delay = msUntilNextLocalHour(new Date(), hour, tz);
  console.log(`Next payment reminder in ${(delay / 3600000).toFixed(1)}h (${hour}:00 ${tz}).`);
  setTimeout(async () => {
    try { await runPaymentReminders(); }
    catch (err) { console.error('Daily payment reminder failed:', err.message); }
    scheduleDailyReminders(); // reschedule for the following day
  }, delay);
}

// -------- Discord event wiring --------
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'paid') return;
  try {
    await handlePaidCommand(interaction);
  } catch (err) {
    console.error('paid command error:', err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: `⚠️ Error: ${err.message}`, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
});

client.on('messageCreate', async (msg) => {
  try {
    if (msg.author?.bot) return;
    const ch = msg.channel;
    const isThread = [ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.AnnouncementThread].includes(ch.type);
    if (!isThread) return;
    if (ch.parentId !== DISCORD_CHANNEL_ID) return;

    // Only act on messages that actually carry work. Plain chatter ("paid",
    // "lol", @mentions) must not trigger a re-import or hand-log re-parse —
    // that was the duplicate-session bug.
    const kinds = [...msg.attachments.values()].map(classifyAttachment);
    const trigger = attachmentTrigger(kinds);
    if (trigger) {
      await processThread(ch, trigger);
    } else if (await latestBotStatusIsBlock(ch, client.user.id)) {
      // Attachment-less message, but there's a pending "🛑 can't import yet"
      // block: treat it as the user signalling they've mapped the aliases.
      await processThread(ch, 'retry');
    }
    // Otherwise: ignore.
  } catch (err) {
    console.error('messageCreate error:', err);
  }
});

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}.`);

  // Register the /paid slash command and arm the daily reminder. Done before the
  // startup scan (which can early-return) so neither is skipped.
  await registerSlashCommands();
  scheduleDailyReminders();

  // Catch-up scan: process every thread in the watched channel once on startup,
  // to recover threads created/posted while the bot was offline. Runs with the
  // 'scan' trigger, which imports a thread only if it was never imported before
  // (no prior 🎲 results post) — so a session deliberately deleted between
  // restarts is NOT silently re-created.
  try {
    const channel = await client.channels.fetch(DISCORD_CHANNEL_ID);
    if (!channel || channel.type !== ChannelType.GuildText) {
      console.warn(`Startup scan skipped: channel ${DISCORD_CHANNEL_ID} is not a GuildText.`);
      return;
    }
    const threads = new Map();
    const active = await channel.threads.fetchActive();
    for (const [id, t] of active.threads) threads.set(id, t);
    let before;
    while (true) {
      const arch = await channel.threads.fetchArchived({ type: 'public', limit: 100, ...(before ? { before } : {}) });
      for (const [id, t] of arch.threads) threads.set(id, t);
      if (!arch.hasMore || arch.threads.size === 0) break;
      before = arch.threads.last().archivedTimestamp;
    }
    console.log(`Startup scan: ${threads.size} threads to check.`);
    for (const thread of threads.values()) {
      try { await processThread(thread, 'scan'); }
      catch (err) { console.error(`Startup scan thread ${thread.id} (${thread.name}):`, err.message); }
    }
    console.log('Startup scan complete.');
  } catch (err) {
    console.error('Startup scan failed:', err);
  }
});
await client.login(DISCORD_TOKEN);

// -------- HTTP server for in-person announcements --------
const app = express();
app.use(express.json());

app.post('/announce/:sessionId', async (req, res) => {
  const sessionId = req.params.sessionId;
  try {
    const session = await trackerGet(`/sessions/${sessionId}`);

    // Already announced? (prefer new column; legacy notes fallback for migration)
    if (session.discordThreadId) {
      return res.json({ ok: true, alreadyAnnouncedThreadId: session.discordThreadId });
    }
    const legacyMarker = (session.notes || '').match(/Announced on Discord \(threadId=(\d+)\)/);
    if (legacyMarker) {
      return res.json({ ok: true, alreadyAnnouncedThreadId: legacyMarker[1] });
    }

    const channel = await client.channels.fetch(DISCORD_CHANNEL_ID);
    if (!channel || channel.type !== ChannelType.GuildText) {
      return res.status(500).json({ error: `Channel ${DISCORD_CHANNEL_ID} not a text channel` });
    }

    const threadName = `${session.date} ${session.gameType === 'online' ? 'online' : 'in-person'} results`;
    const thread = await channel.threads.create({
      name: threadName,
      autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
      reason: 'Posted from poker tracker (in-person announcement)',
    });
    await postResultsMessage(thread, session);

    // Mark session as announced via the dedicated column (don't touch user's notes).
    await trackerPut(`/sessions/${sessionId}`, { discordThreadId: thread.id });

    res.json({ ok: true, threadId: thread.id, threadName });
  } catch (err) {
    console.error('announce error:', err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

app.get('/health', (req, res) => res.json({ ok: true, user: client.user?.tag }));

// POST /repost/:sessionId — post a FRESH results message into the session's
// existing Discord thread (or create one if somehow missing). Unlike /announce,
// this does not short-circuit when the session is already announced — it's for
// re-posting after the results format changed (e.g. cash/bank split, role
// mention). Idempotency is intentionally not enforced: each call posts again.
//
// ?clean=true first deletes the bot's prior 🎲 results post(s) in the thread, so
// refreshing doesn't pile up duplicates. Only the bot's own results messages are
// removed — human chatter and other bot posts (🎰 hand log, 🛑 blocks) are left.
app.post('/repost/:sessionId', async (req, res) => {
  const sessionId = req.params.sessionId;
  const clean = req.query.clean === 'true';
  try {
    const session = await trackerGet(`/sessions/${sessionId}`);

    // Reuse the linked thread if present; otherwise make a new one.
    const threadId = session.discordThreadId
      || ((session.notes || '').match(/threadId=(\d+)/) || [])[1];

    let thread;
    if (threadId) {
      thread = await client.channels.fetch(threadId).catch(() => null);
    }
    let createdThread = false;
    if (!thread) {
      const channel = await client.channels.fetch(DISCORD_CHANNEL_ID);
      if (!channel || channel.type !== ChannelType.GuildText) {
        return res.status(500).json({ error: `Channel ${DISCORD_CHANNEL_ID} not a text channel` });
      }
      const threadName = `${session.date} ${session.gameType === 'online' ? 'online' : 'in-person'} results`;
      thread = await channel.threads.create({
        name: threadName,
        autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
        reason: 'Poker tracker results repost',
      });
      await trackerPut(`/sessions/${sessionId}`, { discordThreadId: thread.id });
      createdThread = true;
    }

    // Clean up old results posts before adding the new one (skip on a brand-new
    // thread — nothing to clean).
    let cleaned = 0;
    if (clean && !createdThread) {
      cleaned = await deletePriorResultsPosts(thread, client.user.id);
    }

    await postResultsMessage(thread, session);
    res.json({ ok: true, threadId: thread.id, reposted: true, cleaned });
  } catch (err) {
    console.error('repost error:', err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

// Manually trigger the unpaid-debt reminder for every session that still has
// outstanding bank transfers. Same content as the daily 10:00 NZ job.
app.post('/remind', async (req, res) => {
  try {
    const result = await runPaymentReminders();
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('remind error:', err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

// Manually trigger the reminder for one specific session. 404 if the session id
// isn't found; otherwise the response notes whether the thread was actually
// pinged (e.g. skipped:no unpaid means everyone's already settled).
app.post('/remind/:sessionId', async (req, res) => {
  try {
    const result = await runPaymentReminders({ sessionId: req.params.sessionId });
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('remind/:sessionId error:', err);
    const status = /not found/i.test(err.message) ? 404 : 500;
    res.status(status).json({ error: err.message || String(err) });
  }
});

app.listen(Number(BOT_HTTP_PORT), '127.0.0.1', () => {
  console.log(`Bot HTTP listening on http://127.0.0.1:${BOT_HTTP_PORT}`);
});
