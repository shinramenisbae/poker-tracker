const express = require('express');
const cors = require('cors');
const db = require('./database');

const app = express();
const PORT = 5001;

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

app.use(express.json());

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
  const { date, notes, players } = req.body;
  const id = generateId();
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO sessions (id, date, status, notes, createdAt, updatedAt)
    VALUES (?, ?, 'active', ?, ?, ?)
  `);
  
  stmt.run(id, date || now.split('T')[0], notes || '', now, now, function(err) {
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
        
        const cashOutAmount = player.cashOut?.amount || null;
        const cashOutDate = player.cashOut?.timestamp ? new Date(player.cashOut.timestamp).toISOString() : null;
        
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
  const { date, status, notes, bankPlayerId } = req.body;
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
      SET date = ?, status = ?, notes = ?, bankPlayerId = ?, updatedAt = ?
      WHERE id = ?
    `);
    
    stmt.run(
      date || existing.date,
      status || existing.status,
      notes !== undefined ? notes : existing.notes,
      bankPlayerId !== undefined ? bankPlayerId : existing.bankPlayerId,
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

app.listen(PORT, () => {
  console.log(`Poker Tracker backend running on port ${PORT}`);
  console.log(`CORS enabled for: http://76.13.182.206:5000`);
});
