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
