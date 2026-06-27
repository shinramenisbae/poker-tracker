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
});
