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

  // Migration: add method column if it doesn't exist (for existing DBs)
  db.run(`ALTER TABLE buyIns ADD COLUMN method TEXT DEFAULT 'cash'`, (err) => {
    // Ignore error if column already exists
  });
});

module.exports = db;
