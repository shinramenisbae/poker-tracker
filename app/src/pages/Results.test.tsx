import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Results } from './Results';

const session = {
  id: 's1', date: '2026-09-16', status: 'completed', notes: 'Warm up sesh',
  bankPlayerId: 's1-leo', gameType: 'in-person', createdAt: '2026-09-16T04:00:00.000Z',
  updatedAt: '2026-09-16T12:00:00.000Z', discordThreadId: null, settledAt: null, settledBy: null,
  players: [
    {
      id: 's1-leo', sessionId: 's1', name: 'Leo', paymentMethod: 'cash', cashOutAmount: 583,
      cashOutDate: '2026-09-16T11:30:00.000Z', cashOut: { amount: 583, timestamp: 1789557000000 },
      buyIns: [{ id: 'b1', playerId: 's1-leo', amount: 600, timestamp: '2026-09-16T05:00:00.000Z', isRebuy: 0, method: 'cash' }],
    },
  ],
};

function renderResults(state?: unknown) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/session/s1/results', state }]}>
      <Routes><Route path="/session/:id/results" element={<Results />} /></Routes>
    </MemoryRouter>
  );
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('Results', () => {
  it('reports what was merged when the session was ended', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(session), { status: 200 })));

    renderResults({ merges: [{ name: 'Leo', keepId: 's1-leo', entries: 2, totalBuyIn: 600, totalCashOut: 583 }] });

    await waitFor(() => expect(screen.getByText(/Merged Leo's 2 entries/)).toBeInTheDocument());
    expect(screen.getByText(/\$600\.00 in, \$583\.00 out/)).toBeInTheDocument();
  });

  it('says nothing when nothing merged', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(session), { status: 200 })));

    renderResults();

    await waitFor(() => expect(screen.getByText('Session Summary')).toBeInTheDocument());
    expect(screen.queryByText(/Merged/)).not.toBeInTheDocument();
  });
});
