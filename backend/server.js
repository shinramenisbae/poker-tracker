const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = 5001;

// --- Alias seeding (one-shot on first start of an empty table) ---
const ALIAS_SEED_PATH = path.join(__dirname, 'aliases-seed.json');
let aliasSeed = { aliases: [], canonical_players: [], initial_mappings: {} };
try {
  aliasSeed = JSON.parse(fs.readFileSync(ALIAS_SEED_PATH, 'utf8'));
} catch (err) {
  console.warn(`Could not read aliases-seed.json (${err.message}); /api/alias-mappings will return empty.`);
}
db.get('SELECT COUNT(*) AS n FROM alias_mappings', [], (err, row) => {
  if (err || !row || row.n > 0) return;
  const now = new Date().toISOString();
  const stmt = db.prepare('INSERT OR IGNORE INTO alias_mappings (alias, realName, updatedAt) VALUES (?, ?, ?)');
  for (const alias of aliasSeed.aliases) {
    stmt.run(alias, aliasSeed.initial_mappings[alias] || null, now);
  }
  stmt.finalize(() => console.log(`Seeded ${aliasSeed.aliases.length} alias_mappings rows.`));
});

// --- Google Sheets Import Helpers ---

const SPREADSHEET_ID = '1VVZK9tWGzozn0nIvQxm4ssEV0ijID5ATGqUdfdbM7Sc';

function parseCSV(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim().toLowerCase());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = [];
    let current = '';
    let inQuotes = false;

    for (const char of lines[i]) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim());

    const row = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] || '';
    });
    rows.push(row);
  }
  return rows;
}

function parseDateTab(tabName) {
  // Unescape \x5b / \x5d ([ and ]) from JS strings
  const cleaned = tabName.replace(/\\x5b/g, '[').replace(/\\x5d/g, ']');
  // Strip suffixes like " [2]" or variant prefixes like "15v2" -> "15"
  const stripped = cleaned.replace(/\s*\[.*\]$/, '').replace(/v\d+/, '');
  // Parse DD/MM/YY or DD/MM/YYYY format to YYYY-MM-DD
  const match = stripped.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!match) return null;

  let [, day, month, year] = match;
  if (year.length === 2) {
    year = '20' + year;
  }
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

async function fetchText(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.text();
}

async function discoverSheetTabs() {
  const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/htmlview`;
  const html = await fetchText(url);

  // Extract tab names from items.push({name: "...", gid: "..."}) in the page JS
  const tabNames = [];
  const regex = /items\.push\(\{name:\s*"([^"]*)"[^}]*gid:\s*"(\d+)"/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    // Unescape forward slashes from JS string
    const name = match[1].replace(/\\\//g, '/');
    tabNames.push({ gid: match[2], name });
  }
  return tabNames;
}

async function fetchSheetCSV(sheetName) {
  const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
  const text = await fetchText(url);
  return parseCSV(text);
}

app.use(cors({
  origin: [
    'https://srv1346724.hstgr.cloud',
    'http://76.13.182.206:5000',
  ],
  credentials: true
}));

// Bumped from default 100KB to 20MB so we can ingest PokerNow hand logs
// (a busy session can be a few MB of CSV text).
app.use(express.json({ limit: '20mb' }));

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// GET /api/sessions - List all sessions with players and buy-ins
app.get('/api/sessions', (req, res) => {
  db.all('SELECT * FROM sessions ORDER BY date DESC', [], (err, sessions) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    if (sessions.length === 0) {
      return res.json([]);
    }

    let completedSessions = 0;
    const results = new Array(sessions.length);

    sessions.forEach((session, sIndex) => {
      db.all('SELECT * FROM players WHERE sessionId = ?', [session.id], (err, players) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }

        if (!players || players.length === 0) {
          results[sIndex] = { ...session, players: [] };
          completedSessions++;
          if (completedSessions === sessions.length) {
            res.json(results);
          }
          return;
        }

        let completedPlayers = 0;
        const playersWithBuyIns = new Array(players.length);

        players.forEach((player, pIndex) => {
          db.all('SELECT * FROM buyIns WHERE playerId = ? ORDER BY timestamp', [player.id], (err, buyIns) => {
            if (err) {
              return res.status(500).json({ error: err.message });
            }
            playersWithBuyIns[pIndex] = {
              ...player,
              buyIns: buyIns || [],
              cashOut: player.cashOutAmount != null
                ? { amount: player.cashOutAmount, timestamp: new Date(player.cashOutDate).getTime() }
                : null,
            };
            completedPlayers++;

            if (completedPlayers === players.length) {
              results[sIndex] = { ...session, players: playersWithBuyIns };
              completedSessions++;
              if (completedSessions === sessions.length) {
                res.json(results);
              }
            }
          });
        });
      });
    });
  });
});

// GET /api/sessions/:id - Get session with players
app.get('/api/sessions/:id', (req, res) => {
  const sessionId = req.params.id;
  
  db.get('SELECT * FROM sessions WHERE id = ?', [sessionId], (err, session) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    db.all('SELECT * FROM players WHERE sessionId = ?', [sessionId], (err, players) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      if (players.length === 0) {
        return res.json({ ...session, players: [] });
      }

      let completedPlayers = 0;
      const playersWithBuyIns = [];

      players.forEach((player, index) => {
        db.all('SELECT * FROM buyIns WHERE playerId = ? ORDER BY timestamp', [player.id], (err, buyIns) => {
          if (err) {
            return res.status(500).json({ error: err.message });
          }
          playersWithBuyIns[index] = {
            ...player,
            buyIns: buyIns || [],
            cashOut: player.cashOutAmount != null
              ? { amount: player.cashOutAmount, timestamp: new Date(player.cashOutDate).getTime() }
              : null,
          };
          completedPlayers++;

          if (completedPlayers === players.length) {
            res.json({ ...session, players: playersWithBuyIns });
          }
        });
      });
    });
  });
});

// POST /api/sessions - Create new session
app.post('/api/sessions', (req, res) => {
  const { date, notes, players, gameType, status, discordThreadId } = req.body;
  const id = generateId();
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO sessions (id, date, status, notes, gameType, discordThreadId, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(id, date || now.split('T')[0], status || 'active', notes || '', gameType || 'in-person', discordThreadId || null, now, now, function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    // If players are provided, insert them
    if (players && players.length > 0) {
      let completedPlayers = 0;
      const playerResults = [];

      players.forEach((player) => {
        const playerStmt = db.prepare(`
          INSERT INTO players (id, sessionId, name, paymentMethod, cashOutAmount, cashOutDate)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        
        // Use ?? (not ||) so a real $0 cash-out is stored as 0, not dropped to
        // null. Online imports (bot) send cashOut.amount = 0 for players who
        // busted/cashed nothing; with || those rows looked like "never cashed
        // out", leaving the session unfinishable on the Results page.
        const cashOutAmount = player.cashOut?.amount ?? null;
        const cashOutDate = player.cashOut
          ? new Date(player.cashOut.timestamp ?? Date.now()).toISOString()
          : null;
        
        playerStmt.run(
          player.id,
          id,
          player.name,
          player.paymentMethod || 'cash',
          cashOutAmount,
          cashOutDate,
          function(err) {
            if (err) {
              console.error('Error inserting player:', err);
            }
            playerResults.push({
              ...player,
              buyIns: [],
              cashOut: player.cashOut || null
            });
            completedPlayers++;
            
            if (completedPlayers === players.length) {
              db.get('SELECT * FROM sessions WHERE id = ?', [id], (err, session) => {
                if (err) {
                  return res.status(500).json({ error: err.message });
                }
                res.status(201).json({ ...session, players: playerResults });
              });
            }
          }
        );
        playerStmt.finalize();
      });
    } else {
      db.get('SELECT * FROM sessions WHERE id = ?', [id], (err, session) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        res.status(201).json({ ...session, players: [] });
      });
    }
  });
  stmt.finalize();
});

