// PokerNow hand log parser.
//
// Input: raw CSV text (3 columns: entry, at, order). Log lines are NOT
// chronological in the file — sort by `order` ascending to get real time.
//
// Output: array of hand objects (see schema in module exports).
//
// playerKey is "name @ player_id" (the raw form from the log).

const UNICODE_SUITS = { '♠': 's', '♥': 'h', '♦': 'd', '♣': 'c' };

function normalizeCard(card) {
  const m = card.trim().match(/^([0-9JQKA]+|10)([♠♥♦♣])$/);
  if (!m) return null;
  const rank = m[1] === '10' ? 'T' : m[1];
  return rank + UNICODE_SUITS[m[2]];
}

function parseCards(s) {
  return s.split(',').map((c) => normalizeCard(c)).filter(Boolean);
}

// Tiny CSV parser: handles quoted fields with embedded commas + escaped "" quotes.
function parseCsv(text) {
  const records = [];
  let i = 0;
  const len = text.length;
  // Read header
  const header = readCsvRow();
  while (i < len) {
    const row = readCsvRow();
    if (row.length === 0) continue;
    const rec = {};
    header.forEach((h, idx) => { rec[h] = row[idx] ?? ''; });
    records.push(rec);
  }
  return records;

  function readCsvRow() {
    const out = [];
    if (i >= len) return out;
    let cur = '';
    let inQuotes = false;
    while (i < len) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { cur += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        cur += c; i++;
      } else {
        if (c === '"') { inQuotes = true; i++; continue; }
        if (c === ',') { out.push(cur); cur = ''; i++; continue; }
        if (c === '\n') { out.push(cur); i++; return out; }
        if (c === '\r') { i++; continue; }
        cur += c; i++;
      }
    }
    out.push(cur);
    return out;
  }
}

