import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CashPayouts } from './CashPayouts';
import { getSettlementSummary } from '../utils/calculations';
import type { BuyInMethod, Player, Session } from '../types';

const player = (id: string, cashOut: number, buyIns: [number, BuyInMethod][], cashPaid?: number): Player => ({
  id, name: id, paymentMethod: 'cash', cashPaid, cashOut: { amount: cashOut, timestamp: 0 },
  buyIns: buyIns.map(([amount, method], i) => ({ id: `${id}${i}`, amount, method, timestamp: 0, notes: '' })),
});

const session = (players: Player[]) => ({
  id: 's1', createdAt: 0, updatedAt: 0, date: '2026-11-06', status: 'completed', bankPlayerId: 'Leo', notes: '',
  gameType: 'in-person', discordThreadId: null, settledAt: null, settledBy: null, rakeAmount: 0, rakeHolder: null,
  creditLimit: 500, creditCollector: 'Nick', cashInFifties: 1, players,
} as Session);

// Simon is owed $495 and brought cash; Jeremy is owed $190 on credit. Nick lost.
const players = (simonCash?: number) => [
  player('Leo', 800, [[250, 'credit']]),
  player('Simon', 495, [[100, 'cash']], simonCash),
  player('Jeremy', 690, [[500, 'credit']]),
  player('Nick', 0, [[400, 'credit'], [400, 'cash']]),
];

function renderIt(list: Player[], onSave = vi.fn<(amounts: Record<string, number>) => Promise<{ discord?: { ok: boolean; error?: string } }>>(async () => ({}))) {
  render(<CashPayouts summary={getSettlementSummary(session(list))!} onSave={onSave} />);
  return onSave;
}

const row = (name: string) => within(screen.getByTestId(`cash-${name}`));

describe('CashPayouts', () => {
  it('starts from a suggestion: cash back for whoever bought in with cash', () => {
    renderIt(players());
    expect(row('Simon').getByText('$500')).toBeInTheDocument();
    expect(row('Simon').getByText(/transfers \$5\.00 back/)).toBeInTheDocument();
    expect(row('Jeremy').getByText('$0')).toBeInTheDocument();
    expect(row('Jeremy').getByText(/gets \$190\.00 by transfer/)).toBeInTheDocument();
    expect(screen.getByText(/not saved yet/)).toBeInTheDocument();
  });

  it('does not offer cash to the banker or to anyone who owes the banker', () => {
    renderIt(players());
    expect(screen.queryByTestId('cash-Leo')).not.toBeInTheDocument();
    expect(screen.queryByTestId('cash-Nick')).not.toBeInTheDocument();
  });

  it('steps in $50s, reworks the transfer, and saves every amount', async () => {
    const onSave = renderIt(players());
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: '$50 more cash for Jeremy' }));
    await user.click(screen.getByRole('button', { name: '$50 more cash for Jeremy' }));
    expect(row('Jeremy').getByText('$100')).toBeInTheDocument();
    expect(row('Jeremy').getByText(/gets \$90\.00 by transfer/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save cash payouts' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ Simon: 500, Jeremy: 100 }));
  });

  it('shows what is left, and warns but does not block when too much goes out', async () => {
    renderIt(players());
    const user = userEvent.setup();

    expect(screen.getByTestId('cash-totals')).toHaveTextContent('$500.00 cash collected, $500.00 handed out, $0.00 left with Leo');
    await user.click(screen.getByRole('button', { name: '$50 more cash for Jeremy' }));

    expect(screen.getByTestId('cash-over')).toHaveTextContent('$50.00 more cash than was collected');
    expect(screen.getByRole('button', { name: 'Save cash payouts' })).toBeEnabled();
  });

  it('once saved, shows what was saved and offers no save until it changes', async () => {
    renderIt(players(450));
    const user = userEvent.setup();

    expect(row('Simon').getByText('$450')).toBeInTheDocument();
    expect(row('Jeremy').getByText('$0')).toBeInTheDocument();
    expect(screen.getByText(/Recorded/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save cash payouts' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '$50 more cash for Simon' }));
    expect(screen.getByRole('button', { name: 'Save cash payouts' })).toBeInTheDocument();
  });

  it('says so when saved but Discord could not be updated', async () => {
    renderIt(players(), vi.fn(async () => ({ discord: { ok: false, error: 'bot down' } })));
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Save cash payouts' }));
    expect(await screen.findByText(/could not be updated: bot down/)).toBeInTheDocument();
  });
});
