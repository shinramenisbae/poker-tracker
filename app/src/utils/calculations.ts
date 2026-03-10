import type { Player, Session, Settlement, SettlementSummary, SessionTotals } from '../types';

export function getTotalBuyIn(player: Player): number {
  return player.buyIns.reduce((sum, buyIn) => sum + buyIn.amount, 0);
}

export function getProfitLoss(player: Player): number | null {
  const totalBuyIn = getTotalBuyIn(player);
  if (player.cashOut === null) return null;
  return player.cashOut.amount - totalBuyIn;
}

export function getSessionTotals(session: Session): SessionTotals {
  const players = session.players ?? [];
  const totalPot = players.reduce(
    (sum, p) => sum + getTotalBuyIn(p),
    0
  );
  const totalCashOut = players.reduce(
    (sum, p) => sum + (p.cashOut?.amount ?? 0),
    0
  );
  return {
    totalPot,
    totalCashOut,
    isBalanced: totalPot === totalCashOut,
  };
}

export function identifyBankPlayer(session: Session): string | null {
  const playersWithResults = session.players
    .map((p) => ({ id: p.id, profit: getProfitLoss(p) }))
    .filter((p) => p.profit !== null && p.profit > 0)
    .sort((a, b) => b.profit! - a.profit!);

  return playersWithResults.length > 0 ? playersWithResults[0].id : null;
}

export function calculateSettlements(session: Session): Settlement[] {
  const bankId = session.bankPlayerId;
  if (!bankId) return [];

  // Cash pool = all cash buy-ins from every player (physically on the table)
  const cashPool = session.players.reduce((sum, p) => {
    return sum + p.buyIns
      .filter((b) => (b.method || 'cash') === 'cash')
      .reduce((s, b) => s + b.amount, 0);
  }, 0);

  // Build raw settlement data for each player
  const raw = session.players.map((player) => {
    const cashOut = player.cashOut?.amount ?? 0;
    const cashBuyIn = player.buyIns
      .filter((b) => (b.method || 'cash') === 'cash')
      .reduce((sum, b) => sum + b.amount, 0);
    const bankBuyIn = player.buyIns
      .filter((b) => b.method === 'bank')
      .reduce((sum, b) => sum + b.amount, 0);
    const totalBuyIn = cashBuyIn + bankBuyIn;
    const profitLoss = player.cashOut !== null ? cashOut - totalBuyIn : 0;

    // net = cashout - bank_buyin
    // Positive: bank owes them (they get cash/bank from bank player)
    // Negative: they owe bank (they pay via bank transfer)
    const netWithBank = cashOut - bankBuyIn;

    return {
      playerId: player.id,
      playerName: player.name,
      profitLoss,
      cashBuyIn,
      bankBuyIn,
      netWithBank,
    };
  });

  // Total amount owed to players (sum of positive nets, excluding bank player)
  const totalOwed = raw
    .filter((r) => r.playerId !== bankId && r.netWithBank > 0)
    .reduce((sum, r) => sum + r.netWithBank, 0);

  // Bank player takes their own cashout from the cash pool
  const bankPlayerData = raw.find((r) => r.playerId === bankId)!;
  const cashForBankPlayer = Math.min(bankPlayerData.netWithBank > 0 ? bankPlayerData.netWithBank : 0, cashPool);
  const cashAvailable = cashPool - cashForBankPlayer;

  // Distribute remaining cash to non-bank players who are owed
  return raw.map((r) => {
    if (r.playerId === bankId) {
      return {
        ...r,
        cashReceived: cashForBankPlayer,
        bankReceived: 0,
        bankOwed: 0,
      };
    }

    if (r.netWithBank > 0) {
      // Player is owed money — give cash proportionally, rest via bank transfer
      const cashShare = totalOwed > 0
        ? Math.round(r.netWithBank * (cashAvailable / totalOwed) * 100) / 100
        : 0;
      const cashReceived = Math.min(cashShare, r.netWithBank);
      const bankReceived = Math.round((r.netWithBank - cashReceived) * 100) / 100;
      return { ...r, cashReceived, bankReceived, bankOwed: 0 };
    } else if (r.netWithBank < 0) {
      // Player owes money — bank transfer to bank player
      return { ...r, cashReceived: 0, bankReceived: 0, bankOwed: Math.abs(r.netWithBank) };
    } else {
      return { ...r, cashReceived: 0, bankReceived: 0, bankOwed: 0 };
    }
  });
}

export function getSettlementSummary(session: Session): SettlementSummary | null {
  const bankId = session.bankPlayerId;
  const bankPlayer = session.players.find((p) => p.id === bankId);
  if (!bankId || !bankPlayer) return null;

  const settlements = calculateSettlements(session);
  const nonBankSettlements = settlements.filter((s) => s.playerId !== bankId);

  return {
    bankPlayerId: bankId,
    bankPlayerName: bankPlayer.name,
    settlements,
    cashToCollect: settlements.reduce((sum, s) => sum + s.cashBuyIn, 0),
    cashToDistribute: nonBankSettlements.reduce((sum, s) => sum + s.cashReceived, 0),
    bankTransfersOut: nonBankSettlements.reduce((sum, s) => sum + s.bankReceived, 0),
    bankTransfersIn: nonBankSettlements.reduce((sum, s) => sum + s.bankOwed, 0),
  };
}

export function formatCurrency(amount: number, currency: string = 'USD'): string {
  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return formatter.format(amount);
}

export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) {
    return 'Today';
  } else if (date.toDateString() === yesterday.toDateString()) {
    return 'Yesterday';
  } else {
    const options: Intl.DateTimeFormatOptions = {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    };
    if (date.getFullYear() !== today.getFullYear()) {
      options.year = 'numeric';
    }
    return date.toLocaleDateString('en-US', options);
  }
}

export function formatDuration(startTime: number, endTime: number): string {
  const diff = endTime - startTime;
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (hours === 0) {
    return `${minutes}m`;
  } else if (minutes === 0) {
    return `${hours}h`;
  } else {
    return `${hours}h ${minutes}m`;
  }
}