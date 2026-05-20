import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, GatewayIntentBits, ChannelType } from 'discord.js';
import { GoogleGenAI, Type } from '@google/genai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const {
  DISCORD_TOKEN,
  DISCORD_CHANNEL_ID,
  TRACKER_API_BASE,
  GEMINI_API_KEY,
  GEMINI_MODEL = 'gemini-2.5-flash',
} = process.env;

for (const [k, v] of Object.entries({ DISCORD_TOKEN, DISCORD_CHANNEL_ID, TRACKER_API_BASE, GEMINI_API_KEY })) {
  if (!v) { console.error(`Missing env var: ${k}`); process.exit(1); }
}

const aliases = JSON.parse(await fs.readFile(path.join(__dirname, 'aliases.json'), 'utf8'));
delete aliases._comment;
const aliasLookup = new Map(Object.entries(aliases).map(([k, v]) => [k.toLowerCase(), v]));

const genai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

const VISION_SYSTEM = `You analyze poker session screenshots and return strict JSON.

Classify the image as one of:
- "online_ledger": white background, header "Session Ledger", columns Player / Buy-In / Buy-Out / Stack / Net.
- "in_person_summary": shows "Session Summary", bank player, Winners/Owes Money, "Who Pays Who".
- "unknown": anything else.

If online_ledger, extract every player row. "name" is the bold player name; "handle" is the lighter text after "@" (may be empty string). buyIn/buyOut/stack/net are numbers — preserve sign on net (negative for losers). Skip any total/footer rows. If not online_ledger, return an empty rows array.`;

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

async function classifyAndExtract(imageBytes, mediaType) {
  const resp = await genai.models.generateContent({
    model: GEMINI_MODEL,
    contents: [{
      role: 'user',
      parts: [
        { inlineData: { mimeType: mediaType, data: imageBytes.toString('base64') } },
        { text: 'Classify and extract per the schema.' },
      ],
    }],
    config: {
      systemInstruction: VISION_SYSTEM,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
    },
  });
  try { return JSON.parse(resp.text); }
  catch { return { type: 'unknown', rows: [], _rawResponse: resp.text }; }
}

