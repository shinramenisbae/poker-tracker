import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PokerTable } from './PokerTable';
import { ActionHistoryStrip } from './ActionHistoryStrip';
import { generateSpot } from '../../trainer/engine/spotGenerator';

describe('PokerTable + strip', () => {
  it('renders the pot, hero seat, and the action strip', () => {
    const spot = generateSpot({ category: 'vs-open' }, () => 0.3);
    render(<div><PokerTable spot={spot} /><ActionHistoryStrip spot={spot} /></div>);
    expect(screen.getByText(/Pot/i)).toBeInTheDocument();
    expect(screen.getAllByText('YOU').length).toBeGreaterThan(0);
  });

  it('renders the hero hole cards below the felt under a "Your hand" label', () => {
    const spot = generateSpot({ category: 'vs-open' }, () => 0.3);
    render(<PokerTable spot={spot} />);
    expect(screen.getByText(/Your hand/i)).toBeInTheDocument();
  });

  it('draws a bet chip for the open in a vs-open spot', () => {
    const spot = generateSpot({ category: 'vs-open' }, () => 0.3);
    render(<PokerTable spot={spot} />);
    // The opener committed 2.5bb — a chip sprite shows that amount.
    expect(screen.getAllByText('2.5').length).toBeGreaterThan(0);
  });
});
