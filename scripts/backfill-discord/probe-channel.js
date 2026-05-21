// Quick connectivity check: does the configured bot have access to a given
// guild/channel? Reports channel type, thread count, recent message activity.
//
// Usage:  node probe-channel.js <guildId> <channelId>
import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType } from 'discord.js';

const [guildId, channelId] = process.argv.slice(2);
if (!guildId || !channelId) {
  console.error('Usage: node probe-channel.js <guildId> <channelId>');
  process.exit(1);
}

const { DISCORD_TOKEN } = process.env;
if (!DISCORD_TOKEN) { console.error('Missing DISCORD_TOKEN'); process.exit(1); }

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

await client.login(DISCORD_TOKEN);
console.log(`Logged in as ${client.user.tag}.`);

// Guild check
let guild;
try {
  guild = await client.guilds.fetch(guildId);
  console.log(`✓ Guild visible: "${guild.name}" (id=${guild.id})`);
} catch (err) {
  console.error(`✗ Cannot fetch guild ${guildId}: ${err.message}`);
  await client.destroy(); process.exit(1);
}

// Channel check
let channel;
try {
  channel = await client.channels.fetch(channelId);
  const typeName = Object.entries(ChannelType).find(([, v]) => v === channel.type)?.[0] ?? `unknown(${channel.type})`;
  console.log(`✓ Channel visible: "#${channel.name}" (type=${typeName})`);
} catch (err) {
  console.error(`✗ Cannot fetch channel ${channelId}: ${err.message}`);
  await client.destroy(); process.exit(1);
}

// Threads
if (typeof channel.threads?.fetchActive === 'function') {
  try {
    const active = await channel.threads.fetchActive();
    console.log(`✓ Active threads: ${active.threads.size}`);
    for (const t of active.threads.values()) {
      const created = new Date(t.createdTimestamp).toISOString().slice(0, 10);
      console.log(`    • ${created}  "${t.name}"  (id=${t.id})`);
    }
    const archived = await channel.threads.fetchArchived({ type: 'public', limit: 100 });
    console.log(`✓ Archived public threads (first page): ${archived.threads.size}`);
    for (const t of [...archived.threads.values()].slice(0, 5)) {
      const created = new Date(t.createdTimestamp).toISOString().slice(0, 10);
      console.log(`    • ${created}  "${t.name}"  (id=${t.id})`);
    }
  } catch (err) {
    console.error(`✗ Cannot list threads: ${err.message}`);
  }
}

// Recent messages in the channel itself (not threads)
try {
  const recent = await channel.messages.fetch({ limit: 5 });
  console.log(`✓ Recent messages in channel (last 5): ${recent.size}`);
  for (const msg of recent.values()) {
    const author = msg.author?.username ?? '?';
    const when = new Date(msg.createdTimestamp).toISOString();
    const preview = (msg.content || '(no text)').slice(0, 60);
    const att = msg.attachments.size > 0 ? ` [${msg.attachments.size} attachment(s)]` : '';
    console.log(`    • ${when}  ${author}: ${preview}${att}`);
  }
} catch (err) {
  console.error(`✗ Cannot fetch channel messages: ${err.message}`);
}

await client.destroy();
