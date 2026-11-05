import type { Player, Session, Settlement, SettlementSummary, SessionTotals } from '../types';

export function getTotalBuyIn(player: Player): number {
  return player.buyIns.reduce((sum, buyIn) => sum + buyIn.amount, 0);
}

/** What a player owes the banker for tonight's buy-ins: the credit ones. Cash
 *  went to the banker or the table, and bank to the collector. */
export function getOwedBuyIn(player: Player): number {
  return player.buyIns
    .filter((b) => b.method === 'credit')
    .reduce((sum, b) => sum + b.amount, 0);
}

const roundCents = (n: number) => Math.round(n * 100) / 100;

/** Suggested cash for someone the banker owes: their own cash came in, so the
 *  amount goes back in cash, to the nearest $50. Anyone else is paid by transfer
 *  unless the banker says otherwise. */
export function suggestCash(s: Pick<Settlement, 'cashBuyIn' | 'netWithBank'>): number {
  return s.cashBuyIn > 0 && s.netWithBank > 0 ? Math.round(s.netWithBank / 50) * 50 : 0;
}

/** Settles the gap between what a player is owed and the cash they get. */
export function transferAfterCash(owed: number, cash: number): { bankReceived: number; changeOwed: number } {
  const difference = roundCents(owed - cash);
  return { bankReceived: Math.max(difference, 0), changeOwed: Math.max(-difference, 0) };
}

/** New players get no credit. Same rule as the server (credit-limit.js): no
 *  player of that name in any other session. */
export function isNewPlayer(name: string, sessionId: string, sessions: Session[]): boolean {
  const key = name.trim().toLowerCase();
  return !sessions.some((s) => s.id !== sessionId
    && (s.players ?? []).some((p) => p.name.trim().toLowerCase() === key));
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
  // Rake left the table before anyone was paid, so the pot balances as
  // buy-ins = cash-outs + rake. Compared with a tolerance because money is
  // stored as a float.
  const rake = session.rakeAmount ?? 0;
  return {
    totalPot,
    totalCashOut,
    rake,
    isBalanced: Math.abs(totalPot - (totalCashOut + rake)) < 0.005,
  };
}

export type LiveBalance =
  | { state: 'playing'; onTable: number }
  | { state: 'balanced' }
  | { state: 'short' | 'over'; by: number };

/**
 * Does tonight add up yet? The rake is counted alongside the stacks at the end
 * of a night, so the live page checks buy-ins against cash-outs plus rake
 * before anyone ends the session.
 *
 * While someone still has chips on the table the difference is just money in
 * play, not a mistake, so it is reported as such. Once everyone has cashed
 * out it is either square, short (less came off the table than went in), or
 * over.
 */
export function getLiveBalance(session: Session): LiveBalance {
  const { totalPot, totalCashOut, rake } = getSessionTotals(session);
  const difference = Math.round((totalPot - totalCashOut - rake) * 100) / 100;
  const players = session.players ?? [];
  const everyoneOut = players.length > 0 && players.every((p) => p.cashOut !== null);

  if (!everyoneOut) return { state: 'playing', onTable: difference };
  if (Math.abs(difference) < 0.005) return { state: 'balanced' };
  return difference > 0
    ? { state: 'short', by: difference }
    : { state: 'over', by: -difference };
}

export function identifyBankPlayer(session: Session): string | null {
  const playersWithResults = session.players
    .map((p) => ({ id: p.id, profit: getProfitLoss(p) }))
    .filter((p) => p.profit !== null && p.profit > 0)
    .sort((a, b) => b.profit! - a.profit!);

  return playersWithResults.length > 0 ? playersWithResults[0].id : null;
}

function getCashMode(session: Session, bankId: string): SettlementSummary['cashMode'] {
  if (session.players.some((p) => p.id !== bankId && p.cashPaid != null)) return 'saved';
  return session.cashInFifties ? 'suggested' : 'proportional';
}

