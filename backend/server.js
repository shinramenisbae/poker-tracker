const express = require('express');
const cors = require('cors');
const db = require('./database');

const app = express();
const PORT = 5001;

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

app.listen(PORT, () => {
  console.log(`Poker Tracker backend running on port ${PORT}`);
  console.log(`CORS enabled for: http://76.13.182.206:5000`);
});
