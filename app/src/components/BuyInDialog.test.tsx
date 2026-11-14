import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BuyInDialog, type BuyInDetails } from './BuyInDialog';
import type { Player } from '../types';

const player = (buyIns: number): Player => ({
  id: 'p1', name: 'Leo', paymentMethod: 'cash', cashOut: null,
  buyIns: Array.from({ length: buyIns }, (_, i) => ({ id: `b${i}`, amount: 100, method: 'credit' as const, timestamp: 0, notes: '' })),
});

function renderIt(p: Player, props: { initialAmount?: number } = {}) {
  const onSubmit = vi.fn<(d: BuyInDetails) => Promise<boolean>>(async () => true);
  render(<BuyInDialog player={p} initialMethod="cash" onSubmit={onSubmit} onCancel={() => {}} {...props} />);
  return onSubmit;
}

describe('BuyInDialog', () => {
  it('offers Credit for a custom amount', async () => {
    const onSubmit = renderIt(player(0));
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Credit' }));
    await user.type(screen.getByLabelText('Amount'), '250');
    await user.click(screen.getByRole('button', { name: 'Add $250.00 credit' }));

    expect(onSubmit).toHaveBeenCalledWith({ amount: 250, method: 'credit', rebuy: {} });
  });

  it('a first buy-in is not asked top-up or stacked', () => {
    renderIt(player(0));
    expect(screen.queryByRole('button', { name: 'Top-up' })).not.toBeInTheDocument();
  });

  it('a rebuy defaults to a top-up and takes an optional note', async () => {
    const onSubmit = renderIt(player(1), { initialAmount: 100 });
    const user = userEvent.setup();

    expect(screen.getByRole('button', { name: 'Top-up' })).toHaveAttribute('aria-pressed', 'true');
    await user.type(screen.getByLabelText('Note (optional)'), 'shoved light');
    await user.click(screen.getByRole('button', { name: 'Add $100.00 cash' }));

    expect(onSubmit).toHaveBeenCalledWith({
      amount: 100, method: 'cash', rebuy: { isRebuy: true, rebuyType: 'top-up', stackedHand: 'shoved light' },
    });
  });

  it('a stacked rebuy needs no note', async () => {
    const onSubmit = renderIt(player(1), { initialAmount: 100 });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Got stacked' }));
    await user.click(screen.getByRole('button', { name: 'Add $100.00 cash' }));

    expect(onSubmit).toHaveBeenCalledWith({ amount: 100, method: 'cash', rebuy: { isRebuy: true, rebuyType: 'stacked' } });
  });

  it('will not add without an amount', () => {
    renderIt(player(0));
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
  });
});