export function calculateSettlements(session: Session): Settlement[] {
  // Online sessions imported by the bot are created already `completed` and
  // never have a bankPlayerId set (only the in-person "End Session" flow sets
  // it). Fall back to the computed biggest-winner so settlement still works.
  // Computed at view time, so this also retroactively fixes existing imports.
  const bankId = session.bankPlayerId ?? identifyBankPlayer(session);
  if (!bankId) return [];

  const cashMode = getCashMode(session, bankId);

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
    const creditBuyIn = getOwedBuyIn(player);
    // Transferred to the collector, so neither on the table nor owed.
    const bankBuyIn = player.buyIns
      .filter((b) => b.method === 'bank')
      .reduce((sum, b) => sum + b.amount, 0);
    const totalBuyIn = cashBuyIn + creditBuyIn + bankBuyIn;
    const profitLoss = player.cashOut !== null ? cashOut - totalBuyIn : 0;

    // net = cashout - credit
    // Positive: the banker owes them (cash and/or a transfer)
    // Negative: they owe the banker (a transfer)
    const netWithBank = cashOut - creditBuyIn;

    return {
      playerId: player.id,
      playerName: player.name,
      profitLoss,
      cashBuyIn,
      creditBuyIn,
      bankBuyIn,
      netWithBank,
    };
  });

  // Cash in $50s, as recorded or as suggested until someone records it.
  if (cashMode !== 'proportional') {
    const cashPaidBy = new Map(session.players.map((p) => [p.id, p.cashPaid ?? 0]));
    const rows = raw.map((r) => {
      if (r.playerId === bankId) return { ...r, cashReceived: 0, bankReceived: 0, bankOwed: 0, changeOwed: 0 };
      if (r.netWithBank <= 0) {
        return { ...r, cashReceived: 0, bankReceived: 0, bankOwed: Math.abs(r.netWithBank), changeOwed: 0 };
      }
      const cashReceived = cashMode === 'saved' ? cashPaidBy.get(r.playerId) ?? 0 : suggestCash(r);
      return { ...r, cashReceived, bankOwed: 0, ...transferAfterCash(r.netWithBank, cashReceived) };
    });
    // Whatever nobody took stays with the banker.
    const handedOut = rows.reduce((sum, r) => sum + r.cashReceived, 0);
    return rows.map((r) => (r.playerId === bankId ? { ...r, cashReceived: Math.max(cashPool - handedOut, 0) } : r));
  }

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
        changeOwed: 0,
      };
    }

    if (r.netWithBank > 0) {
      // Player is owed money — give cash proportionally, rest via bank transfer
      const cashShare = totalOwed > 0
        ? Math.round(r.netWithBank * (cashAvailable / totalOwed) * 100) / 100
        : 0;
      const cashReceived = Math.min(cashShare, r.netWithBank);
      const bankReceived = Math.round((r.netWithBank - cashReceived) * 100) / 100;
      return { ...r, cashReceived, bankReceived, bankOwed: 0, changeOwed: 0 };
    } else if (r.netWithBank < 0) {
      // Player owes money — bank transfer to bank player
      return { ...r, cashReceived: 0, bankReceived: 0, bankOwed: Math.abs(r.netWithBank), changeOwed: 0 };
    } else {
      return { ...r, cashReceived: 0, bankReceived: 0, bankOwed: 0, changeOwed: 0 };
    }
  });
}

export function getSettlementSummary(session: Session): SettlementSummary | null {
  // Same fallback as calculateSettlements: use the stored bank player if set,
  // otherwise the computed biggest winner (covers bot-imported online sessions
  // that never had bankPlayerId assigned).
  const bankId = session.bankPlayerId ?? identifyBankPlayer(session);
  const bankPlayer = session.players.find((p) => p.id === bankId);
  if (!bankId || !bankPlayer) return null;

  const settlements = calculateSettlements(session);
  const nonBankSettlements = settlements.filter((s) => s.playerId !== bankId);

  // Rake is money the bank owes whoever is holding it — a transfer like a
  // winner's payout, so the cash on the table still goes to the players. With
  // no holder named the bank is holding it, and nothing moves.
  const rakeAmount = session.rakeAmount ?? 0;
  const rakeHolderName = session.rakeHolder || bankPlayer.name;
  const rake = rakeAmount > 0
    ? { amount: rakeAmount, holderName: rakeHolderName, holderIsBank: rakeHolderName === bankPlayer.name }
    : null;

  // Bank buy-ins were transferred to the collector on the night, so the
  // collector owes them to the banker — the mirror image of the rake.
  const collectedAmount = roundCents(settlements.reduce((sum, s) => sum + s.bankBuyIn, 0));
  const collectorName = session.creditCollector || null;
  const collected = collectedAmount > 0
    ? { amount: collectedAmount, collectorName, collectorIsBank: collectorName === bankPlayer.name }
    : null;
  const cashToCollect = settlements.reduce((sum, s) => sum + s.cashBuyIn, 0);
  const cashToDistribute = nonBankSettlements.reduce((sum, s) => sum + s.cashReceived, 0);

  return {
    bankPlayerId: bankId,
    bankPlayerName: bankPlayer.name,
    settlements,
    cashToCollect,
    cashToDistribute,
    bankTransfersOut: nonBankSettlements.reduce((sum, s) => sum + s.bankReceived, 0)
      + (rake && !rake.holderIsBank ? rake.amount : 0),
    bankTransfersIn: nonBankSettlements.reduce((sum, s) => sum + s.bankOwed + s.changeOwed, 0)
      + (collected && !collected.collectorIsBank ? collected.amount : 0),
    rake,
    collected,
    cashMode: getCashMode(session, bankId),
    cashLeft: roundCents(cashToCollect - cashToDistribute),
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