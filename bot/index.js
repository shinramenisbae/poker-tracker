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
import { AsyncLocalStorage } from 'node:async_hooks';
import dotenv from 'dotenv';
// Loads bot/.env by default. A second instance runs from this same checkout, so
// it sets BOT_ENV_FILE to its own file — otherwise dotenv would quietly fill any
// variable that instance's config omits from the FIRST instance's bot/.env
// (inheriting its DISCORD_TOKEN means two processes on one token: duplicate
// imports and double replies).
dotenv.config(process.env.BOT_ENV_FILE ? { path: process.env.BOT_ENV_FILE } : {});
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Client, GatewayIntentBits, ChannelType, ThreadAutoArchiveDuration, REST, Routes, SlashCommandBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { GoogleGenAI, Type } from '@google/genai';
import { classifyAttachment, attachmentTrigger } from './triage.js';
import { createKeyedSerializer } from './serialize.js';
import { accountsMapFromResponse } from './bank.js';
import { calculateSettlements, identifyBankPlayer } from './settlement.js';
import { unpaidDebtors } from './unpaid.js';
import { msUntilNextLocalHour } from './schedule.js';
import { computeStreakTransitions, isLatestCompletedSession } from './streaks.js';
import { resolveSettings, isConfigured } from './settings.js';
import { buildRegistry, trackerFor } from './registry.js';

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
  // Optional: role IDs for the 3-in-a-row streak roles. When set, the bot
  // assigns/removes them as streaks start and break (players must be linked
  // via /paid). Streak lines appear in results posts regardless.
  DISCORD_HOT_ROLE_ID = '',
  DISCORD_COLD_ROLE_ID = '',
} = process.env;

// Bootstrap-only: the bot can't log in without these. Tracker URLs come from
// the registry (GUILD_TRACKERS, or the legacy TRACKER_API_BASE pair), and
// everything Discord-side is set per server with /setup.
for (const [k, v] of Object.entries({ DISCORD_TOKEN, GEMINI_API_KEY })) {
  if (!v) { console.error(`Missing env var: ${k}`); process.exit(1); }
}

// -------- per-guild context --------
//
// One process can serve several Discord servers, each backed by its own tracker
// (its own database). Rather than threading a guild argument through all ~31
// functions that talk to a tracker — where a single missed call site would
// silently read or write ANOTHER group's data — the active guild is carried in
// an AsyncLocalStorage established at each entry point (message, interaction,
// HTTP request, scheduled job). It propagates through awaits and timers, stays
// isolated across concurrent guilds, and is simply absent outside a context, so
// a stray call throws loudly instead of hitting the wrong tracker.
let REGISTRY;
try {
  REGISTRY = buildRegistry(process.env);
} catch (err) {
  console.error(`Tracker registry misconfigured: ${err.message}`);
  process.exit(1);
}
if (REGISTRY.entries.length === 0) {
  console.error('No tracker configured. Set GUILD_TRACKERS, or TRACKER_API_BASE for a single server.');
  process.exit(1);
}
console.log(
  REGISTRY.legacy
    ? `Tracker: single (${REGISTRY.entries[0].apiBase}).`
    : `Trackers: ${REGISTRY.entries.map((e) => `${e.label}→${e.apiBase}`).join(', ')}.`
);

const guildContext = new AsyncLocalStorage();

/** The tracker for the guild whose work we're currently doing. */
function currentTracker() {
  const ctx = guildContext.getStore();
  if (!ctx || !ctx.apiBase) {
    throw new Error('No guild context: a tracker call was made outside withGuild()');
  }
  return ctx;
}

/** Run fn with a guild's tracker as the ambient context. */
function withGuild(ctx, fn) {
  return guildContext.run(ctx, fn);
}

/** Resolve a guild id to its tracker; null when the guild isn't ours to serve. */
function trackerForGuild(guildId) {
  return trackerFor(REGISTRY, guildId);
}

// Per-guild /setup config, keyed by tracker (each guild's settings live in that
// guild's own database, so there's no cross-guild mixing here either).
const SETTINGS_ENV = {
  DISCORD_CHANNEL_ID,
  DISCORD_POKER_ROLE_ID,
  DISCORD_HOT_ROLE_ID,
  DISCORD_COLD_ROLE_ID,
  PAYMENT_REMINDER_HOUR,
  PAYMENT_REMINDER_TZ,
  POKERNOW_CHIP_DIVISOR: process.env.POKERNOW_CHIP_DIVISOR,
};
const SETTINGS_BY_TRACKER = new Map();
const settingsKey = (ctx) => ctx.guildId || ctx.apiBase;