// PUT /api/sessions/:id - Update session
app.put('/api/sessions/:id', (req, res) => {
  const sessionId = req.params.id;
  const { date, status, notes, bankPlayerId, gameType, discordThreadId } = req.body;
  const now = new Date().toISOString();

  db.get('SELECT * FROM sessions WHERE id = ?', [sessionId], (err, existing) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!existing) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const stmt = db.prepare(`
      UPDATE sessions
      SET date = ?, status = ?, notes = ?, bankPlayerId = ?, gameType = ?, discordThreadId = ?, updatedAt = ?
      WHERE id = ?
    `);

    stmt.run(
      date || existing.date,
      status || existing.status,
      notes !== undefined ? notes : existing.notes,
      bankPlayerId !== undefined ? bankPlayerId : existing.bankPlayerId,
      gameType || existing.gameType,
      discordThreadId !== undefined ? discordThreadId : existing.discordThreadId,
      now,
      sessionId,
      function(err) {
        if (err) {
          return res.status(500).json({ error: err.message });
        }

        db.get('SELECT * FROM sessions WHERE id = ?', [sessionId], (err, session) => {
          if (err) {
            return res.status(500).json({ error: err.message });
          }

          db.all('SELECT * FROM players WHERE sessionId = ?', [sessionId], (err, players) => {
            if (err) {
              return res.status(500).json({ error: err.message });
            }

            if (!players || players.length === 0) {
              return res.json({ ...session, players: [] });
            }

            let completedPlayers = 0;
            const playersWithBuyIns = new Array(players.length);

            players.forEach((player, index) => {
              db.all('SELECT * FROM buyIns WHERE playerId = ? ORDER BY timestamp', [player.id], (err, buyIns) => {
                if (err) {
                  return res.status(500).json({ error: err.message });
                }
                playersWithBuyIns[index] = {
                  ...player,
                  buyIns: buyIns || [],
                  cashOut: player.cashOutAmount != null
                    ? { amount: player.cashOutAmount, timestamp: new Date(player.cashOutDate).getTime() }
                    : null,
                };
                completedPlayers++;

                if (completedPlayers === players.length) {
                  res.json({ ...session, players: playersWithBuyIns });
                }
              });
            });
          });
        });
      }
    );
    stmt.finalize();
  });
});

// DELETE /api/sessions/:id - Delete session
app.delete('/api/sessions/:id', (req, res) => {
  const sessionId = req.params.id;

  db.get('SELECT * FROM sessions WHERE id = ?', [sessionId], (err, existing) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!existing) {
      return res.status(404).json({ error: 'Session not found' });
    }

    db.run('DELETE FROM sessions WHERE id = ?', [sessionId], function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.status(204).send();
    });
  });
});

// POST /api/sessions/:id/players - Add player
app.post('/api/sessions/:id/players', (req, res) => {
  const sessionId = req.params.id;
  const { name, paymentMethod } = req.body;
  
  db.get('SELECT * FROM sessions WHERE id = ?', [sessionId], (err, session) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const id = generateId();

    const stmt = db.prepare(`
      INSERT INTO players (id, sessionId, name, paymentMethod)
      VALUES (?, ?, ?, ?)
    `);
    
    stmt.run(id, sessionId, name, paymentMethod || '', function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      stmt.finalize();

      // Return full updated session (consistent with other endpoints)
      db.get('SELECT * FROM sessions WHERE id = ?', [sessionId], (err, session) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }

        db.all('SELECT * FROM players WHERE sessionId = ?', [sessionId], (err, players) => {
          if (err) {
            return res.status(500).json({ error: err.message });
          }

          if (!players || players.length === 0) {
            return res.status(201).json({ ...session, players: [] });
          }

          let completedPlayers = 0;
          const playersWithBuyIns = new Array(players.length);

          players.forEach((p, index) => {
            db.all('SELECT * FROM buyIns WHERE playerId = ? ORDER BY timestamp', [p.id], (err, buyIns) => {
              if (err) {
                return res.status(500).json({ error: err.message });
              }
              playersWithBuyIns[index] = {
                ...p,
                buyIns: buyIns || [],
                cashOut: p.cashOutAmount != null
                  ? { amount: p.cashOutAmount, timestamp: new Date(p.cashOutDate).getTime() }
                  : null,
              };
              completedPlayers++;

              if (completedPlayers === players.length) {
                res.status(201).json({ ...session, players: playersWithBuyIns });
              }
            });
          });
        });
      });
    });
  });
});

