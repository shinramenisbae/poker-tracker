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
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Client, GatewayIntentBits, ChannelType, ThreadAutoArchiveDuration } from 'discord.js';
import { GoogleGenAI, Type } from '@google/genai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const {
  DISCORD_TOKEN,
  DISCORD_CHANNEL_ID,
  TRACKER_API_BASE,
  TRACKER_UI_BASE,
  GEMINI_API_KEY,
  GEMINI_MODEL = 'gemini-2.5-flash',
  BOT_HTTP_PORT = '6000',
} = process.env;

for (const [k, v] of Object.entries({ DISCORD_TOKEN, DISCORD_CHANNEL_ID, TRACKER_API_BASE, TRACKER_UI_BASE, GEMINI_API_KEY })) {
  if (!v) { console.error(`Missing env var: ${k}`); process.exit(1); }
}

const bankAccounts = JSON.parse(await fs.readFile(path.join(__dirname, 'bank-accounts.json'), 'utf8'));
delete bankAccounts._comment;
console.log(`Loaded ${Object.keys(bankAccounts).length} bank accounts.`);

const genai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// -------- in-memory caches (rebuilt on restart, that's fine) --------
const imageClassificationCache = new Map(); // url -> {type, rows}
const waitingThreadAliases = new Map();      // threadId -> Set<alias> we last posted a "waiting" message for

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

async function fetchAliasLookup() {
  const { aliases } = await trackerGet('/alias-mappings');
  const lookup = new Map();
  for (const { alias, realName } of aliases) {
    if (realName && realName.trim()) lookup.set(alias.toLowerCase(), realName.trim());
  }
  return lookup;
}

async function findSessionByImportMarker(threadId) {
  const sessions = await trackerGet('/sessions');
  return sessions.find((s) => (s.notes || '').includes(`threadId=${threadId}`));
}

// -------- Discord helpers --------
async function collectThreadImages(thread) {
  const images = [];
  let before;
  while (true) {
    const batch = await thread.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (batch.size === 0) break;
    for (const msg of batch.values()) {
      for (const att of msg.attachments.values()) {
        const ct = (att.contentType || '').toLowerCase();
        if (ct.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(att.name || '')) {
          images.push({ url: att.url, createdAt: msg.createdTimestamp });
        }
      }
    }
    if (batch.size < 100) break;
    before = batch.last().id;
  }
  return images.sort((a, b) => a.createdAt - b.createdAt);
}

