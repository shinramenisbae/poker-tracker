import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CashOutModal } from './CashOutModal';

const noop = () => {};

describe('CashOutModal', () => {
  it('opens blank for a first cash-out', () => {
    render(
      <CashOutModal playerName="Alvin" currentBuyIn={150} onConfirm={noop} onCancel={noop} />
    );
    expect(screen.getByRole('spinbutton')).toHaveValue(null);
    expect(screen.getByText(/^Cash Out/)).toBeInTheDocument();
  });

  // The reported bug: "Edit Cash Out" opened an empty field over stale data, so
  // the stored amount was invisible and had to be retyped from memory.
  it('pre-fills the stored amount when editing an existing cash-out', () => {
    render(
      <CashOutModal
        playerName="Alvin"
        currentBuyIn={150}
        initialAmount={220}
        onConfirm={noop}
        onCancel={noop}
      />
    );
    expect(screen.getByRole('spinbutton')).toHaveValue(220);
    expect(screen.getByText(/Edit Cash Out/)).toBeInTheDocument();
    expect(screen.getByText(/Currently cashed out for/)).toBeInTheDocument();
  });

  it('pre-fills a $0 cash-out rather than treating it as unset', () => {
    render(
      <CashOutModal
        playerName="Simon"
        currentBuyIn={100}
        initialAmount={0}
        onConfirm={noop}
        onCancel={noop}
      />
    );
    expect(screen.getByRole('spinbutton')).toHaveValue(0);
    expect(screen.getByText(/Edit Cash Out/)).toBeInTheDocument();
  });

  it('submits the edited amount', async () => {
    const onConfirm = vi.fn();
    render(
      <CashOutModal
        playerName="Alvin"
        currentBuyIn={150}
        initialAmount={220}
        onConfirm={onConfirm}
        onCancel={noop}
      />
    );
    const input = screen.getByRole('spinbutton');
    await userEvent.clear(input);
    await userEvent.type(input, '275');
    await userEvent.click(screen.getByRole('button', { name: /Confirm/ }));
    expect(onConfirm).toHaveBeenCalledWith(275);
  });

  // The page's error banner renders behind this fixed overlay, so a failed save
  // used to be invisible — indistinguishable from "it saved but didn't update".
  it('shows a save error inside the modal', () => {
    render(
      <CashOutModal
        playerName="Alvin"
        currentBuyIn={150}
        initialAmount={220}
        onConfirm={noop}
        onCancel={noop}
        error="Failed to cash out player. Please try again."
      />
    );
    expect(screen.getByText(/Failed to cash out player/)).toBeInTheDocument();
  });

  it('de-duplicates quick amounts when the buy-in is $0', () => {
    render(
      <CashOutModal playerName="Nick" currentBuyIn={0} onConfirm={noop} onCancel={noop} />
    );
    // 0, 0 and 0 collapse to a single shortcut instead of three duplicate keys.
    expect(screen.getAllByRole('button', { name: '$0.00' })).toHaveLength(1);
  });
});