// POST /api/sessions/:id/players/:playerId/buyins - Add buy-in
app.post('/api/sessions/:id/players/:playerId/buyins', (req, res) => {
  const sessionId = req.params.id;
  const playerId = req.params.playerId;
  const { amount, isRebuy, method } = req.body;

  db.get('SELECT * FROM players WHERE id = ?', [playerId], (err, player) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!player) {
      return res.status(404).json({ error: 'Player not found' });
    }

    const id = generateId();
    const now = new Date().toISOString();

    const stmt = db.prepare(`
      INSERT INTO buyIns (id, playerId, amount, timestamp, isRebuy, method)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(id, playerId, amount, now, isRebuy ? 1 : 0, method || 'cash', function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      stmt.finalize();
      
      // Return full updated session
      db.get('SELECT * FROM sessions WHERE id = ?', [sessionId], (err, session) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }

        db.all('SELECT * FROM players WHERE sessionId = ?', [sessionId], (err, players) => {
          if (err) {
            return res.status(500).json({ error: err.message });
          }

          if (!players || players.length === 0) {
            return res.json({ ...session, players: [] });
          }

          let completedPlayers = 0;
          const playersWithBuyIns = new Array(players.length);

          players.forEach((p, index) => {
            db.all('SELECT * FROM buyIns WHERE playerId = ? ORDER BY timestamp', [p.id], (err, buyIns) => {
              if (err) {
                return res.status(500).json({ error: err.message });
              }
              playersWithBuyIns[index] = {
                ...p,
                buyIns: buyIns || [],
                cashOut: p.cashOutAmount != null
                  ? { amount: p.cashOutAmount, timestamp: new Date(p.cashOutDate).getTime() }
                  : null,
              };
              completedPlayers++;

              if (completedPlayers === players.length) {
                res.status(201).json({ ...session, players: playersWithBuyIns });
              }
            });
          });
        });
      });
    });
  });
});

// PUT /api/sessions/:id/players/:playerId/buyins/:buyInId - Update a buy-in
app.put('/api/sessions/:id/players/:playerId/buyins/:buyInId', (req, res) => {
  const sessionId = req.params.id;
  const playerId = req.params.playerId;
  const buyInId = req.params.buyInId;
  const { amount, method } = req.body;

  db.get('SELECT * FROM buyIns WHERE id = ? AND playerId = ?', [buyInId, playerId], (err, buyIn) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!buyIn) {
      return res.status(404).json({ error: 'Buy-in not found' });
    }

    const stmt = db.prepare(`
      UPDATE buyIns SET amount = ?, method = ? WHERE id = ?
    `);

    stmt.run(
      amount !== undefined ? amount : buyIn.amount,
      method !== undefined ? method : buyIn.method,
      buyInId,
      function(err) {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        stmt.finalize();

        // Return full updated session
        db.get('SELECT * FROM sessions WHERE id = ?', [sessionId], (err, session) => {
          if (err) return res.status(500).json({ error: err.message });

          db.all('SELECT * FROM players WHERE sessionId = ?', [sessionId], (err, players) => {
            if (err) return res.status(500).json({ error: err.message });

            if (!players || players.length === 0) {
              return res.json({ ...session, players: [] });
            }

            let completedPlayers = 0;
            const playersWithBuyIns = new Array(players.length);

            players.forEach((p, index) => {
              db.all('SELECT * FROM buyIns WHERE playerId = ? ORDER BY timestamp', [p.id], (err, buyIns) => {
                if (err) return res.status(500).json({ error: err.message });
                playersWithBuyIns[index] = {
                  ...p,
                  buyIns: buyIns || [],
                  cashOut: p.cashOutAmount != null
                    ? { amount: p.cashOutAmount, timestamp: new Date(p.cashOutDate).getTime() }
                    : null,
                };
                completedPlayers++;
                if (completedPlayers === players.length) {
                  res.json({ ...session, players: playersWithBuyIns });
                }
              });
            });
          });
        });
      }
    );
  });
});

// DELETE /api/sessions/:id/players/:playerId/buyins/:buyInId - Delete a buy-in
app.delete('/api/sessions/:id/players/:playerId/buyins/:buyInId', (req, res) => {
  const sessionId = req.params.id;
  const playerId = req.params.playerId;
  const buyInId = req.params.buyInId;

  db.get('SELECT * FROM buyIns WHERE id = ? AND playerId = ?', [buyInId, playerId], (err, buyIn) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!buyIn) {
      return res.status(404).json({ error: 'Buy-in not found' });
    }

    db.run('DELETE FROM buyIns WHERE id = ?', [buyInId], function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      // Return full updated session
      db.get('SELECT * FROM sessions WHERE id = ?', [sessionId], (err, session) => {
        if (err) return res.status(500).json({ error: err.message });

        db.all('SELECT * FROM players WHERE sessionId = ?', [sessionId], (err, players) => {
          if (err) return res.status(500).json({ error: err.message });

          if (!players || players.length === 0) {
            return res.json({ ...session, players: [] });
          }

          let completedPlayers = 0;
          const playersWithBuyIns = new Array(players.length);

          players.forEach((p, index) => {
            db.all('SELECT * FROM buyIns WHERE playerId = ? ORDER BY timestamp', [p.id], (err, buyIns) => {
              if (err) return res.status(500).json({ error: err.message });
              playersWithBuyIns[index] = {
                ...p,
                buyIns: buyIns || [],
                cashOut: p.cashOutAmount != null
                  ? { amount: p.cashOutAmount, timestamp: new Date(p.cashOutDate).getTime() }
                  : null,
              };
              completedPlayers++;
              if (completedPlayers === players.length) {
                res.json({ ...session, players: playersWithBuyIns });
              }
            });
          });
        });
      });
    });
  });
});

// PUT /api/sessions/:id/players/:playerId/cashout - Cash out player
app.put('/api/sessions/:id/players/:playerId/cashout', (req, res) => {
  const sessionId = req.params.id;
  const playerId = req.params.playerId;
  const { amount } = req.body;
  const now = new Date().toISOString();

  db.get('SELECT * FROM players WHERE id = ?', [playerId], (err, player) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!player) {
      return res.status(404).json({ error: 'Player not found' });
    }

    const stmt = db.prepare(`
      UPDATE players 
      SET cashOutAmount = ?, cashOutDate = ?
      WHERE id = ?
    `);
    
    stmt.run(amount, now, playerId, function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      stmt.finalize();
      
      // Return full updated session
      db.get('SELECT * FROM sessions WHERE id = ?', [sessionId], (err, session) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }

        db.all('SELECT * FROM players WHERE sessionId = ?', [sessionId], (err, players) => {
          if (err) {
            return res.status(500).json({ error: err.message });
          }

          if (!players || players.length === 0) {
            return res.json({ ...session, players: [] });
          }

          let completedPlayers = 0;
          const playersWithBuyIns = new Array(players.length);

          players.forEach((p, index) => {
            db.all('SELECT * FROM buyIns WHERE playerId = ? ORDER BY timestamp', [p.id], (err, buyIns) => {
              if (err) {
                return res.status(500).json({ error: err.message });
              }
              playersWithBuyIns[index] = {
                ...p,
                buyIns: buyIns || [],
                cashOut: p.cashOutAmount != null
                  ? { amount: p.cashOutAmount, timestamp: new Date(p.cashOutDate).getTime() }
                  : null,
              };
              completedPlayers++;

              if (completedPlayers === players.length) {
                res.json({ ...session, players: playersWithBuyIns });
              }
            });
          });
        });
      });
    });
  });
});

// POST /api/import/spreadsheet - Import sessions from Google Sheets
app.post('/api/import/spreadsheet', async (req, res) => {
  try {
    // Step 1: Discover all sheet tabs
    const tabs = await discoverSheetTabs();
    const dateTabs = tabs
      .map(t => ({ ...t, date: parseDateTab(t.name) }))
      .filter(t => t.date !== null);

    if (dateTabs.length === 0) {
      return res.status(400).json({ error: 'No session tabs found in spreadsheet' });
    }

    // Check for already-imported sessions to avoid duplicates (match by tab name in notes)
    const existingNotes = await new Promise((resolve, reject) => {
      db.all("SELECT notes FROM sessions WHERE notes LIKE '%Imported from spreadsheet%'", [], (err, rows) => {
        if (err) reject(err);
        else resolve(new Set(rows.map(r => r.notes)));
      });
    });

    const newTabs = dateTabs.filter(t => !existingNotes.has(`Imported from spreadsheet (${t.name})`));

    if (newTabs.length === 0) {
      return res.json({ imported: 0, skipped: dateTabs.length, message: 'All sessions already imported' });
    }

    // Step 2: Fetch and import each session tab (in batches of 5 for speed)
    let imported = 0;
    let skipped = dateTabs.length - newTabs.length;
    const errors = [];

    const batchSize = 5;
    for (let i = 0; i < newTabs.length; i += batchSize) {
      const batch = newTabs.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map(async (tab) => {
          const rows = await fetchSheetCSV(tab.name);

          // Filter out empty/totals rows (name is empty or a totals row)
          const playerRows = rows.filter(r => {
            const name = r.name || r[''] || '';
            return name && name.trim() !== '';
          });

          if (playerRows.length === 0) return null;

          // Create session in DB
          const sessionId = generateId();
          const now = new Date().toISOString();

          await new Promise((resolve, reject) => {
            db.run(
              `INSERT INTO sessions (id, date, status, notes, createdAt, updatedAt) VALUES (?, ?, 'completed', ?, ?, ?)`,
              [sessionId, tab.date, `Imported from spreadsheet (${tab.name})`, now, now],
              (err) => err ? reject(err) : resolve()
            );
          });

          // Insert players with buy-ins and cash-outs
          for (const row of playerRows) {
            const name = (row.name || '').trim();
            if (!name) continue;

            const buyIn = parseFloat(row['buy in'] || row['total buy in'] || '0');
            const cashOutVal = parseFloat(row['cash out'] || row['cashout'] || row['total cashout'] || '0');

            if (isNaN(buyIn) && isNaN(cashOutVal)) continue;

            const playerId = generateId();
            const cashOutAmount = isNaN(cashOutVal) ? 0 : cashOutVal;
            const buyInAmount = isNaN(buyIn) ? 0 : buyIn;

            await new Promise((resolve, reject) => {
              db.run(
                `INSERT INTO players (id, sessionId, name, paymentMethod, cashOutAmount, cashOutDate) VALUES (?, ?, ?, 'cash', ?, ?)`,
                [playerId, sessionId, name, cashOutAmount, now],
                (err) => err ? reject(err) : resolve()
              );
            });

            if (buyInAmount > 0) {
              const buyInId = generateId();
              await new Promise((resolve, reject) => {
                db.run(
                  `INSERT INTO buyIns (id, playerId, amount, timestamp, isRebuy, method) VALUES (?, ?, ?, ?, 0, 'cash')`,
                  [buyInId, playerId, buyInAmount, now],
                  (err) => err ? reject(err) : resolve()
                );
              });
            }
          }

          return tab.name;
        })
      );

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          imported++;
        } else if (result.status === 'rejected') {
          errors.push(result.reason?.message || 'Unknown error');
        }
      }
    }

    res.json({
      imported,
      skipped,
      total: dateTabs.length,
      errors: errors.length > 0 ? errors.slice(0, 5) : undefined,
      message: `Successfully imported ${imported} sessions` + (skipped > 0 ? ` (${skipped} already existed)` : ''),
    });
  } catch (err) {
    console.error('Import error:', err);
    res.status(500).json({ error: err.message || 'Import failed' });
  }
});

// DELETE /api/import/spreadsheet - Remove all imported sessions
app.delete('/api/import/spreadsheet', (req, res) => {
  db.run("DELETE FROM sessions WHERE notes LIKE '%Imported from spreadsheet%'", function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ deleted: this.changes, message: `Removed ${this.changes} imported sessions` });
  });
});

// --- Alias mappings API (for the /aliases crowd-sourcing UI) ---

// GET /api/alias-mappings — returns everything the UI needs in one call
app.get('/api/alias-mappings', (req, res) => {
  db.all('SELECT alias, realName FROM alias_mappings ORDER BY alias COLLATE NOCASE', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    db.all('SELECT name FROM removed_canonicals', [], (err2, removedRows) => {
      if (err2) return res.status(500).json({ error: err2.message });
      db.all('SELECT DISTINCT name FROM players WHERE name IS NOT NULL AND name != ""', [], (err3, sessionPlayerRows) => {
        if (err3) return res.status(500).json({ error: err3.message });

        // Names currently used as the target of any mapping — always visible.
        const activeRealNames = new Set();
        for (const r of rows) {
          if (r.realName && r.realName.trim()) activeRealNames.add(r.realName.trim());
        }
        const removed = new Set(removedRows.map((r) => r.name));

        const canonical = new Set();
        // Seed canonicals (minus merged-away)
        for (const c of (aliasSeed.canonical_players || [])) {
          if (!removed.has(c)) canonical.add(c);
        }
        // Any name that's the target of an alias (always)
        for (const n of activeRealNames) canonical.add(n);
        // Any name that appears as a session player (minus merged-away).
        // Without this the /aliases page would hide hand-typed names from
        // in-person sessions that were never aliased, so the user couldn't
        // merge them.
        for (const r of sessionPlayerRows) {
          if (!removed.has(r.name)) canonical.add(r.name);
        }

        res.json({
          aliases: rows.map((r) => ({ alias: r.alias, realName: r.realName || null })),
          canonicalPlayers: [...canonical].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })),
        });
      });
    });
  });
});

// PUT /api/alias-mappings/:alias — upsert the mapping for one alias
//   body: { realName: string | null }  (empty string or null clears the mapping)
//   Inserts the row if it doesn't exist (so the bot can register new aliases
//   it encounters live and have them appear in the /aliases UI for friends).
app.put('/api/alias-mappings/:alias', (req, res) => {
  const alias = req.params.alias;
  const realName = (req.body.realName || '').trim() || null;
  const now = new Date().toISOString();

  db.run(
    `INSERT INTO alias_mappings (alias, realName, updatedAt) VALUES (?, ?, ?)
     ON CONFLICT(alias) DO UPDATE SET realName = excluded.realName, updatedAt = excluded.updatedAt`,
    [alias, realName, now],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ alias, realName });
    }
  );
});

// --- Bank accounts API ---
// Player bank details for the bot's Discord settlement messages. Keyed by
// canonical player name (exact match, same as the bot's lookup).

// GET /api/bank-accounts → { accounts: { "<name>": { displayName, account } } }
app.get('/api/bank-accounts', (req, res) => {
  db.all('SELECT name, displayName, account FROM bank_accounts', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const accounts = {};
    for (const r of rows) {
      accounts[r.name] = { displayName: r.displayName || '', account: r.account || '' };
    }
    res.json({ accounts });
  });
});

// PUT /api/bank-accounts/:name — upsert { displayName, account }
app.put('/api/bank-accounts/:name', (req, res) => {
  const name = (req.params.name || '').trim();
  const displayName = ((req.body && req.body.displayName) || '').trim();
  const account = ((req.body && req.body.account) || '').trim();
  if (!name) return res.status(400).json({ error: 'name required' });
  if (!displayName && !account) {
    return res.status(400).json({ error: 'Provide displayName and/or account, or use DELETE to clear.' });
  }
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO bank_accounts (name, displayName, account, updatedAt) VALUES (?, ?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET displayName = excluded.displayName, account = excluded.account, updatedAt = excluded.updatedAt`,
    [name, displayName, account, now],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ name, displayName, account });
    }
  );
});

