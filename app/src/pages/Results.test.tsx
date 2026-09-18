import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Results } from './Results';

const player = (id: string, name: string, buyIn: number, cashOut: number | null) => ({
  id, sessionId: 's1', name, paymentMethod: 'cash',
  cashOutAmount: cashOut, cashOutDate: cashOut == null ? null : '2026-09-16T11:30:00.000Z',
  cashOut: cashOut == null ? null : { amount: cashOut, timestamp: 1789557000000 },
  buyIns: [{ id: `b-${id}`, playerId: id, amount: buyIn, timestamp: '2026-09-16T05:00:00.000Z', isRebuy: 0, method: 'cash' }],
});

const session = (over: Record<string, unknown> = {}) => ({
  id: 's1', date: '2026-09-16', status: 'completed', notes: 'Warm up sesh',
  bankPlayerId: 's1-daniel', gameType: 'in-person', createdAt: '2026-09-16T04:00:00.000Z',
  updatedAt: '2026-09-16T12:00:00.000Z', discordThreadId: null, settledAt: null, settledBy: null,
  rakeAmount: 0, rakeHolder: null,
  players: [
    player('s1-daniel', 'Daniel H', 200, 1415),
    player('s1-stephen', 'Stephen', 100, 300),
    player('s1-leo', 'Leo', 600, 583),
  ],
  ...over,
});

/** Serves the URLs given; anything else 404s. */
function stubApi(routes: Record<string, unknown>) {
  const fetchMock = vi.fn(async (url: string) => {
    if (!(url in routes)) return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
    return new Response(JSON.stringify(routes[url]), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderResults(state?: unknown) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/session/s1/results', state }]}>
      <Routes><Route path="/session/:id/results" element={<Results />} /></Routes>
    </MemoryRouter>
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Results', () => {
  it('reports what was merged when the session was ended', async () => {
    stubApi({ '/api/sessions/s1': session(), '/api/sessions/s1/payments': { paid: {} } });

    renderResults({ merges: [{ name: 'Leo', keepId: 's1-leo', entries: 2, totalBuyIn: 600, totalCashOut: 583 }] });

    await waitFor(() => expect(screen.getByText(/Merged Leo's 2 entries/)).toBeInTheDocument());
    expect(screen.getByText(/\$600\.00 in, \$583\.00 out/)).toBeInTheDocument();
  });

  it('says nothing when nothing merged', async () => {
    stubApi({ '/api/sessions/s1': session(), '/api/sessions/s1/payments': { paid: {} } });

    renderResults();

    await waitFor(() => expect(screen.getByText('Session Summary')).toBeInTheDocument());
    expect(screen.queryByText(/Merged/)).not.toBeInTheDocument();
  });

  // The feature: the biggest winner banks by default, and sometimes that should
  // be a regular instead.
  it('hands the banking to another player', async () => {
    const fetchMock = stubApi({
      '/api/sessions/s1': session(),
      '/api/sessions/s1/payments': { paid: {} },
      '/api/sessions/s1/banker': { ...session({ bankPlayerId: 's1-stephen' }), discord: { ok: true } },
    });

    renderResults();
    await waitFor(() => expect(screen.getByRole('button', { name: /change banker/i })).toBeEnabled());

    await userEvent.click(screen.getByRole('button', { name: /change banker/i }));
    await userEvent.click(await screen.findByRole('button', { name: /Stephen/ }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => url === '/api/sessions/s1/banker');
      expect(call).toBeDefined();
      expect(call?.[1]).toMatchObject({ method: 'PUT', body: JSON.stringify({ playerId: 's1-stephen' }) });
    });
  });

  it('shows the rake and who is holding it', async () => {
    stubApi({
      '/api/sessions/s1': session({ rakeAmount: 133, rakeHolder: 'Stephen' }),
      '/api/sessions/s1/payments': { paid: {} },
    });

    renderResults();

    const rakeLine = await screen.findByText(/🧾 Rake:/);
    expect(rakeLine).toHaveTextContent('$133.00');
    expect(rakeLine).toHaveTextContent('held by Stephen');
  });

  it('corrects a mistyped rake', async () => {
    const fetchMock = stubApi({
      '/api/sessions/s1': session({ rakeAmount: 133, rakeHolder: 'Stephen' }),
      '/api/sessions/s1/payments': { paid: {} },
      '/api/sessions/s1/rake': { ...session({ rakeAmount: 143, rakeHolder: 'Stephen' }), rake: { total: 884.5, holders: [] } },
    });

    renderResults();
    await waitFor(() => expect(screen.getByRole('button', { name: /edit rake/i })).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /edit rake/i }));
    const amount = await screen.findByLabelText(/rake amount/i);
    await userEvent.clear(amount);
    await userEvent.type(amount, '143');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => url === '/api/sessions/s1/rake');
      expect(call).toBeDefined();
      expect(call?.[1]).toMatchObject({ method: 'PUT' });
      expect(JSON.parse(String((call?.[1] as RequestInit).body))).toEqual({ amount: 143, holder: 'Stephen' });
    });
  });

  it('refuses to move the banking once someone has paid, and says why', async () => {
    stubApi({
      '/api/sessions/s1': session(),
      '/api/sessions/s1/payments': { paid: { Leo: { paidAt: '2026-09-17T09:00:00.000Z', paidBy: 'Leo' } } },
    });

    renderResults();

    await waitFor(() => expect(screen.getByRole('button', { name: /change banker/i })).toBeDisabled());
    expect(screen.getByText(/already paid/i)).toBeInTheDocument();
  });
});
