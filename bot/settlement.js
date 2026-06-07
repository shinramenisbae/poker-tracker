// Settlement calculation for the Discord results message.
//
// This is a faithful port of the frontend's app/src/utils/calculations.ts so
// the bot's posted message matches exactly what the Results page shows —
// including how each loser's debt splits between cash already on the table and
// a bank transfer still owed.
//
// Model recap:
//   - Cash buy-ins are physical chips already pooled on the table.
//   - The bank player (biggest winner) collects that cash pool and settles
//     everyone else by cash (from the pool) and/or bank transfer.
//   - A loser who bought in with cash has effectively already paid that cash;
//     what they still *owe* is only their bank-buy-in shortfall (netWithBank).

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

// Returns the per-player settlement rows, mirroring calculateSettlements().
// Each row: { playerId, playerName, profitLoss, cashBuyIn, bankBuyIn,
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
    const bankBuyIn = (player.buyIns || [])
      .filter((b) => b.method === 'bank')
      .reduce((sum, b) => sum + (Number(b.amount) || 0), 0);
    const totalIn = cashBuyIn + bankBuyIn;
    const profitLoss = hasCashedOut(player) ? cashOut - totalIn : 0;
    const netWithBank = cashOut - bankBuyIn;
    return { playerId: player.id, playerName: player.name, profitLoss, cashBuyIn, bankBuyIn, netWithBank };
  });

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
      return { ...r, cashReceived: cashForBankPlayer, bankReceived: 0, bankOwed: 0 };
    }
    if (r.netWithBank > 0) {
      const cashShare = totalOwed > 0
        ? Math.round(r.netWithBank * (cashAvailable / totalOwed) * 100) / 100
        : 0;
      const cashReceived = Math.min(cashShare, r.netWithBank);
      const bankReceived = Math.round((r.netWithBank - cashReceived) * 100) / 100;
      return { ...r, cashReceived, bankReceived, bankOwed: 0 };
    } else if (r.netWithBank < 0) {
      return { ...r, cashReceived: 0, bankReceived: 0, bankOwed: Math.abs(r.netWithBank) };
    }
    return { ...r, cashReceived: 0, bankReceived: 0, bankOwed: 0 };
  });
}

export { identifyBankPlayer, calculateSettlements, totalBuyIn, cashOutOf, hasCashedOut };