// DELETE /api/bank-accounts/:name — remove a player's bank details
app.delete('/api/bank-accounts/:name', (req, res) => {
  const name = (req.params.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name required' });
  db.run('DELETE FROM bank_accounts WHERE name = ?', [name], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ ok: true, name, deleted: this.changes });
  });
});

// --- Discord user ↔ player links ---
// Lets the bot resolve a Discord user to a canonical player (for /paid) and
// @mention the right user in reminders.

// GET /api/discord-links → { links: { "<discordUserId>": "<playerName>" } }
app.get('/api/discord-links', (req, res) => {
  db.all('SELECT discordUserId, playerName FROM discord_links', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const links = {};
    for (const r of rows) links[r.discordUserId] = r.playerName;
    res.json({ links });
  });
});

// PUT /api/discord-links/:discordUserId  body: { playerName }
app.put('/api/discord-links/:discordUserId', (req, res) => {
  const discordUserId = (req.params.discordUserId || '').trim();
  const playerName = ((req.body && req.body.playerName) || '').trim();
  if (!discordUserId || !playerName) return res.status(400).json({ error: 'discordUserId and playerName required' });
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO discord_links (discordUserId, playerName, updatedAt) VALUES (?, ?, ?)
     ON CONFLICT(discordUserId) DO UPDATE SET playerName = excluded.playerName, updatedAt = excluded.updatedAt`,
    [discordUserId, playerName, now],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ discordUserId, playerName });
    }
  );
});

// DELETE /api/discord-links/:discordUserId
app.delete('/api/discord-links/:discordUserId', (req, res) => {
  const discordUserId = (req.params.discordUserId || '').trim();
  if (!discordUserId) return res.status(400).json({ error: 'discordUserId required' });
  db.run('DELETE FROM discord_links WHERE discordUserId = ?', [discordUserId], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ ok: true, discordUserId, deleted: this.changes });
  });
});

// --- Session payment tracking (/paid) ---

// GET /api/sessions/:id/payments → { paid: { "<playerName>": { paidAt, paidBy } } }
app.get('/api/sessions/:id/payments', (req, res) => {
  db.all(
    'SELECT playerName, paidAt, paidBy FROM session_payments WHERE sessionId = ?',
    [req.params.id],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      const paid = {};
      for (const r of rows) paid[r.playerName] = { paidAt: r.paidAt, paidBy: r.paidBy };
      res.json({ paid });
    }
  );
});

// PUT /api/sessions/:id/payments/:playerName  body: { paidBy? }  → mark paid
app.put('/api/sessions/:id/payments/:playerName', (req, res) => {
  const sessionId = req.params.id;
  const playerName = (req.params.playerName || '').trim();
  const paidBy = ((req.body && req.body.paidBy) || '').trim() || null;
  if (!playerName) return res.status(400).json({ error: 'playerName required' });
  db.get('SELECT id FROM sessions WHERE id = ?', [sessionId], (err, sess) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!sess) return res.status(404).json({ error: 'Session not found' });
    const now = new Date().toISOString();
    db.run(
      `INSERT INTO session_payments (sessionId, playerName, paidAt, paidBy) VALUES (?, ?, ?, ?)
       ON CONFLICT(sessionId, playerName) DO UPDATE SET paidAt = excluded.paidAt, paidBy = excluded.paidBy`,
      [sessionId, playerName, now, paidBy],
      function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ ok: true, sessionId, playerName, paidAt: now, paidBy });
      }
    );
  });
});

// DELETE /api/sessions/:id/payments/:playerName  → mark unpaid again
app.delete('/api/sessions/:id/payments/:playerName', (req, res) => {
  const sessionId = req.params.id;
  const playerName = (req.params.playerName || '').trim();
  if (!playerName) return res.status(400).json({ error: 'playerName required' });
  db.run(
    'DELETE FROM session_payments WHERE sessionId = ? AND playerName = ?',
    [sessionId, playerName],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ ok: true, sessionId, playerName, deleted: this.changes });
    }
  );
});

// --- Hand log / all-in EV API ---

const { computeSessionEv } = require('./handlog/ev');
const { parseHandLog } = require('./handlog/parse');
const { computeStatsFromHands, derive: deriveStats } = require('./handlog/stats');

// Same normalization the bot uses so we collapse OCR / emoji variance.
function normalizeAliasKey(s) {
  return (s || '').toLowerCase().replace(/[^\w\s\-'.]/g, '').replace(/\s+/g, ' ').trim();
}
// Strip "name @ player_id" → just "name".
function stripPlayerId(rawKey) {
  const at = rawKey.lastIndexOf(' @ ');
  return at >= 0 ? rawKey.slice(0, at) : rawKey;
}

function loadAliasCanonicalMap() {
  return new Promise((resolve, reject) => {
    db.all('SELECT alias, realName FROM alias_mappings', [], (err, rows) => {
      if (err) return reject(err);
      const map = new Map();
      for (const r of rows) {
        if (r.realName && r.realName.trim()) map.set(normalizeAliasKey(r.alias), r.realName.trim());
      }
      resolve(map);
    });
  });
}

function canonicalNameOf(rawPlayerKey, aliasMap) {
  const nick = stripPlayerId(rawPlayerKey);
  return aliasMap.get(normalizeAliasKey(nick)) || nick;
}

// POST /api/sessions/:id/handlog — body: { rawLog: string }
// Parses, computes EV, stores. Wipes prior hand_evs for this session first.
app.post('/api/sessions/:id/handlog', async (req, res) => {
  const sessionId = req.params.id;
  const rawLog = req.body && req.body.rawLog;
  if (!rawLog || typeof rawLog !== 'string') return res.status(400).json({ error: 'rawLog (string) required in body' });

  db.get('SELECT id FROM sessions WHERE id = ?', [sessionId], async (err, sess) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!sess) return res.status(404).json({ error: 'Session not found' });

    let result;
    try {
      result = computeSessionEv(rawLog, { samples: 8000 });
    } catch (parseErr) {
      return res.status(400).json({ error: `Parse/compute failed: ${parseErr.message}` });
    }

    const aliasMap = await loadAliasCanonicalMap();
    const now = new Date().toISOString();
    const eligibleCount = result.hands.filter((h) => h.hasAllInEv).length;

    // Also compute style stats from the same parsed hands
    let styleStatsByRaw;
    try {
      const parsedHands = parseHandLog(rawLog);
      styleStatsByRaw = computeStatsFromHands(parsedHands);
    } catch (e) {
      styleStatsByRaw = {};
    }

    db.serialize(() => {
      db.run('DELETE FROM hand_evs WHERE sessionId = ?', [sessionId]);
      db.run('DELETE FROM player_session_stats WHERE sessionId = ?', [sessionId]);
      db.run(
        `INSERT INTO hand_logs (sessionId, rawLog, parsedAt, totalHands, eligibleEvHands)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(sessionId) DO UPDATE SET
           rawLog = excluded.rawLog,
           parsedAt = excluded.parsedAt,
           totalHands = excluded.totalHands,
           eligibleEvHands = excluded.eligibleEvHands`,
        [sessionId, rawLog, now, result.hands.length, eligibleCount]
      );

      const stmt = db.prepare(
        `INSERT INTO hand_evs (id, sessionId, handNumber, handIndex, playerName, actualNet, expectedNet, isAllInEv, equity, gameType)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      result.hands.forEach((h, idx) => {
        for (const [rawKey, v] of Object.entries(h.perPlayer)) {
          const id = generateId();
          stmt.run(
            id, sessionId, h.handNumber, idx,
            canonicalNameOf(rawKey, aliasMap),
            v.actualNet, v.expectedNet,
            v.isAllInEv ? 1 : 0,
            null, // equity stored only when isAllInEv; computed but not currently exposed per-row
            h.gameType
          );
        }
      });
      stmt.finalize();

      // Aggregate style stats by canonical name, then insert.
      const byCanonical = {};
      for (const [rawKey, c] of Object.entries(styleStatsByRaw || {})) {
        const name = canonicalNameOf(rawKey, aliasMap);
        if (!byCanonical[name]) {
          byCanonical[name] = { handsDealt: 0, vpipHands: 0, pfrHands: 0, postflopBets: 0, postflopRaises: 0, postflopCalls: 0 };
        }
        const agg = byCanonical[name];
        agg.handsDealt += c.handsDealt;
        agg.vpipHands += c.vpipHands;
        agg.pfrHands += c.pfrHands;
        agg.postflopBets += c.postflopBets;
        agg.postflopRaises += c.postflopRaises;
        agg.postflopCalls += c.postflopCalls;
      }
      const statStmt = db.prepare(
        `INSERT INTO player_session_stats
         (id, sessionId, playerName, handsDealt, vpipHands, pfrHands, postflopBets, postflopRaises, postflopCalls)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const [name, c] of Object.entries(byCanonical)) {
        statStmt.run(generateId(), sessionId, name, c.handsDealt, c.vpipHands, c.pfrHands, c.postflopBets, c.postflopRaises, c.postflopCalls);
      }
      statStmt.finalize((err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({
          ok: true,
          totalHands: result.hands.length,
          eligibleEvHands: eligibleCount,
          players: result.players.map((p) => canonicalNameOf(p, aliasMap)),
        });
      });
    });
  });
});

// GET /api/sessions/:id/player-stats — VPIP/PFR/AF per player for this session.
app.get('/api/sessions/:id/player-stats', (req, res) => {
  db.all(
    `SELECT playerName, handsDealt, vpipHands, pfrHands, postflopBets, postflopRaises, postflopCalls
       FROM player_session_stats
      WHERE sessionId = ?
      ORDER BY handsDealt DESC`,
    [req.params.id],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows.map((r) => ({ playerName: r.playerName, ...deriveStats(r) })));
    }
  );
});

// GET /api/player-stats — aggregated across all sessions with logs.
app.get('/api/player-stats', (req, res) => {
  db.all(
    `SELECT playerName,
            SUM(handsDealt) AS handsDealt,
            SUM(vpipHands) AS vpipHands,
            SUM(pfrHands) AS pfrHands,
            SUM(postflopBets) AS postflopBets,
            SUM(postflopRaises) AS postflopRaises,
            SUM(postflopCalls) AS postflopCalls,
            COUNT(DISTINCT sessionId) AS sessions
       FROM player_session_stats
      GROUP BY playerName
     HAVING SUM(handsDealt) > 0
      ORDER BY SUM(handsDealt) DESC`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows.map((r) => ({ playerName: r.playerName, sessions: r.sessions, ...deriveStats(r) })));
    }
  );
});

// GET /api/sessions/:id/ev — chart series for one session.
// Returns { players: [name], series: [{ handNumber, perPlayer: {name: {actualNet, expectedNet, isAllInEv}} }] }
app.get('/api/sessions/:id/ev', (req, res) => {
  const sessionId = req.params.id;
  db.all(
    `SELECT handNumber, handIndex, playerName, actualNet, expectedNet, isAllInEv, gameType
       FROM hand_evs WHERE sessionId = ? ORDER BY handIndex, playerName`,
    [sessionId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      const byIndex = new Map();
      const players = new Set();
      for (const r of rows) {
        players.add(r.playerName);
        if (!byIndex.has(r.handIndex)) {
          byIndex.set(r.handIndex, { handIndex: r.handIndex, handNumber: r.handNumber, gameType: r.gameType, perPlayer: {} });
        }
        byIndex.get(r.handIndex).perPlayer[r.playerName] = {
          actualNet: r.actualNet,
          expectedNet: r.expectedNet,
          isAllInEv: !!r.isAllInEv,
        };
      }
      res.json({
        players: [...players].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })),
        series: [...byIndex.values()].sort((a, b) => a.handIndex - b.handIndex),
      });
    }
  );
});

// GET /api/luck-leaderboard — cross-session aggregated luck per canonical player.
app.get('/api/luck-leaderboard', (req, res) => {
  db.all(
    `SELECT playerName,
            COUNT(DISTINCT sessionId) AS sessions,
            SUM(isAllInEv) AS allInHands,
            SUM(CASE WHEN isAllInEv = 1 THEN actualNet ELSE 0 END) AS actualOnAllIns,
            SUM(CASE WHEN isAllInEv = 1 THEN expectedNet ELSE 0 END) AS expectedOnAllIns
       FROM hand_evs
      GROUP BY playerName
      HAVING allInHands > 0
      ORDER BY (actualOnAllIns - expectedOnAllIns) DESC`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows.map((r) => ({
        playerName: r.playerName,
        sessions: r.sessions,
        allInHands: r.allInHands,
        actualOnAllIns: r.actualOnAllIns,
        expectedOnAllIns: r.expectedOnAllIns,
        luckDelta: r.actualOnAllIns - r.expectedOnAllIns,
      })));
    }
  );
});

// POST /api/players/merge — collapse one canonical player into another.
// Updates everywhere the name appears: per-session players, alias mappings,
// hand-level EV rows. Irreversible (no undo) — use carefully.
//   body: { from: string, into: string }
app.post('/api/players/merge', (req, res) => {
  const from = (req.body && req.body.from || '').trim();
  const into = (req.body && req.body.into || '').trim();
  if (!from || !into) return res.status(400).json({ error: 'from and into required' });
  if (from === into) return res.status(400).json({ error: 'from and into must differ' });

  const now = new Date().toISOString();
  let counts = { players: 0, aliasMappings: 0, handEvs: 0 };
  db.serialize(() => {
    db.run('UPDATE players SET name = ? WHERE name = ?', [into, from], function (err) {
      if (err) return res.status(500).json({ error: err.message });
      counts.players = this.changes;
    });
    db.run(
      'UPDATE alias_mappings SET realName = ?, updatedAt = ? WHERE realName = ?',
      [into, now, from],
      function (err) {
        if (err) return res.status(500).json({ error: err.message });
        counts.aliasMappings = this.changes;
      }
    );
    db.run('UPDATE hand_evs SET playerName = ? WHERE playerName = ?', [into, from], function (err) {
      if (err) return res.status(500).json({ error: err.message });
      counts.handEvs = this.changes;

      // Move bank details to the merge target if it has none of its own.
      db.run(
        `UPDATE bank_accounts SET name = ? WHERE name = ? AND NOT EXISTS (SELECT 1 FROM bank_accounts WHERE name = ?)`,
        [into, from, into]
      );
      db.run('DELETE FROM bank_accounts WHERE name = ?', [from]);

      // Record the merge so the seed list stops re-injecting the old name.
      // Also clear any prior removal of `into` (in case it was previously
      // merged away and is now being re-used as a target).
      db.run(
        `INSERT INTO removed_canonicals (name, mergedInto, removedAt) VALUES (?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET mergedInto = excluded.mergedInto, removedAt = excluded.removedAt`,
        [from, into, now]
      );
      db.run('DELETE FROM removed_canonicals WHERE name = ?', [into]);
      res.json({ ok: true, from, into, updated: counts });
    });
  });
});

// DELETE /api/alias-mappings/:alias — remove a single alias row.
// Only affects the alias_mappings table; no historical data is touched
// (sessions/EV reference canonical names, not aliases).
app.delete('/api/alias-mappings/:alias', (req, res) => {
  const alias = req.params.alias;
  if (!alias) return res.status(400).json({ error: 'alias required' });
  db.run('DELETE FROM alias_mappings WHERE alias = ?', [alias], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ ok: true, alias, deleted: this.changes });
  });
});

// DELETE /api/alias-mappings?onlyUnmapped=true — bulk delete.
// With ?onlyUnmapped=true (the default and only supported mode for safety),
// removes every row where realName is null or empty.
app.delete('/api/alias-mappings', (req, res) => {
  const onlyUnmapped = req.query.onlyUnmapped !== 'false';
  if (!onlyUnmapped) {
    return res.status(400).json({ error: 'Only ?onlyUnmapped=true is supported (full wipe would destroy your alias graph).' });
  }
  db.run(`DELETE FROM alias_mappings WHERE realName IS NULL OR TRIM(realName) = ''`, [], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ ok: true, deleted: this.changes });
  });
});

// DELETE /api/players/:name — fully wipe a player.
// Removes their per-session player rows (cascades to their buy-ins), every
// alias mapping that pointed at them (and any DB row keyed by that name as
// an alias), every hand-EV row, and records them in removed_canonicals so
// the seed/sessions lists don't reintroduce them. Irreversible.
app.delete('/api/players/:name', (req, res) => {
  const name = (req.params.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name required' });
  const now = new Date().toISOString();
  const counts = { players: 0, aliasMappingsByRealName: 0, aliasMappingsByKey: 0, handEvs: 0, bankAccounts: 0 };

  db.serialize(() => {
    db.run('DELETE FROM players WHERE name = ?', [name], function (err) {
      if (err) return res.status(500).json({ error: err.message });
      counts.players = this.changes;
    });
    db.run('DELETE FROM alias_mappings WHERE realName = ?', [name], function (err) {
      if (err) return res.status(500).json({ error: err.message });
      counts.aliasMappingsByRealName = this.changes;
    });
    // Also wipe alias rows where this name IS the alias key (player created
    // as both an alias and a canonical at some point).
    db.run('DELETE FROM alias_mappings WHERE alias = ?', [name], function (err) {
      if (err) return res.status(500).json({ error: err.message });
      counts.aliasMappingsByKey = this.changes;
    });
    db.run('DELETE FROM hand_evs WHERE playerName = ?', [name], function (err) {
      if (err) return res.status(500).json({ error: err.message });
      counts.handEvs = this.changes;
    });
    db.run('DELETE FROM bank_accounts WHERE name = ?', [name], function (err) {
      if (err) return res.status(500).json({ error: err.message });
      counts.bankAccounts = this.changes;
    });
    db.run(
      `INSERT INTO removed_canonicals (name, mergedInto, removedAt) VALUES (?, NULL, ?)
       ON CONFLICT(name) DO UPDATE SET mergedInto = NULL, removedAt = excluded.removedAt`,
      [name, now],
      function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ ok: true, name, deleted: counts });
      }
    );
  });
});

// POST /api/sessions/:id/announce-discord — forward to the bot's localhost endpoint
// so the bot creates a thread + posts results. Used by the Results page button.
// Note: avoid port 6000 (X11) and other unsafe ports on Node's undici blocklist —
// fetch will fail with "bad port". Default 6300 matches the bot's .env.example.
const BOT_BASE = process.env.BOT_BASE || 'http://127.0.0.1:6300';
app.post('/api/sessions/:id/announce-discord', async (req, res) => {
  try {
    const botRes = await fetch(`${BOT_BASE}/announce/${encodeURIComponent(req.params.id)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const body = await botRes.json().catch(() => ({}));
    if (!botRes.ok) return res.status(502).json({ error: `Bot returned ${botRes.status}`, details: body });
    res.json(body);
  } catch (err) {
    res.status(502).json({ error: `Could not reach bot at ${BOT_BASE}: ${err.message}` });
  }
});

app.listen(PORT, () => {
  console.log(`Poker Tracker backend running on port ${PORT}`);
  console.log(`CORS enabled for: http://76.13.182.206:5000`);
});
