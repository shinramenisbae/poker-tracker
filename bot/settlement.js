// Settlement calculation for the Discord results message.
//
// This is a faithful port of the frontend's app/src/utils/calculations.ts so
// the bot's posted message matches exactly what the Results page shows —
// including how each loser's debt splits between cash already on the table and
// a bank transfer still owed.
//
// Model recap:
//   - Cash buy-ins go to the banker, or sit on the table until there is one.
//   - Bank buy-ins were transferred to the session's collector up front.
//   - Credit buy-ins are owed to the banker after the game.
//   - The banker settles everyone else by cash and/or bank transfer. What a
//     player still *owes* is only their credit shortfall (netWithBank).
//   - Cash goes out in $50s, as recorded on the Results page or as suggested
//     until then; older sessions split it proportionally until one is recorded.

function totalBuyIn(player) {
  return (player.buyIns || []).reduce((s, b) => s + (Number(b.amount) || 0), 0);
}

function cashOutOf(player) {
  if (player.cashOut) return Number(player.cashOut.amount) || 0;
  return Number(player.cashOutAmount) || 0;
}

function hasCashedOut(player) {
  return player.cashOut != null || player.cashOutAmount != null;
}

// Biggest winner by profit, mirroring identifyBankPlayer() on the frontend.
function identifyBankPlayer(session) {
  const withResults = (session.players || [])
    .filter(hasCashedOut)
    .map((p) => ({ id: p.id, profit: cashOutOf(p) - totalBuyIn(p) }))
    .filter((p) => p.profit > 0)
    .sort((a, b) => b.profit - a.profit);
  return withResults.length > 0 ? withResults[0].id : null;
}

const round2 = (n) => Math.round(n * 100) / 100;

/** Suggested cash, mirroring suggestCash() on the frontend. */
function suggestCash({ cashBuyIn, netWithBank }) {
  return cashBuyIn > 0 && netWithBank > 0 ? Math.round(netWithBank / 50) * 50 : 0;
}

function cashMode(session, bankId) {
  if ((session.players || []).some((p) => p.id !== bankId && p.cashPaid != null)) return 'saved';
  return session.cashInFifties ? 'suggested' : 'proportional';
}

// Returns the per-player settlement rows, mirroring calculateSettlements().
// Each row: { playerId, playerName, profitLoss, cashBuyIn, creditBuyIn, bankBuyIn,
//             netWithBank, cashReceived, bankReceived, bankOwed }
function calculateSettlements(session) {
  const players = session.players || [];
  const bankId = session.bankPlayerId || identifyBankPlayer(session);
  if (!bankId) return [];

  const cashPool = players.reduce((sum, p) => {
    return sum + (p.buyIns || [])
      .filter((b) => (b.method || 'cash') === 'cash')
      .reduce((s, b) => s + (Number(b.amount) || 0), 0);
  }, 0);

  const raw = players.map((player) => {
    const cashOut = cashOutOf(player);
    const cashBuyIn = (player.buyIns || [])
      .filter((b) => (b.method || 'cash') === 'cash')
      .reduce((sum, b) => sum + (Number(b.amount) || 0), 0);
    const creditBuyIn = (player.buyIns || [])
      .filter((b) => b.method === 'credit')
      .reduce((sum, b) => sum + (Number(b.amount) || 0), 0);
    // Transferred to the collector: neither on the table nor owed.
    const bankBuyIn = (player.buyIns || [])
      .filter((b) => b.method === 'bank')
      .reduce((sum, b) => sum + (Number(b.amount) || 0), 0);
    const totalIn = cashBuyIn + creditBuyIn + bankBuyIn;
    const profitLoss = hasCashedOut(player) ? cashOut - totalIn : 0;
    const netWithBank = cashOut - creditBuyIn;
    return { playerId: player.id, playerName: player.name, profitLoss, cashBuyIn, creditBuyIn, bankBuyIn, netWithBank };
  });

  const mode = cashMode(session, bankId);
  if (mode !== 'proportional') {
    const cashPaidBy = new Map(players.map((p) => [p.id, p.cashPaid ?? 0]));
    const rows = raw.map((r) => {
      if (r.playerId === bankId) return { ...r, cashReceived: 0, bankReceived: 0, bankOwed: 0, changeOwed: 0 };
      if (r.netWithBank <= 0) {
        return { ...r, cashReceived: 0, bankReceived: 0, bankOwed: Math.abs(r.netWithBank), changeOwed: 0 };
      }
      const cashReceived = mode === 'saved' ? cashPaidBy.get(r.playerId) ?? 0 : suggestCash(r);
      const difference = round2(r.netWithBank - cashReceived);
      return { ...r, cashReceived, bankOwed: 0, bankReceived: Math.max(difference, 0), changeOwed: Math.max(-difference, 0) };
    });
    // Whatever nobody took stays with the banker.
    const handedOut = rows.reduce((sum, r) => sum + r.cashReceived, 0);
    return rows.map((r) => (r.playerId === bankId ? { ...r, cashReceived: Math.max(cashPool - handedOut, 0) } : r));
  }

  const totalOwed = raw
    .filter((r) => r.playerId !== bankId && r.netWithBank > 0)
    .reduce((sum, r) => sum + r.netWithBank, 0);

  const bankPlayerData = raw.find((r) => r.playerId === bankId);
  const cashForBankPlayer = Math.min(
    bankPlayerData && bankPlayerData.netWithBank > 0 ? bankPlayerData.netWithBank : 0,
    cashPool
  );
  const cashAvailable = cashPool - cashForBankPlayer;

  return raw.map((r) => {
    if (r.playerId === bankId) {
      return { ...r, cashReceived: cashForBankPlayer, bankReceived: 0, bankOwed: 0, changeOwed: 0 };
    }
    if (r.netWithBank > 0) {
      const cashShare = totalOwed > 0
        ? Math.round(r.netWithBank * (cashAvailable / totalOwed) * 100) / 100
        : 0;
      const cashReceived = Math.min(cashShare, r.netWithBank);
      const bankReceived = Math.round((r.netWithBank - cashReceived) * 100) / 100;
      return { ...r, cashReceived, bankReceived, bankOwed: 0, changeOwed: 0 };
    } else if (r.netWithBank < 0) {
      return { ...r, cashReceived: 0, bankReceived: 0, bankOwed: Math.abs(r.netWithBank), changeOwed: 0 };
    }
    return { ...r, cashReceived: 0, bankReceived: 0, bankOwed: 0, changeOwed: 0 };
  });
}

export { cashMode, suggestCash, identifyBankPlayer, calculateSettlements, totalBuyIn, cashOutOf, hasCashedOut };