function parseHandLog(csvText) {
  const records = parseCsv(csvText).filter((r) => r.entry && r.order);
  records.sort((a, b) => (BigInt(a.order) > BigInt(b.order) ? 1 : -1));

  const hands = [];
  let cur = null;
  let street = 'preflop';
  let boardSoFar = [];

  function finalizeIfOpen() {
    if (cur) {
      cur.hasAllIn = cur.allInPlayers.length > 0;
      hands.push(cur);
      cur = null;
    }
  }

  for (const rec of records) {
    const entry = rec.entry;

    const startMatch = entry.match(/^-- starting hand #(\d+) \(id: ([^)]+)\)\s+([^(]+?)\s*\(dealer:/);
    if (startMatch) {
      finalizeIfOpen();
      const variant = startMatch[3].trim();
      cur = {
        handNumber: Number(startMatch[1]),
        handId: startMatch[2],
        gameType: /Omaha/i.test(variant) ? 'omaha' : 'holdem',
        gameVariantRaw: variant,
        timestamp: rec.at,
        stacks: {},
        players: [],
        actions: [],
        boardAtAllIn: [],
        shownCards: {},
        finalBoards: { primary: [], secondary: null },
        collected: {},
        uncalledReturned: {},
        allInPlayers: [],
      };
      street = 'preflop';
      boardSoFar = [];
      continue;
    }

    // Note: PokerNow emits `shows`, `Undealt cards`, and `bounty paid/collected`
    // AFTER the `-- ending hand #N --` marker but before the NEXT `-- starting
    // hand` line. Don't close the hand on the ending marker — let those trailing
    // events accumulate. The hand finalizes when the next `starting hand` (or
    // end of records) is encountered.
    if (/^-- ending hand #\d+ --/.test(entry)) {
      continue;
    }

    if (!cur) continue;

    if (entry.startsWith('Player stacks:')) {
      const re = /"([^"]+)\s+@\s+([^"]+)"\s*\(([0-9.]+)\)/g;
      let m;
      while ((m = re.exec(entry)) !== null) {
        const key = `${m[1]} @ ${m[2]}`;
        cur.stacks[key] = parseFloat(m[3]);
        cur.players.push(key);
      }
      continue;
    }

    let m = entry.match(/^Flop(?:\s*\((?:second board|second run)\))?:\s*\[([^\]]+)\]/);
    if (m) {
      const cards = parseCards(m[1]);
      const isSecond = /second/.test(entry);
      if (!isSecond) {
        street = 'flop';
        boardSoFar = cards.slice(0, 3);
        cur.finalBoards.primary = cards.slice(0, 3);
      } else {
        cur.finalBoards.secondary = cards.slice(0, 3);
      }
      continue;
    }

    m = entry.match(/^Turn(?:\s*\((?:second board|second run)\))?:\s*([0-9JQKA♠♥♦♣, T]+?)\s*\[([^\]]+)\]/);
    if (m) {
      const newCard = parseCards(m[2])[0];
      const isSecond = /second/.test(entry);
      if (!isSecond) {
        street = 'turn';
        boardSoFar = parseCards(m[1] + ', ' + m[2]);
        cur.finalBoards.primary = boardSoFar.slice();
      } else {
        cur.finalBoards.secondary = (cur.finalBoards.secondary || []).concat(newCard);
      }
      continue;
    }

    m = entry.match(/^River(?:\s*\((?:second board|second run)\))?:\s*([0-9JQKA♠♥♦♣, T]+?)\s*\[([^\]]+)\]/);
    if (m) {
      const newCard = parseCards(m[2])[0];
      const isSecond = /second/.test(entry);
      if (!isSecond) {
        street = 'river';
        boardSoFar = parseCards(m[1] + ', ' + m[2]);
        cur.finalBoards.primary = boardSoFar.slice();
      } else {
        cur.finalBoards.secondary = (cur.finalBoards.secondary || []).concat(newCard);
      }
      continue;
    }

    m = entry.match(/^"([^"]+)\s+@\s+([^"]+)"\s+(.+)$/);
    if (m) {
      const key = `${m[1]} @ ${m[2]}`;
      const rest = m[3];
      const allIn = /(?:and )?go(?:es)? all in/i.test(rest);

      const showMatch = rest.match(/^shows a (.+?)\.?$/);
      if (showMatch) {
        const cards = parseCards(showMatch[1].replace(/\.$/, ''));
        const expected = cur.gameType === 'omaha' ? 4 : 2;
        if (cards.length === expected) {
          cur.shownCards[key] = cards;
        }
        continue;
      }

      const collectedMatch = rest.match(/^collected ([0-9.]+) from pot/);
      if (collectedMatch) {
        cur.collected[key] = (cur.collected[key] || 0) + parseFloat(collectedMatch[1]);
        continue;
      }

      const actionMatch = rest.match(/^(folds|checks|calls|bets|raises to|posts a bet of|posts a (?:small|big) blind of|posts a missed (?:small|big) blind of|posts a straddle of)\s*([0-9.]+)?/);
      if (actionMatch) {
        const verb = actionMatch[1];
        const amount = actionMatch[2] ? parseFloat(actionMatch[2]) : null;
        let type = verb.split(' ')[0];
        if (verb.startsWith('posts a small')) type = 'sb';
        else if (verb.startsWith('posts a big')) type = 'bb';
        else if (verb.startsWith('posts a missed')) type = 'missedBlind';
        else if (verb.startsWith('posts a straddle')) type = 'straddle';
        else if (verb === 'posts a bet of') type = 'bombPotAnte'; // forced ante in a bomb pot
        else if (verb === 'raises to') type = 'raise';
        cur.actions.push({ playerKey: key, type, amount, allIn, street });
        if (allIn && !cur.allInPlayers.includes(key)) {
          cur.allInPlayers.push(key);
          cur.boardAtAllIn.push(boardSoFar.slice());
        }
        continue;
      }
    }

    m = entry.match(/^Uncalled bet of ([0-9.]+) returned to "([^"]+)\s+@\s+([^"]+)"/);
    if (m) {
      const key = `${m[2]} @ ${m[3]}`;
      cur.uncalledReturned[key] = (cur.uncalledReturned[key] || 0) + parseFloat(m[1]);
      continue;
    }

    // "X paid N for the Y-Z bounty to W"  — peer-to-peer bounty payment
    // (e.g. 7-2 game: losers pay winner when winner wins with 7-2)
    m = entry.match(/^"([^"]+)\s+@\s+([^"]+)"\s+paid ([0-9.]+) for the .+? bounty to "([^"]+)\s+@\s+([^"]+)"/);
    if (m) {
      const from = `${m[1]} @ ${m[2]}`;
      const to = `${m[4]} @ ${m[5]}`;
      const amt = parseFloat(m[3]);
      cur.bountyPaid = cur.bountyPaid || {};
      cur.bountyReceived = cur.bountyReceived || {};
      cur.bountyPaid[from] = (cur.bountyPaid[from] || 0) + amt;
      cur.bountyReceived[to] = (cur.bountyReceived[to] || 0) + amt;
      continue;
    }
  }

  finalizeIfOpen();
  return hands;
}

module.exports = { parseHandLog };