// -------- Core: process a thread that may have an online ledger --------
async function processThread(thread) {
  const threadId = thread.id;

  // 1. Already imported?
  if (await findSessionByImportMarker(threadId)) {
    return; // idempotent; nothing to do
  }

  // 2. Collect + classify images
  const images = await collectThreadImages(thread);
  if (images.length === 0) return;

  const ledgerRows = [];
  for (const img of images) {
    const result = await classifyImage(img.url);
    if (result.type === 'online_ledger') ledgerRows.push(...(result.rows || []));
  }
  if (ledgerRows.length === 0) return;

  // 3. Alias check
  const aliasLookup = await fetchAliasLookup();
  const unmapped = [];
  const mappedRows = [];
  for (const row of ledgerRows) {
    const real = aliasLookup.get((row.name || '').toLowerCase());
    if (!real) unmapped.push(row.name);
    else mappedRows.push({ ...row, name: real, originalAlias: row.name });
  }

  if (unmapped.length > 0) {
    // Block import; tell humans to map.
    const uniqueUnmapped = [...new Set(unmapped)].sort();

    // Register them in the tracker so they appear in the /aliases UI.
    // PUT is an upsert; null realName means "unmapped, please someone fill in".
    for (const a of uniqueUnmapped) {
      try { await trackerPut(`/alias-mappings/${encodeURIComponent(a)}`, { realName: null }); }
      catch (err) { console.error(`Failed to register alias "${a}":`, err.message); }
    }

    const lastNotified = waitingThreadAliases.get(threadId);
    const same = lastNotified && lastNotified.size === uniqueUnmapped.length
      && uniqueUnmapped.every((a) => lastNotified.has(a));
    if (!same) {
      const list = uniqueUnmapped.map((a) => `\`${a}\``).join(', ');
      await thread.send(
        `🛑 Can't import yet — need someone to identify these aliases first:\n${list}\n\n` +
        `Map them at ${TRACKER_UI_BASE}/#/aliases then post any message in this thread and I'll retry.`
      );
      waitingThreadAliases.set(threadId, new Set(uniqueUnmapped));
    }
    return;
  }

  // 4. All aliases mapped — import.
  waitingThreadAliases.delete(threadId);
  const sessionDate = new Date(thread.createdTimestamp ?? Date.now()).toISOString().slice(0, 10);
  const sessionTimestamp = new Date(`${sessionDate}T20:00:00Z`).getTime();
  const players = mappedRows.map((r) => ({
    id: randomUUID(),
    name: r.name,
    paymentMethod: 'cash',
    cashOut: { amount: (Number(r.buyOut) || 0) + (Number(r.stack) || 0), timestamp: sessionTimestamp },
  }));
  const created = await trackerPost('/sessions', {
    date: sessionDate,
    notes: `Imported from Discord (threadId=${threadId})`,
    gameType: 'online',
    status: 'completed',
    players,
  });
  for (let i = 0; i < mappedRows.length; i++) {
    const buyIn = Number(mappedRows[i].buyIn) || 0;
    if (buyIn <= 0) continue;
    await trackerPost(`/sessions/${created.id}/players/${players[i].id}/buyins`, {
      amount: buyIn, method: 'cash', isRebuy: false,
    });
  }

  // 5. Post results message.
  const full = await trackerGet(`/sessions/${created.id}`);
  await postResultsMessage(thread, full);
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

function formatResultsMessage(session, results) {
  const winners = results.filter((r) => r.profit > 0.005);
  const losers = results.filter((r) => r.profit < -0.005);
  const evens = results.filter((r) => Math.abs(r.profit) <= 0.005);

  const bankPlayer = winners[0]; // biggest winner
  const bankInfo = bankPlayer ? bankAccounts[bankPlayer.name] : null;

  let msg = `🎲 **Session results — ${session.date}**\n`;
  msg += session.gameType === 'online' ? '🌐 _Online session_\n\n' : '🪑 _In-person session_\n\n';

  if (winners.length > 0) {
    msg += '🏆 **Winners**\n';
    for (const w of winners) msg += `• ${w.name}: **${formatMoney(w.profit)}**\n`;
    msg += '\n';
  }

  if (losers.length > 0) {
    msg += `💸 **Losers** _(pay ${bankPlayer ? bankPlayer.name : 'the bank player'})_\n`;
    for (const l of losers) msg += `• ${l.name}: ${formatMoney(l.profit)}\n`;
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

async function postResultsMessage(thread, session) {
  const results = computePerPlayerResults(session);
  const text = formatResultsMessage(session, results);
  await thread.send(text);
}

// -------- Discord event wiring --------
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

client.on('messageCreate', async (msg) => {
  try {
    if (msg.author?.bot) return;
    const ch = msg.channel;
    const isThread = [ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.AnnouncementThread].includes(ch.type);
    if (!isThread) return;
    if (ch.parentId !== DISCORD_CHANNEL_ID) return;
    await processThread(ch);
  } catch (err) {
    console.error('messageCreate error:', err);
  }
});

client.once('ready', () => console.log(`Logged in as ${client.user.tag}.`));
await client.login(DISCORD_TOKEN);

// -------- HTTP server for in-person announcements --------
const app = express();
app.use(express.json());

app.post('/announce/:sessionId', async (req, res) => {
  const sessionId = req.params.sessionId;
  try {
    const session = await trackerGet(`/sessions/${sessionId}`);

    // Already announced?
    const alreadyMarker = (session.notes || '').match(/Announced on Discord \(threadId=(\d+)\)/);
    if (alreadyMarker) {
      return res.json({ ok: true, alreadyAnnouncedThreadId: alreadyMarker[1] });
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

    // Mark session as announced (append to notes)
    const newNotes = (session.notes ? session.notes + ' ' : '') + `Announced on Discord (threadId=${thread.id})`;
    await trackerPut(`/sessions/${sessionId}`, { notes: newNotes });

    res.json({ ok: true, threadId: thread.id, threadName });
  } catch (err) {
    console.error('announce error:', err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

app.get('/health', (req, res) => res.json({ ok: true, user: client.user?.tag }));

app.listen(Number(BOT_HTTP_PORT), '127.0.0.1', () => {
  console.log(`Bot HTTP listening on http://127.0.0.1:${BOT_HTTP_PORT}`);
});
