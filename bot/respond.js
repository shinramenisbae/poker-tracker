// Replying to a slash command, safely.
//
// Two ways a reply silently fails, both seen in production:
//
//  1. Discord invalidates an interaction token 3 seconds after the command is
//     invoked (error 10062 "Unknown interaction"). Handlers that fetch from the
//     tracker before their first reply can exceed that — /unpaid pulls the whole
//     session list, which is over a megabyte. The fix is to defer immediately,
//     which buys 15 minutes, and then edit that placeholder.
//
//  2. Session threads auto-archive after a week, and Discord refuses to accept
//     a message into an archived thread (error 50083 "Thread is archived"), so
//     running /paid or /unpaid in an older thread fails outright. Reopening the
//     thread first makes the reply land. The bot already needs Manage Threads
//     for Fix & repost, so this asks for no new permission.
//
// Both surfaced to users as Discord's generic "the application did not respond",
// because the error path replied the same failing way the happy path did.

/**
 * Reopen a thread Discord auto-archived, so a reply can be posted into it.
 *
 * @param {object|null} channel the interaction's channel
 * @returns {Promise<boolean>} true if it was archived and has been reopened
 */
export async function unarchiveIfArchived(channel) {
  if (!channel || !channel.archived) return false;
  // Only threads can be unarchived; anything else is left alone.
  if (typeof channel.setArchived !== 'function') return false;
  await channel.setArchived(false);
  return true;
}

/**
 * Post into a session thread, reopening it first if Discord archived it. The
 * daily payment reminder writes into threads that are by definition ageing —
 * a debt still unpaid after a week sits in a thread that has auto-archived.
 *
 * @param {object} thread
 * @param {object} payload message payload
 */
export async function sendToThread(thread, payload) {
  await unarchiveIfArchived(thread);
  return thread.send(payload);
}

/**
 * Answer an interaction whichever way is currently valid: a fresh reply, or an
 * edit of the deferred placeholder. Lets a handler reply without tracking
 * whether it has already deferred, and lets the error path answer an
 * interaction the happy path had already deferred.
 *
 * @param {object} interaction
 * @param {object} payload message payload
 */
export async function respond(interaction, payload) {
  if (interaction.deferred || interaction.replied) {
    // Ephemeral visibility is fixed when the reply is deferred and cannot be
    // changed by the edit, so drop the flag rather than send it and have
    // Discord reject the payload.
    const { flags, ...rest } = payload;
    return interaction.editReply(rest);
  }
  return interaction.reply(payload);
}
