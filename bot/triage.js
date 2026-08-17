// Pure, side-effect-free helpers for deciding how the bot should react to a
// Discord message. Kept separate from index.js (which wires up Discord, the
// tracker API, and Gemini) so this decision logic can be unit-tested in
// isolation.
//
// PokerNow filename conventions: ledger CSVs start with "ledger_", hand logs
// start with "poker_now_log_". Both are .csv.

// Classify a single Discord attachment by what it means to the bot.
// Returns one of: 'handlog' | 'ledger' | 'image' | 'other'.
export function classifyAttachment(att) {
  const name = att?.name || '';
  const ct = (att?.contentType || '').toLowerCase();
  const isCsv = /\.csv$/i.test(name) || ct.includes('csv');
  if (isCsv && /^poker_now_log_/i.test(name)) return 'handlog';
  if (isCsv) return 'ledger';
  if (ct.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(name)) return 'image';
  return 'other';
}

// Given the set of attachment kinds on a single message, decide what trigger
// (if any) it represents. Returns:
//   'upload'  → a ledger CSV or ledger screenshot: may create a new session
//   'handlog' → only a hand-log CSV: attach to an existing session, never create
//   null      → nothing actionable (plain chatter, links, unrelated files)
//
// A ledger upload takes precedence over a hand log in the same message: the
// session gets imported first, then the hand log is attached.
// Screenshot reading needs a Gemini key. Without one it isn't a degraded
// feature, it's an absent one — so the bot should stop treating images as
// something it can act on rather than failing per-thread on every restart.
export function visionEnabled(env = {}) {
  return Boolean(String(env.GEMINI_API_KEY || '').trim());
}

export function attachmentTrigger(kinds, { vision = true } = {}) {
  const set = Array.isArray(kinds) ? kinds : [];
  const usableImage = vision && set.includes('image');
  if (set.includes('ledger') || usableImage) return 'upload';
  // A hand log still parses locally, so it must not be dropped just because it
  // arrived alongside a screenshot the bot can no longer read.
  if (set.includes('handlog')) return 'handlog';
  return null;
}
