import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ActionButtons } from './ActionButtons';
import type { ActionOption } from '../../trainer/types';

const ACTIONS: ActionOption[] = [
  { kind: 'fold', label: 'Fold', bucket: 'fold', covers: ['fold'] },
  { kind: 'call', label: 'Call 2.5bb', bucket: 'call', covers: ['call'] },
  { kind: 'raise', label: '3-bet to 7.5bb', bucket: 'raise', covers: ['raise', 'allin'] },
];

describe('ActionButtons', () => {
  it('renders one button per legal action with its concrete label', () => {
    render(<ActionButtons actions={ACTIONS} disabled={false} onChoose={() => {}} />);
    expect(screen.getByRole('button', { name: /Fold/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /3-bet to 7.5bb/ })).toBeInTheDocument();
  });

  it('calls onChoose with the chosen bucket', async () => {
    const onChoose = vi.fn();
    render(<ActionButtons actions={ACTIONS} disabled={false} onChoose={onChoose} />);
    await userEvent.click(screen.getByRole('button', { name: /3-bet to 7.5bb/ }));
    expect(onChoose).toHaveBeenCalledWith('raise');
  });

  it('disables buttons when disabled', () => {
    render(<ActionButtons actions={ACTIONS} disabled onChoose={() => {}} />);
    expect(screen.getByRole('button', { name: /Fold/ })).toBeDisabled();
  });
});