async function downloadAttachment(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Discord attachment HTTP ${res.status}`);
  const arrayBuf = await res.arrayBuffer();
  const ct = res.headers.get('content-type') || 'image/png';
  return { bytes: Buffer.from(arrayBuf), mediaType: ct.split(';')[0].trim() };
}

async function fetchTrackerSessions() {
  const res = await fetch(`${TRACKER_API_BASE}/sessions`);
  if (!res.ok) throw new Error(`Tracker GET /sessions HTTP ${res.status}`);
  return res.json();
}

function mapAlias(name) {
  const mapped = aliasLookup.get(name.toLowerCase());
  return mapped && mapped.trim() ? { name: mapped, mapped: true } : { name, mapped: false };
}

function dateFromThread(thread) {
  const ts = thread.createdTimestamp ?? thread.archivedTimestamp ?? Date.now();
  return new Date(ts).toISOString().slice(0, 10);
}

async function collectImageAttachments(thread) {
  const images = [];
  let before;
  while (true) {
    const batch = await thread.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (batch.size === 0) break;
    for (const msg of batch.values()) {
      for (const att of msg.attachments.values()) {
        const ct = (att.contentType || '').toLowerCase();
        if (ct.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(att.name || '')) {
          images.push({ url: att.url, name: att.name, createdAt: msg.createdTimestamp });
        }
      }
    }
    if (batch.size < 100) break;
    before = batch.last().id;
  }
  return images.sort((a, b) => a.createdAt - b.createdAt);
}

async function fetchAllThreads(channel) {
  const all = new Map();
  const active = await channel.threads.fetchActive();
  for (const [id, t] of active.threads) all.set(id, t);
  let before;
  while (true) {
    const archived = await channel.threads.fetchArchived({ type: 'public', limit: 100, ...(before ? { before } : {}) });
    for (const [id, t] of archived.threads) all.set(id, t);
    if (!archived.hasMore || archived.threads.size === 0) break;
    before = archived.threads.last().archivedTimestamp;
  }
  return [...all.values()];
}

function buildDedupKeys(sessions) {
  const byDateCount = new Set();
  const byThreadId = new Set();
  for (const s of sessions) {
    byDateCount.add(`${s.date}|${(s.players || []).length}`);
    const m = (s.notes || '').match(/threadId=(\d+)/);
    if (m) byThreadId.add(m[1]);
  }
  return { byDateCount, byThreadId };
}

async function main() {
  console.log('Fetching existing tracker sessions...');
  const existing = await fetchTrackerSessions();
  const dedup = buildDedupKeys(existing);
  console.log(`  ${existing.length} existing sessions, ${dedup.byThreadId.size} previously imported from Discord.`);

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent, // required to read attachments on messages the bot didn't author
    ],
  });
  await client.login(DISCORD_TOKEN);
  console.log(`Logged in as ${client.user.tag}.`);

  const channel = await client.channels.fetch(DISCORD_CHANNEL_ID);
  if (!channel || channel.type !== ChannelType.GuildText) {
    console.error(`Channel ${DISCORD_CHANNEL_ID} is not a text channel (type=${channel?.type}).`);
    await client.destroy(); process.exit(1);
  }
  console.log(`Channel #${channel.name}. Fetching threads...`);

  const threads = await fetchAllThreads(channel);
  console.log(`  ${threads.length} threads found.`);

  const dryRun = [];
  let idx = 0;
  for (const thread of threads) {
    idx++;
    const date = dateFromThread(thread);
    const entry = {
      threadId: thread.id, threadName: thread.name, date,
      gameType: 'online', players: [], warnings: [], willImport: true,
    };

    if (dedup.byThreadId.has(thread.id)) {
      entry.willImport = false;
      entry.warnings.push('Already imported (threadId match in notes)');
      console.log(`[${idx}/${threads.length}] ${thread.name} (${date}) — skip: already imported`);
      dryRun.push(entry); continue;
    }

    const images = await collectImageAttachments(thread);
    if (images.length === 0) {
      entry.willImport = false;
      entry.warnings.push('No image attachments in thread');
      console.log(`[${idx}/${threads.length}] ${thread.name} (${date}) — skip: no images`);
      dryRun.push(entry); continue;
    }

    const onlineRows = [];
    let sawInPerson = false;
    for (const img of images) {
      const { bytes, mediaType } = await downloadAttachment(img.url);
      const result = await classifyAndExtract(bytes, mediaType);
      if (result.type === 'online_ledger') onlineRows.push(...(result.rows || []));
      else if (result.type === 'in_person_summary') sawInPerson = true;
    }

    if (onlineRows.length === 0) {
      entry.willImport = false;
      entry.warnings.push(sawInPerson ? 'In-person screenshot only (already in tracker)' : 'No online ledger detected');
      console.log(`[${idx}/${threads.length}] ${thread.name} (${date}) — skip: ${entry.warnings.at(-1)}`);
      dryRun.push(entry); continue;
    }

    for (const row of onlineRows) {
      const { name: mappedName, mapped } = mapAlias(row.name);
      if (!mapped) entry.warnings.push(`Unmapped alias: "${row.name}" (added to aliases.json with empty value will block import)`);
      const buyIn = Number(row.buyIn) || 0;
      const cashOut = (Number(row.buyOut) || 0) + (Number(row.stack) || 0);
      const expectedNet = cashOut - buyIn;
      const reportedNet = Number(row.net) || 0;
      if (Math.abs(expectedNet - reportedNet) > 0.02) {
        entry.warnings.push(`Net mismatch for ${row.name}: buyIn=${buyIn}, cashOut=${cashOut}, reportedNet=${reportedNet}`);
      }
      entry.players.push({
        name: mappedName, originalAlias: row.name, handle: row.handle || '',
        buyIn, cashOutAmount: cashOut, paymentMethod: 'cash',
      });
    }

    if (dedup.byDateCount.has(`${date}|${entry.players.length}`)) {
      entry.willImport = false;
      entry.warnings.push(`Possible duplicate: an existing session on ${date} has ${entry.players.length} players. Confirm before importing.`);
    }

    if (entry.warnings.some((w) => w.startsWith('Unmapped alias'))) {
      entry.willImport = false;
    }

    console.log(`[${idx}/${threads.length}] ${thread.name} (${date}) — ${entry.players.length} players${entry.warnings.length ? ` [${entry.warnings.length} warnings]` : ''}`);
    dryRun.push(entry);
  }

  const outPath = path.join(__dirname, 'dry-run.json');
  await fs.writeFile(outPath, JSON.stringify(dryRun, null, 2));
  console.log(`\nWrote ${dryRun.length} entries to ${outPath}`);
  const willImport = dryRun.filter((e) => e.willImport).length;
  console.log(`${willImport} will import, ${dryRun.length - willImport} will not.`);

  await client.destroy();
}

main().catch((err) => { console.error(err); process.exit(1); });
