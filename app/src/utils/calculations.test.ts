import { describe, it, expect } from 'vitest';
import { getSessionTotals, getSettlementSummary, getLiveBalance, getOwedBuyIn, isNewPlayer } from './calculations';
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

// While stacks are being counted: rake is entered alongside the cash-outs, so
// the live page can say whether the night adds up before anyone ends it.
describe('getLiveBalance', () => {
  it('square once every stack and the rake are counted', () => {
    // $3,200 in = $3,067 cashed out + $133 rake.
    expect(getLiveBalance(session({ status: 'active' }))).toEqual({ state: 'balanced' });
  });

  it('short when less came off the table than went in', () => {
    // Rake not entered yet: $133 unaccounted for.
    expect(getLiveBalance(session({ status: 'active', rakeAmount: 0 }))).toEqual({ state: 'short', by: 133 });
  });

  it('over when more came off the table than went in', () => {
    expect(getLiveBalance(session({ status: 'active', rakeAmount: 150 }))).toEqual({ state: 'over', by: 17 });
  });

  it('still playing while anyone has chips on the table', () => {
    const s = session({ status: 'active' });
    s.players[2] = { ...s.players[2], cashOut: null };
    // Leo's $1,000 is still in play: $3,200 − ($2,595 + $133).
    expect(getLiveBalance(s)).toEqual({ state: 'playing', onTable: 472 });
  });

  it('cents do not show up as a false difference', () => {
    const s = session({ status: 'active', rakeAmount: 0 });
    s.players = [
      { ...s.players[0], buyIns: [{ id: 'x', amount: 0.1, method: 'cash', timestamp: 0, notes: '' }, { id: 'y', amount: 0.2, method: 'cash', timestamp: 0, notes: '' }], cashOut: { amount: 0.3, timestamp: 0 } },
    ];
    expect(getLiveBalance(s)).toEqual({ state: 'balanced' });
  });

  it('a session with nobody in it yet is just playing', () => {
    expect(getLiveBalance(session({ status: 'active', players: [], rakeAmount: 0 }))).toEqual({ state: 'playing', onTable: 0 });
  });
});

// Leo is at his $500 limit and topped up $300 more, paid to Stephen on the
// spot. Daniel H banks: $200 cash in, $1,000 out.
function creditSession(over: Partial<Session> = {}): Session {
  return session({
    rakeAmount: 0,
    creditLimit: 500,
    creditCollector: 'Stephen',
    players: [
      {
        id: 'p-daniel', name: 'Daniel H', paymentMethod: 'cash', cashOut: { amount: 1000, timestamp: 0 },
        buyIns: [{ id: 'b1', amount: 200, method: 'cash', timestamp: 0, notes: '' }],
      },
      {
        id: 'p-leo', name: 'Leo', paymentMethod: 'bank', cashOut: { amount: 0, timestamp: 0 },
        buyIns: [
          { id: 'b2', amount: 500, method: 'bank', timestamp: 0, notes: '' },
          { id: 'b3', amount: 300, method: 'prepaid', timestamp: 0, notes: '' },
        ],
      },
    ],
    ...over,
  });
}

describe('getSettlementSummary with buy-ins paid up front', () => {
  it('the player owes the banker only what was on credit', () => {
    const leo = getSettlementSummary(creditSession())!.settlements.find((s) => s.playerId === 'p-leo')!;
    expect(leo.bankOwed).toBe(500);
    expect(leo.prepaidBuyIn).toBe(300);
    expect(leo.profitLoss).toBe(-800);
  });

  it('the collector owes the banker what was paid up front', () => {
    const summary = getSettlementSummary(creditSession())!;
    expect(summary.prepaid).toEqual({ amount: 300, collectorName: 'Stephen', collectorIsBank: false });
    expect(summary.bankTransfersIn).toBe(800);
  });

  it('the money adds up: cash + transfers in pay the banker out', () => {
    const summary = getSettlementSummary(creditSession())!;
    const daniel = summary.settlements.find((s) => s.playerId === 'p-daniel')!;
    expect(summary.cashToCollect + summary.bankTransfersIn).toBe(daniel.cashReceived + 800);
    expect(summary.cashToCollect + summary.bankTransfersIn).toBe(1000);
  });

  it('nothing moves when the collector is banking', () => {
    const summary = getSettlementSummary(creditSession({ creditCollector: 'Daniel H' }))!;
    expect(summary.prepaid).toEqual({ amount: 300, collectorName: 'Daniel H', collectorIsBank: true });
    expect(summary.bankTransfersIn).toBe(500);
  });

  it('no prepaid line when nobody went over', () => {
    expect(getSettlementSummary(session())!.prepaid).toBeNull();
  });
});

describe('credit', () => {
  it('only bank buy-ins are owed', () => {
    const leo = creditSession().players[1];
    expect(getOwedBuyIn(leo)).toBe(500);
  });

  it('a name never seen in another session is new, whatever its case', () => {
    const other = creditSession({ id: 's2' });
    expect(isNewPlayer('Newbie', 's1', [creditSession(), other])).toBe(true);
    expect(isNewPlayer('leo ', 's1', [creditSession(), other])).toBe(false);
    expect(isNewPlayer('Leo', 's1', [creditSession()])).toBe(true);
  });
});