/** Cached /setup config for the current guild. */
function settings() {
  const ctx = currentTracker();
  return SETTINGS_BY_TRACKER.get(settingsKey(ctx)) || resolveSettings(null, SETTINGS_ENV);
}

async function refreshSettings() {
  const ctx = currentTracker();
  try {
    const { settings: row } = await trackerGet('/bot-settings');
    SETTINGS_BY_TRACKER.set(settingsKey(ctx), resolveSettings(row, SETTINGS_ENV));
  } catch (err) {
    // Keep whatever we had rather than dropping to an unconfigured state.
    console.error(`Could not load bot settings for ${ctx.label}, keeping current config:`, err.message);
  }
  return settings();
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
  const res = await fetch(`${currentTracker().apiBase}${path}`);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}
async function trackerPost(path, body) {
  const res = await fetch(`${currentTracker().apiBase}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}
async function trackerPut(path, body) {
  const res = await fetch(`${currentTracker().apiBase}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PUT ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}
async function trackerDelete(path) {
  const res = await fetch(`${currentTracker().apiBase}${path}`, { method: 'DELETE' });
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
  const divisor = settings().chipDivisor;
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
      const res = await fetch(`${currentTracker().apiBase}/sessions/${sessionId}/handlog`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawLog: text }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      const result = await res.json();
      await thread.send(
        `🎰 Hand log parsed: ${result.eligibleEvHands} qualifying all-in EV hands across ${result.totalHands} hands.\n` +
        `See who's a luck box: ${currentTracker().uiBase}/#/session/${sessionId}/ev`
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
        `Map them at ${currentTracker().uiBase}/#/aliases then post any message in this thread and I'll retry.`
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
    // Online sessions settle entirely by bank transfer — there is no physical
    // cash on a table. Tagging these as 'cash' made the settlement treat each
    // loser's loss as already-collected cash, so they showed as owing nothing.
    paymentMethod: 'bank',
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
      amount: buyIn, method: 'bank', isRebuy: false,
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

// -------- Hot/cold streak lines + roles --------

const STREAK_LINES = {
  hotStarted: [
    (n, len) => `🔥 **${n}** has won ${len} in a row — officially RUNNING HOT. Someone check the deck.`,
    (n, len) => `🔥 ${len} straight wins for **${n}**. The Running Hot role has been bestowed. Fear them.`,
    (n, len) => `🔥 **${n}** hits ${len} in a row. It's not luck, it's a heater (it's luck).`,
  ],
  hotExtended: [
    (n, len) => `🔥 **${n}** extends the heater to ${len} straight. Unsustainable. Probably.`,
    (n, len) => `🔥 Still cooking: **${n}** makes it ${len} in a row. The table is scared.`,
  ],
  hotBroken: [
    (n, len) => `🧯 Heater extinguished — **${n}**'s ${len}-win run ends tonight. Back to the mortal realm.`,
    (n, len) => `🧯 **${n}** finally loses one. The ${len}-session heater is over; gravity remains undefeated.`,
  ],
  coldStarted: [
    (n, len) => `🧊 **${n}** has lost ${len} in a row — RUNNING COLD. Thoughts and prayers.`,
    (n, len) => `🧊 ${len} straight Ls for **${n}**. The Running Cold role has been earned. Condolences.`,
    (n, len) => `🧊 **${n}** is officially running cold (${len} in a row). Have you tried winning instead?`,
  ],
  coldExtended: [
    (n, len) => `🧊 **${n}** deepens the freeze: ${len} losses in a row. The ice age continues.`,
    (n, len) => `🧊 Loss #${len} in a row for **${n}**. At this point it's a lifestyle.`,
  ],
  coldBroken: [
    (n, len) => `🌤️ **${n}** finally books a win — the ${len}-loss cold streak is OVER. Spring has come.`,
    (n, len) => `🌤️ The curse lifts: **${n}** snaps a ${len}-session skid. Scenes.`,
  ],
};

function streakLine(t) {
  const key = t.kind + t.event[0].toUpperCase() + t.event.slice(1); // e.g. hotStarted
  const pool = STREAK_LINES[key] || [];
  if (pool.length === 0) return '';
  return pool[Math.floor(Math.random() * pool.length)](t.playerName, t.length);
}

// Compute streak transitions for this session and render the message section.
// Failures degrade to "no section" — a streaks hiccup must never block results.
async function buildStreakSection(session) {
  try {
    const sessions = await trackerGet('/sessions');
    const transitions = computeStreakTransitions(sessions, session.id);
    const lines = transitions.map(streakLine).filter(Boolean);
    const text = lines.length ? `\n📈 **Streak watch**\n${lines.join('\n')}\n` : '';
    return { text, transitions, sessions };
  } catch (err) {
    console.error('Streak computation failed:', err.message);
    return { text: '', transitions: [], sessions: null };
  }
}

// Assign/remove the hot/cold roles per the transitions. Only runs when this is
// the LATEST completed session (a repost of an old session must not rewrite
// today's roles) and only for players linked via /paid. Starting one streak
// also clears the opposite role in case a past removal was missed. All role
// ops are best-effort: a Discord permission error is logged, never thrown.
async function applyStreakRoles(thread, transitions, sessions, sessionId) {
  if (!settings().hotRoleId && !settings().coldRoleId) return;
  if (transitions.length === 0 || !sessions) return;
  if (!isLatestCompletedSession(sessions, sessionId)) return;
  const guild = thread.guild;
  if (!guild) return;

  const links = await getDiscordLinks();
  const nameToUser = {};
  for (const [uid, name] of Object.entries(links)) {
    if (!(name in nameToUser)) nameToUser[name] = uid;
  }

  for (const t of transitions) {
    const roleId = t.kind === 'hot' ? settings().hotRoleId : settings().coldRoleId;
    const oppositeId = t.kind === 'hot' ? settings().coldRoleId : settings().hotRoleId;
    if (!roleId) continue;
    const uid = nameToUser[t.playerName];
    if (!uid) continue;
    try {
      const member = await guild.members.fetch(uid);
      if (t.event === 'broken') {
        await member.roles.remove(roleId);
      } else {
        await member.roles.add(roleId); // started or extended — idempotent
        if (t.event === 'started' && oppositeId) {
          await member.roles.remove(oppositeId).catch(() => {});
        }
      }
    } catch (err) {
      console.error(`Streak role ${t.event} (${t.kind}) for ${t.playerName} failed:`, err.message);
    }
  }
}

async function postResultsMessage(thread, session) {
  const results = computePerPlayerResults(session);
  const bankAccounts = await fetchBankAccounts();
  const streaks = await buildStreakSection(session);
  const text = formatResultsMessage(session, results, bankAccounts) + streaks.text;

  // Mention the poker role (if configured) so everyone gets pulled into the
  // thread. allowedMentions must explicitly list the role id or Discord
  // suppresses the ping. When unset, send a plain message with no mentions.
  if (settings().pokerRoleId) {
    await thread.send({
      content: `<@&${settings().pokerRoleId}>\n${text}`,
      allowedMentions: { roles: [settings().pokerRoleId] },
    });
  } else {
    await thread.send({ content: text, allowedMentions: { parse: [] } });
  }

  await applyStreakRoles(thread, streaks.transitions, streaks.sessions, session.id);
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

const UNPAID_COMMAND = new SlashCommandBuilder()
  .setName('unpaid')
  .setDescription('Show who still owes the bank player for this session.');

// Standalone linking — /paid only links as a side effect of marking a debt, so
// players with nothing to pay (winners, or people who haven't played yet) had
// no way to get linked and were invisible to reminder pings and streak roles.
const LINK_COMMAND = new SlashCommandBuilder()
  .setName('link')
  .setDescription('Link a Discord user to a tracker player (for reminders, /paid, and streak roles).')
  .addStringOption((o) =>
    o.setName('player')
      .setDescription('Tracker player name, e.g. Alvin')
      .setRequired(true)
  )
  .addUserOption((o) =>
    o.setName('user')
      .setDescription('Discord user to link (defaults to you).')
      .setRequired(false)
  );

// Server-owner setup, so nobody has to SSH in and edit a .env. Uses Discord's
// native channel/role pickers — the owner never sees or copies an ID, and
// Developer Mode isn't needed. Restricted to Manage Server.
const SETUP_COMMAND = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Configure the poker bot for this server (channel, roles, reminder time).')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false)
  .addChannelOption((o) =>
    o.setName('channel')
      .setDescription('Channel where session threads live — the bot watches this one.')
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(false)
  )
  .addRoleOption((o) =>
    o.setName('poker_role')
      .setDescription('Role to @mention on results posts (pulls everyone into the thread).')
      .setRequired(false)
  )
  .addRoleOption((o) =>
    o.setName('hot_role')
      .setDescription('Role given for winning 3 sessions in a row.')
      .setRequired(false)
  )
  .addRoleOption((o) =>
    o.setName('cold_role')
      .setDescription('Role given for losing 3 sessions in a row.')
      .setRequired(false)
  )
  .addIntegerOption((o) =>
    o.setName('reminder_hour')
      .setDescription('Hour (0-23) for the daily unpaid reminder. Default 10.')
      .setMinValue(0)
      .setMaxValue(23)
      .setRequired(false)
  )
  .addStringOption((o) =>
    o.setName('timezone')
      .setDescription('Timezone for the reminder, e.g. Pacific/Auckland.')
      .setRequired(false)
  )
  .addNumberOption((o) =>
    o.setName('chip_divisor')
      .setDescription('PokerNow chips per $1 (default 100; use 1 if you play in dollars).')
      .setMinValue(0.0001)
      .setRequired(false)
  );

const SETTINGS_COMMAND = new SlashCommandBuilder()
  .setName('settings')
  .setDescription('Show the bot\'s current configuration for this server.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false);

async function registerSlashCommands() {
  if (!DISCORD_APP_ID) {
    console.warn('DISCORD_APP_ID unset — skipping slash command registration.');
    return;
  }
  try {
    const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
    await rest.put(Routes.applicationCommands(DISCORD_APP_ID), {
      body: [
        PAID_COMMAND.toJSON(), UNPAID_COMMAND.toJSON(), LINK_COMMAND.toJSON(),
        SETUP_COMMAND.toJSON(), SETTINGS_COMMAND.toJSON(),
      ],
    });
    console.log('Registered /paid, /unpaid, /link, /setup and /settings slash commands.');
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
  if (!isThread || ch.parentId !== settings().channelId) {
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

async function handleUnpaidCommand(interaction) {
  // Must be used inside a session results thread.
  const ch = interaction.channel;
  const isThread = ch && [ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.AnnouncementThread].includes(ch.type);
  if (!isThread || ch.parentId !== settings().channelId) {
    return interaction.reply({ content: '⚠️ Use `/unpaid` inside a session results thread.', flags: MessageFlags.Ephemeral });
  }

  const session = await findSessionByThreadId(ch.id);
  if (!session) {
    return interaction.reply({ content: "⚠️ Couldn't find a session for this thread.", flags: MessageFlags.Ephemeral });
  }

  const payments = await getSessionPayments(session.id);
  const unpaid = unpaidDebtors(session, new Set(Object.keys(payments)));
  if (unpaid.length === 0) {
    return interaction.reply({ content: `🎉 **${session.date}** — everyone has paid. Nothing outstanding.` });
  }

  // @mention linked users where we can; plain name otherwise.
  const links = await getDiscordLinks();
  const nameToUser = {};
  for (const [uid, name] of Object.entries(links)) {
    if (!(name in nameToUser)) nameToUser[name] = uid;
  }
  const mentions = [];
  const lines = unpaid.map((u) => {
    const uid = nameToUser[u.playerName];
    if (uid) mentions.push(uid);
    const who = uid ? `<@${uid}>` : `**${u.playerName}**`;
    return `• ${who} — owes $${u.owes.toFixed(2)}`;
  });
  const total = unpaid.reduce((s, u) => s + u.owes, 0);
  const content =
    `💸 **Still unpaid — ${session.date}**\n${lines.join('\n')}\n` +
    `_Total outstanding: $${total.toFixed(2)}. Run \`/paid\` once you've sent it._`;
  return interaction.reply({ content, allowedMentions: { users: mentions } });
}

// /setup — the server owner configures the bot from inside Discord. Every
// option is optional, so it doubles as "change one thing later".
async function handleSetupCommand(interaction) {
  const channel = interaction.options.getChannel('channel');
  const pokerRole = interaction.options.getRole('poker_role');
  const hotRole = interaction.options.getRole('hot_role');
  const coldRole = interaction.options.getRole('cold_role');
  const hour = interaction.options.getInteger('reminder_hour');
  const tz = interaction.options.getString('timezone');
  const divisor = interaction.options.getNumber('chip_divisor');

  const update = { guildId: interaction.guildId, guildName: interaction.guild?.name || null };
  if (channel) update.channelId = channel.id;
  if (pokerRole) update.pokerRoleId = pokerRole.id;
  if (hotRole) update.hotRoleId = hotRole.id;
  if (coldRole) update.coldRoleId = coldRole.id;
  if (hour !== null) update.reminderHour = hour;
  if (divisor !== null) update.chipDivisor = divisor;
  if (tz) {
    // Reject a bad zone here rather than letting it break the daily scheduler.
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
    } catch {
      return interaction.reply({
        content: `⚠️ **${tz}** isn't a valid timezone. Use an IANA name like \`Pacific/Auckland\`.`,
        flags: MessageFlags.Ephemeral,
      });
    }
    update.reminderTz = tz;
  }

  const changed = Object.keys(update).filter((k) => k !== 'guildId' && k !== 'guildName');
  if (changed.length === 0) {
    return interaction.reply({
      content: 'Nothing to change — pass at least one option. Run `/settings` to see the current config.',
      flags: MessageFlags.Ephemeral,
    });
  }

  try {
    await trackerPut('/bot-settings', update);
  } catch (err) {
    return interaction.reply({ content: `⚠️ Couldn't save settings: ${err.message}`, flags: MessageFlags.Ephemeral });
  }
  await refreshSettings();
  // The reminder timer captured the old hour/timezone; re-arm it so a changed
  // schedule takes effect without restarting the bot.
  if (update.reminderHour !== undefined || update.reminderTz !== undefined) {
    scheduleDailyReminders({ reason: 'settings updated' });
  }

  return interaction.reply({ content: `✅ Settings updated.\n\n${describeSettings()}`, allowedMentions: { parse: [] } });
}

function describeSettings() {
  const s = settings();
  const via = (f) => (s.source[f] === 'setup' ? '' : ' _(from server config)_');
  const line = (label, value, field) => (value
    ? `• **${label}:** ${value}${via(field)}`
    : `• **${label}:** _not set_`);

  return [
    line('Watched channel', s.channelId ? `<#${s.channelId}>` : '', 'channelId'),
    line('Results ping role', s.pokerRoleId ? `<@&${s.pokerRoleId}>` : '', 'pokerRoleId'),
    line('Running Hot role', s.hotRoleId ? `<@&${s.hotRoleId}>` : '', 'hotRoleId'),
    line('Running Cold role', s.coldRoleId ? `<@&${s.coldRoleId}>` : '', 'coldRoleId'),
    line('Daily reminder', `${String(s.reminderHour).padStart(2, '0')}:00 ${s.reminderTz}`, 'reminderHour'),
    line('PokerNow chips per $1', String(s.chipDivisor), 'chipDivisor'),
    !isConfigured(s)
      ? '\n⚠️ No channel set yet — run `/setup channel:#your-poker-channel` to switch the bot on.'
      : '',
  ].filter(Boolean).join('\n');
}

async function handleSettingsCommand(interaction) {
  await refreshSettings();
  return interaction.reply({
    content: `⚙️ **Poker bot configuration**\n${describeSettings()}`,
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  });
}

// /link — connect a Discord user to a tracker player, no payment required.
// Usable anywhere in the server (no session-thread context needed).
async function handleLinkCommand(interaction) {
  const named = (interaction.options.getString('player') || '').trim();
  const targetUser = interaction.options.getUser('user') || interaction.user;

  // Resolve case-insensitively against the tracker's canonical player list so
  // a typo can't create a link to a player that doesn't exist.
  let canonical;
  try {
    canonical = (await trackerGet('/alias-mappings')).canonicalPlayers || [];
  } catch (err) {
    return interaction.reply({
      content: `⚠️ Couldn't fetch the player list from the tracker: ${err.message}`,
      flags: MessageFlags.Ephemeral,
    });
  }
  const playerName = canonical.find((n) => n.toLowerCase() === named.toLowerCase());
  if (!playerName) {
    return interaction.reply({
      content: `⚠️ No player named **${named}** in the tracker. Check the exact name at ${currentTracker().uiBase}/#/aliases.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const links = await getDiscordLinks();
  const previous = links[targetUser.id];
  try {
    await linkDiscordUser(targetUser.id, playerName);
  } catch (err) {
    return interaction.reply({
      content: `⚠️ Failed to save the link: ${err.message}`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const who = targetUser.id === interaction.user.id ? 'You are' : `<@${targetUser.id}> is`;
  let msg = `🔗 ${who} now linked to **${playerName}** — payment reminders and streak roles will find them.`;
  if (previous && previous !== playerName) {
    msg += ` _(was linked to **${previous}**)_`;
  }
  // Flag a likely mistake: someone ELSE is already linked to this same player.
  const otherUid = Object.keys(links).find((uid) => uid !== targetUser.id && links[uid] === playerName);
  if (otherUid) {
    msg += `\n⚠️ Heads up: <@${otherUid}> is also linked to **${playerName}** — if that's stale, re-link them with \`/link\`.`;
  }
  return interaction.reply({ content: msg, allowedMentions: { parse: [] } });
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

// Mixed register — sarcastic taunts AND grovelling begging lines, in roughly
// equal proportion. The random pick treats them as one bag, so a single
// reminder may shame one debtor and beg the next.
const TROLL_TAUNTS = [
  // sarcastic / mean
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
  // begging / grovelling
  'please big bro, we all know u got it 🥺',
  'the greatest larper of them all, please spare us your chump change',
  'begging on bended knee here, just a few taps and we square 🙏',
  "i'm not above grovelling. please. it's been days.",
  'your bank app is right there. one swipe. that\'s all we ask 🙏',
  'i kiss your ring and ask only for what is owed 🥺',
  'we know you good for it, please just do the thing',
  'humbly requesting the funds, oh great one',
  'i would walk through fire for this transfer, you only need to tap your phone',
  'consider this a love letter, just with bank details attached',
  'just a few coins for a weary traveller 🥺👉👈',
  'big king energy demands big king payment, please bestow upon us',
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

// The bank player's payment details, so debtors can pay straight from the
// reminder instead of scrolling back to the original results post.
function bankDetailLines(bankName, bankInfo) {
  if (!bankInfo || (!bankInfo.displayName && !bankInfo.account)) {
    return `   _(no account on file — ask ${bankName} for their details)_`;
  }
  const lines = [];
  if (bankInfo.displayName) lines.push(`   ${bankInfo.displayName}`);
  if (bankInfo.account) lines.push(`   \`${bankInfo.account}\``);
  return lines.join('\n');
}

function buildReminderMessage({ session, unpaidLines, bankMention, bankName, bankInfo }) {
  const reason = pickRandom(BANK_BEGGAR_REASONS);
  const footer = pickRandom(FOOTER_SNARKS);
  return (
    `⏰ **Payment reminder — ${session.date}**\n` +
    `${unpaidLines.join('\n')}\n` +
    `\n🏦 ${bankMention} ${reason}\n` +
    `${bankDetailLines(bankName, bankInfo)}\n` +
    `\n${footer}`
  );
}

// Posts reminders for sessions with unpaid debtors. If sessionId is given, only
// that session is processed (and a missing session id throws). Always throws on
// failure so HTTP callers can surface errors; the daily timer wraps + swallows.
async function runPaymentReminders({ sessionId = null } = {}) {
  const [allSessions, links, bankAccounts] = await Promise.all([
    trackerGet('/sessions'),
    getDiscordLinks(),
    fetchBankAccounts(), // returns {} on failure → "no account on file" fallback
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

    const content = buildReminderMessage({
      session,
      unpaidLines,
      bankMention,
      bankName,
      bankInfo: bankAccounts[bankName],
    });
    await thread.send({ content, allowedMentions: { users: mentions } });
    reminded.push(session.id);
  }
  console.log(`Payment reminders: pinged ${reminded.length} thread(s)${sessionId ? ` (session ${sessionId})` : ''}.`);
  return { reminded, skipped };
}

// Self-rescheduling daily timer (setTimeout, not setInterval, so DST shifts are
// recomputed each day). Swallows errors so a transient failure doesn't kill the
// loop — the next day still runs.
// Single pending timer. /setup can re-arm this when the hour/timezone changes,
// and the old timer MUST be cleared first — each one reschedules itself, so
// leaving a stale one behind would multiply the daily reminders.
// One pending timer PER GUILD — keyed so re-arming one server's reminder can't
// cancel another's. Each is cleared before re-arming: every timer reschedules
// itself, so a stale one left behind would multiply that guild's reminders.
// The timer callback inherits the guild context it was created in (async
// context propagates through timers), so it reminds the right server.
const reminderTimers = new Map();

function scheduleDailyReminders({ reason = '' } = {}) {
  const ctx = currentTracker();
  const key = settingsKey(ctx);
  if (reminderTimers.has(key)) clearTimeout(reminderTimers.get(key));

  const hour = settings().reminderHour;
  const tz = settings().reminderTz;
  const delay = msUntilNextLocalHour(new Date(), hour, tz);
  console.log(
    `[${ctx.label}] Next payment reminder in ${(delay / 3600000).toFixed(1)}h (${hour}:00 ${tz})` +
    `${reason ? ` [${reason}]` : ''}.`
  );
  reminderTimers.set(key, setTimeout(async () => {
    try { await runPaymentReminders(); }
    catch (err) { console.error(`[${ctx.label}] Daily payment reminder failed:`, err.message); }
    scheduleDailyReminders(); // reschedule for the following day
  }, delay));
}

// -------- Discord event wiring --------
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const handlers = {
    paid: handlePaidCommand,
    unpaid: handleUnpaidCommand,
    link: handleLinkCommand,
    setup: handleSetupCommand,
    settings: handleSettingsCommand,
  };
  const handler = handlers[interaction.commandName];
  if (!handler) return;

  // Which tracker does this server belong to? An unregistered server gets none,
  // and is told so rather than silently touching another group's data.
  const ctx = trackerForGuild(interaction.guildId);
  if (!ctx) {
    return interaction.reply({
      content: '⚠️ This server isn\'t set up with a poker tracker yet. Ask the bot operator to register it.',
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
  }

  try {
    await withGuild(ctx, () => handler(interaction));
  } catch (err) {
    console.error(`${interaction.commandName} command error (${ctx.label}):`, err);
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

    const ctx = trackerForGuild(msg.guildId);
    if (!ctx) return; // not a server we serve

    await withGuild(ctx, async () => {
      if (ch.parentId !== settings().channelId) return;

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
    });
  } catch (err) {
    console.error('messageCreate error:', err);
  }
});

// Catch-up scan for ONE guild: process every thread in its watched channel, to
// recover threads created/posted while the bot was offline. Runs with the
// 'scan' trigger, which imports a thread only if it was never imported before
// (no prior 🎲 results post) — so a session deliberately deleted between
// restarts is NOT silently re-created.
async function startupScanForCurrentGuild(label) {
  if (!isConfigured(settings())) {
    console.warn(
      `[${label}] No watched channel configured. A server admin should run ` +
      '"/setup channel:#your-poker-channel" to switch the bot on.'
    );
    return;
  }
  try {
    const channel = await client.channels.fetch(settings().channelId);
    if (!channel || channel.type !== ChannelType.GuildText) {
      console.warn(`[${label}] Startup scan skipped: channel ${settings().channelId} is not a GuildText.`);
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
    console.log(`[${label}] Startup scan: ${threads.size} threads to check.`);
    for (const thread of threads.values()) {
      try { await processThread(thread, 'scan'); }
      catch (err) { console.error(`[${label}] Startup scan thread ${thread.id} (${thread.name}):`, err.message); }
    }
    console.log(`[${label}] Startup scan complete.`);
  } catch (err) {
    console.error(`[${label}] Startup scan failed:`, err);
  }
}

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}.`);

  // Commands are global (one application), so they're registered once rather
  // than per guild. They're registered even when a server is unconfigured —
  // /setup is how it gets configured in the first place.
  await registerSlashCommands();

  // Each served guild loads its own /setup config, then scans independently:
  // one guild's tracker being down must not stop the others starting up.
  for (const ctx of REGISTRY.entries) {
    await withGuild(ctx, async () => {
      await refreshSettings();
      scheduleDailyReminders({ reason: `startup ${ctx.label}` });
      await startupScanForCurrentGuild(ctx.label);
    });
  }
});
await client.login(DISCORD_TOKEN);

// -------- HTTP server for in-person announcements --------
//
// With one bot serving several servers, every backend calls this same port, so
// each request must say which guild it's for. Backends send ?guildId= (from
// their own GUILD_ID env). In legacy single-tracker mode it may be omitted.
const app = express();
app.use(express.json());

// Wraps a handler so it runs inside the caller's guild context, rejecting a
// request that names a guild we don't serve rather than acting on the wrong
// tracker.
function withGuildFromRequest(handler) {
  return async (req, res) => {
    const guildId = req.query.guildId || (req.body && req.body.guildId) || null;
    const ctx = trackerForGuild(guildId);
    if (!ctx) {
      return res.status(400).json({
        error: guildId
          ? `Unknown guildId ${guildId} — not registered in GUILD_TRACKERS`
          : 'guildId required (this bot serves multiple servers)',
      });
    }
    return withGuild(ctx, () => handler(req, res));
  };
}

// Create the results thread for a session and post into it. Shared by
// /announce and /reannounce so both produce an identical thread + message.
async function announceSession(session) {
  const channel = await client.channels.fetch(settings().channelId);
  if (!channel || channel.type !== ChannelType.GuildText) {
    throw new Error(`Channel ${settings().channelId} not a text channel`);
  }

  const threadName = `${session.date} ${session.gameType === 'online' ? 'online' : 'in-person'} results`;
  const thread = await channel.threads.create({
    name: threadName,
    autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
    reason: 'Posted from poker tracker (in-person announcement)',
  });
  await postResultsMessage(thread, session);

  // Mark session as announced via the dedicated column (don't touch user's notes).
  await trackerPut(`/sessions/${session.id}`, { discordThreadId: thread.id });
  return { threadId: thread.id, threadName };
}

// Delete a session's results thread and clear the tracker's announcement
// markers, so the session can be posted again from scratch (used when the
// numbers were wrong and the posted thread is now misleading).
//
// Two things matter here:
//   1. NEVER delete anything that isn't a thread under the watched channel — a
//      stale/incorrect id must not be able to take out the channel itself.
//   2. Clear the tracker state even when the thread is already gone (deleted by
//      hand in Discord), otherwise the session stays permanently "announced"
//      and can never be re-posted.
async function unannounceSession(session) {
  const threadId = session.discordThreadId
    || ((session.notes || '').match(/threadId=(\d+)/) || [])[1]
    || null;

  let deleted = false;
  let threadMissing = false;
  if (threadId) {
    const thread = await client.channels.fetch(threadId).catch(() => null);
    if (thread && thread.isThread() && thread.parentId === settings().channelId) {
      await thread.delete('Removed from the poker tracker for a corrected repost');
      deleted = true;
    } else {
      threadMissing = true; // already gone, or not a thread we own
    }
  }

  // Clear the column AND the legacy notes marker — the /announce guard and the
  // Results page both treat that marker as "already announced", so leaving it
  // behind would block the re-post.
  const update = { discordThreadId: null };
  const notes = session.notes || '';
  if (/Announced on Discord \(threadId=\d+\)/.test(notes)) {
    update.notes = notes.replace(/\s*Announced on Discord \(threadId=\d+\)\s*/g, ' ').trim();
  }
  await trackerPut(`/sessions/${session.id}`, update);

  return { threadId, deleted, threadMissing };
}

app.post('/announce/:sessionId', withGuildFromRequest(async (req, res) => {
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

    const { threadId, threadName } = await announceSession(session);
    res.json({ ok: true, threadId, threadName });
  } catch (err) {
    console.error('announce error:', err);
    res.status(500).json({ error: err.message || String(err) });
  }
}));

// POST /unannounce/:sessionId — delete the posted thread and clear the markers,
// leaving the session postable again. Safe when nothing was announced.
app.post('/unannounce/:sessionId', withGuildFromRequest(async (req, res) => {
  const sessionId = req.params.sessionId;
  try {
    const session = await trackerGet(`/sessions/${sessionId}`);
    const result = await unannounceSession(session);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('unannounce error:', err);
    res.status(500).json({ error: err.message || String(err) });
  }
}));

// POST /reannounce/:sessionId — delete the old thread and post a fresh one in a
// single call. Done bot-side so the UI can't half-fail between two requests,
// and the session is re-fetched in between so the new post carries the
// corrected numbers (the whole point of reposting).
app.post('/reannounce/:sessionId', withGuildFromRequest(async (req, res) => {
  const sessionId = req.params.sessionId;
  try {
    const before = await trackerGet(`/sessions/${sessionId}`);
    const removed = await unannounceSession(before);
    const fresh = await trackerGet(`/sessions/${sessionId}`);
    const { threadId, threadName } = await announceSession(fresh);
    res.json({
      ok: true,
      threadId,
      threadName,
      previousThreadId: removed.threadId,
      deletedPrevious: removed.deleted,
    });
  } catch (err) {
    console.error('reannounce error:', err);
    res.status(500).json({ error: err.message || String(err) });
  }
}));

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
app.post('/repost/:sessionId', withGuildFromRequest(async (req, res) => {
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
      const channel = await client.channels.fetch(settings().channelId);
      if (!channel || channel.type !== ChannelType.GuildText) {
        return res.status(500).json({ error: `Channel ${settings().channelId} not a text channel` });
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
}));

// Manually trigger the unpaid-debt reminder for every session that still has
// outstanding bank transfers. Same content as the daily 10:00 NZ job.
app.post('/remind', withGuildFromRequest(async (req, res) => {
  try {
    const result = await runPaymentReminders();
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('remind error:', err);
    res.status(500).json({ error: err.message || String(err) });
  }
}));

// Manually trigger the reminder for one specific session. 404 if the session id
// isn't found; otherwise the response notes whether the thread was actually
// pinged (e.g. skipped:no unpaid means everyone's already settled).
app.post('/remind/:sessionId', withGuildFromRequest(async (req, res) => {
  try {
    const result = await runPaymentReminders({ sessionId: req.params.sessionId });
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('remind/:sessionId error:', err);
    const status = /not found/i.test(err.message) ? 404 : 500;
    res.status(status).json({ error: err.message || String(err) });
  }
}));

app.listen(Number(BOT_HTTP_PORT), '127.0.0.1', () => {
  console.log(`Bot HTTP listening on http://127.0.0.1:${BOT_HTTP_PORT}`);
});
