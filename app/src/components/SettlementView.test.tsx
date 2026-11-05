import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SettlementView } from './SettlementView';
import { getSettlementSummary } from '../utils/calculations';
import type { Session } from '../types';

// Daniel H banks. Leo owed his $500 limit and transferred Stephen $300 more up front.
function session(over: Partial<Session> = {}): Session {
  return {
    id: 's1', createdAt: 0, updatedAt: 0, date: '2026-11-06', status: 'completed',
    bankPlayerId: 'p-daniel', notes: '', gameType: 'in-person', discordThreadId: null,
    settledAt: null, settledBy: null, rakeAmount: 0, rakeHolder: null,
    creditLimit: 500, creditCollector: 'Stephen',
    players: [
      {
        id: 'p-daniel', name: 'Daniel H', paymentMethod: 'cash', cashOut: { amount: 1000, timestamp: 0 },
        buyIns: [{ id: 'b1', amount: 200, method: 'cash', timestamp: 0, notes: '' }],
      },
      {
        id: 'p-leo', name: 'Leo', paymentMethod: 'bank', cashOut: { amount: 0, timestamp: 0 },
        buyIns: [
          { id: 'b2', amount: 500, method: 'credit', timestamp: 0, notes: '' },
          { id: 'b3', amount: 300, method: 'bank', timestamp: 0, notes: '' },
        ],
      },
    ],
    ...over,
  };
}

describe('SettlementView: bank buy-ins', () => {
  it('Stephen passes what he collected on to the banker', () => {
    render(<SettlementView summary={getSettlementSummary(session())!} />);

    expect(screen.getByTestId('collected-transfer')).toHaveTextContent(
      'Stephen transfers $300.00 bank to Daniel H — bank buy-ins');
    expect(screen.getByText('Already transferred $300.00 to Stephen')).toBeInTheDocument();
    expect(screen.getByText(/Leo transfers/).parentElement).toHaveTextContent('Leo transfers $500.00 bank to Daniel H');
  });

  it('nothing to transfer when the collector is banking', () => {
    render(<SettlementView summary={getSettlementSummary(session({ creditCollector: 'Daniel H' }))!} />);

    expect(screen.queryByTestId('collected-transfer')).not.toBeInTheDocument();
    expect(screen.getByTestId('collected-summary')).toHaveTextContent('who is banking, so it stays put');
  });

  it('says who transfers the change back when cash was rounded up', () => {
    const s = session();
    s.players[1] = { ...s.players[1], cashOut: { amount: 995, timestamp: 0 }, cashPaid: 500 };
    render(<SettlementView summary={getSettlementSummary(s)!} />);

    expect(screen.getByText(/Leo transfers/, { selector: 'span' }).parentElement).toHaveTextContent('Leo transfers $5.00 back to Daniel H');
  });
});
