const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'poker.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      notes TEXT,
      bankPlayerId TEXT,
      gameType TEXT NOT NULL DEFAULT 'in-person',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY,
      sessionId TEXT NOT NULL,
      name TEXT NOT NULL,
      paymentMethod TEXT,
      cashOutAmount REAL,
      cashOutDate TEXT,
      FOREIGN KEY (sessionId) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS buyIns (
      id TEXT PRIMARY KEY,
      playerId TEXT NOT NULL,
      amount REAL NOT NULL,
      timestamp TEXT NOT NULL,
      isRebuy INTEGER DEFAULT 0,
      method TEXT DEFAULT 'cash',
      FOREIGN KEY (playerId) REFERENCES players(id) ON DELETE CASCADE
    )
  `);

  // alias_mappings: crowd-sourced mapping of online ledger aliases to canonical player names
  // (used by the Discord backfill flow — friends help match unknown aliases via the /aliases UI)
  db.run(`
    CREATE TABLE IF NOT EXISTS alias_mappings (
      alias TEXT PRIMARY KEY,
      realName TEXT,
      updatedAt TEXT NOT NULL
    )
  `);

  // hand_logs: one row per session that's had a PokerNow hand log uploaded.
  db.run(`
    CREATE TABLE IF NOT EXISTS hand_logs (
      sessionId TEXT PRIMARY KEY,
      rawLog TEXT NOT NULL,
      parsedAt TEXT NOT NULL,
      totalHands INTEGER NOT NULL,
      eligibleEvHands INTEGER NOT NULL,
      FOREIGN KEY (sessionId) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `);

  // hand_evs: per-player per-hand actual vs expected for charts and leaderboards.
  // playerName stores the raw PokerNow nickname; canonical resolution happens
  // at query time via the alias_mappings table.
  db.run(`
    CREATE TABLE IF NOT EXISTS hand_evs (
      id TEXT PRIMARY KEY,
      sessionId TEXT NOT NULL,
      handNumber INTEGER NOT NULL,
      handIndex INTEGER NOT NULL,
      playerName TEXT NOT NULL,
      actualNet REAL NOT NULL,
      expectedNet REAL NOT NULL,
      isAllInEv INTEGER NOT NULL DEFAULT 0,
      equity REAL,
      gameType TEXT NOT NULL,
      FOREIGN KEY (sessionId) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_hand_evs_session ON hand_evs(sessionId)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_hand_evs_player ON hand_evs(playerName)`);

  // player_session_stats: per-(session, canonical player) counters that feed
  // VPIP / PFR / AF on the player-style scatter chart. Computed from the same
  // hand log that produces hand_evs.
  db.run(`
    CREATE TABLE IF NOT EXISTS player_session_stats (
      id TEXT PRIMARY KEY,
      sessionId TEXT NOT NULL,
      playerName TEXT NOT NULL,
      handsDealt INTEGER NOT NULL DEFAULT 0,
      vpipHands INTEGER NOT NULL DEFAULT 0,
      pfrHands INTEGER NOT NULL DEFAULT 0,
      postflopBets INTEGER NOT NULL DEFAULT 0,
      postflopRaises INTEGER NOT NULL DEFAULT 0,
      postflopCalls INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (sessionId) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_pss_session ON player_session_stats(sessionId)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_pss_player ON player_session_stats(playerName)`);

  // removed_canonicals: canonical player names that were merged into another.
  // The /aliases UI filters seed-derived canonicals through this so merged-away
  // names don't keep reappearing on every page load.
  db.run(`
    CREATE TABLE IF NOT EXISTS removed_canonicals (
      name TEXT PRIMARY KEY,
      mergedInto TEXT,
      removedAt TEXT NOT NULL
    )
  `);

  // Migration: add method column if it doesn't exist (for existing DBs)
  db.run(`ALTER TABLE buyIns ADD COLUMN method TEXT DEFAULT 'cash'`, (err) => {
    // Ignore error if column already exists
  });

  // Migration: add gameType column if it doesn't exist (for existing DBs)
  db.run(`ALTER TABLE sessions ADD COLUMN gameType TEXT NOT NULL DEFAULT 'in-person'`, (err) => {
    // Ignore error if column already exists
  });

  // Migration: add discordThreadId column for clean Discord linkage tracking
  // (was previously embedded in notes, which made session titles ugly).
  db.run(`ALTER TABLE sessions ADD COLUMN discordThreadId TEXT`, (err) => {
    // Ignore error if column already exists
  });
});

module.exports = db;
