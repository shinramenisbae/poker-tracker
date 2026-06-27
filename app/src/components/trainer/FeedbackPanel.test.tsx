import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FeedbackPanel } from './FeedbackPanel';
import { generateSpot } from '../../trainer/engine/spotGenerator';
import { grade } from '../../trainer/engine/grader';

function setup(chosen: 'fold' | 'call' | 'raise') {
  const spot = generateSpot({ category: 'vs-open' }, () => 0.2);
  const result = grade(spot.legalActions, spot.strategy, chosen);
  return { spot, result };
}

describe('FeedbackPanel', () => {
  it('shows the tier verdict and a Next button', () => {
    const { spot, result } = setup('raise');
    render(<FeedbackPanel spot={spot} result={result} onNext={() => {}} stats={{ accuracyPct: 80, streak: 4 }} />);
    expect(screen.getByText(/Best|Correct|Inaccuracy|Mistake/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Next/i })).toBeInTheDocument();
  });

  it('range chart is collapsed until toggled', async () => {
    const { spot, result } = setup('call');
    const { container } = render(<FeedbackPanel spot={spot} result={result} onNext={() => {}} stats={{ accuracyPct: 50, streak: 0 }} />);
    expect(container.querySelectorAll('[data-hand]').length).toBe(0);
    await userEvent.click(screen.getByRole('button', { name: /Show full range/i }));
    expect(container.querySelectorAll('[data-hand]').length).toBe(169);
  });
});
