import { describe, it, expect } from 'vitest';
import { getSessionTotals, getSettlementSummary } from './calculations';
import type { Session } from '../types';

// Daniel H banks: $200 in, $1,415 out. Simon loses $820. Rake of $133 was taken
// off the table, so the pot balances only once it is counted.
function session(over: Partial<Session> = {}): Session {
  return {
    id: 's1',
    createdAt: 0,
    updatedAt: 0,
    date: '2026-09-16',
    status: 'completed',
    bankPlayerId: 'p-daniel',
    notes: 'Warm up sesh',
    gameType: 'in-person',
    discordThreadId: null,
    settledAt: null,
    settledBy: null,
    rakeAmount: 133,
    rakeHolder: null,
    players: [
      {
        id: 'p-daniel', name: 'Daniel H', paymentMethod: 'cash', cashOut: { amount: 1415, timestamp: 0 },
        buyIns: [{ id: 'b1', amount: 200, method: 'cash', timestamp: 0, notes: '' }],
      },
      {
        id: 'p-simon', name: 'Simon', paymentMethod: 'cash', cashOut: { amount: 1180, timestamp: 0 },
        buyIns: [{ id: 'b2', amount: 2000, method: 'cash', timestamp: 0, notes: '' }],
      },
      {
        id: 'p-leo', name: 'Leo', paymentMethod: 'bank', cashOut: { amount: 472, timestamp: 0 },
        buyIns: [{ id: 'b3', amount: 1000, method: 'bank', timestamp: 0, notes: '' }],
      },
    ],
    ...over,
  } as Session;
}

describe('getSessionTotals with rake', () => {
  it('counts rake as part of the pot leaving the table', () => {
    // $3,200 in; $3,067 cashed out; $133 raked. That balances.
    const totals = getSessionTotals(session());
    expect(totals.totalPot).toBe(3200);
    expect(totals.totalCashOut).toBe(3067);
    expect(totals.rake).toBe(133);
    expect(totals.isBalanced).toBe(true);
  });

  it('a session that is genuinely short is still reported as short', () => {
    const totals = getSessionTotals(session({ rakeAmount: 100 }));
    expect(totals.isBalanced).toBe(false);
  });

  it('no rake behaves exactly as before', () => {
    const noRake = session({ rakeAmount: 0, players: session().players.map((p) =>
      p.id === 'p-leo' ? { ...p, cashOut: { amount: 605, timestamp: 0 } } : p) });
    const totals = getSessionTotals(noRake);
    expect(totals.rake).toBe(0);
    expect(totals.isBalanced).toBe(true);
  });
});

describe('getSettlementSummary with rake', () => {
  it('the banker owes the rake to whoever holds it', () => {
    const summary = getSettlementSummary(session({ rakeHolder: 'Stephen' }))!;
    expect(summary.rake).toEqual({ amount: 133, holderName: 'Stephen', holderIsBank: false });
    // The rake is a transfer out of the bank, on top of the winners' money.
    expect(summary.bankTransfersOut).toBeCloseTo(133 + summary.settlements
      .filter((s) => s.playerId !== summary.bankPlayerId)
      .reduce((sum, s) => sum + s.bankReceived, 0), 2);
  });

  it('the banker holding it themselves moves no money', () => {
    const summary = getSettlementSummary(session({ rakeHolder: 'Daniel H' }))!;
    expect(summary.rake).toEqual({ amount: 133, holderName: 'Daniel H', holderIsBank: true });
    const toWinners = summary.settlements
      .filter((s) => s.playerId !== summary.bankPlayerId)
      .reduce((sum, s) => sum + s.bankReceived, 0);
    expect(summary.bankTransfersOut).toBeCloseTo(toWinners, 2);
  });

  it('with no holder named, the banker is holding it', () => {
    const summary = getSettlementSummary(session())!;
    expect(summary.rake).toEqual({ amount: 133, holderName: 'Daniel H', holderIsBank: true });
  });

  it('no rake means no rake line at all', () => {
    const summary = getSettlementSummary(session({ rakeAmount: 0 }))!;
    expect(summary.rake).toBeNull();
  });

  it('players are settled the same whether or not rake was taken', () => {
    // Rake comes off the table before anyone is paid, so it must not change
    // what the players owe each other.
    const withRake = getSettlementSummary(session({ rakeHolder: 'Stephen' }))!;
    const withoutRake = getSettlementSummary(session({ rakeAmount: 0 }))!;
    expect(withRake.settlements).toEqual(withoutRake.settlements);
  });
});
