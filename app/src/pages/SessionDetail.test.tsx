import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SessionDetail } from './SessionDetail';

const player = (id: string, name: string, buyIn: number, cashOut: number | null) => ({
  id, sessionId: 's1', name, paymentMethod: 'cash',
  cashOutAmount: cashOut, cashOutDate: cashOut == null ? null : '2026-09-28T11:30:00.000Z',
  cashOut: cashOut == null ? null : { amount: cashOut, timestamp: 1790508600000 },
  buyIns: [{ id: `b-${id}`, playerId: id, amount: buyIn, timestamp: '2026-09-28T05:00:00.000Z', isRebuy: 0, method: 'cash' }],
});

// $500 in; the stacks count to $465, so $35 went to the rake.
const session = (over: Record<string, unknown> = {}) => ({
  id: 's1', date: '2026-09-28', status: 'active', notes: 'Friday night',
  bankPlayerId: null, gameType: 'in-person', createdAt: '2026-09-28T04:00:00.000Z',
  updatedAt: '2026-09-28T12:00:00.000Z', discordThreadId: null, settledAt: null, settledBy: null,
  rakeAmount: 0, rakeHolder: null,
  players: [player('s1-jeremy', 'Jeremy', 200, 260), player('s1-simon', 'Simon', 300, 205)],
  ...over,
});

/** Serves the URLs given; anything else 404s. Records every request. */
function stubApi(routes: Record<string, unknown>) {
  const fetchMock = vi.fn(async (url: string) => {
    if (!(url in routes)) return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
    return new Response(JSON.stringify(routes[url]), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const bodyOf = (fetchMock: ReturnType<typeof stubApi>, url: string) => {
  const call = fetchMock.mock.calls.find(([u]) => u === url) as [string, RequestInit] | undefined;
  return call ? JSON.parse(String(call[1].body)) : undefined;
};

function renderLive(state?: unknown) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/session/s1', state }]}>
      <Routes>
        <Route path="/session/:id" element={<SessionDetail />} />
        <Route path="/session/:id/results" element={<p>Results page</p>} />
      </Routes>
    </MemoryRouter>
  );
}

const balanceCell = () => within(screen.getByTestId('live-balance'));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SessionDetail: rake counted with the stacks', () => {
  it('shows the pot $35 short until the rake is entered, then balanced', async () => {
    const fetchMock = stubApi({
      '/api/sessions/s1': session(),
      '/api/sessions/s1/rake': { ...session({ rakeAmount: 35 }), rake: { total: 35, holders: [] } },
    });
    const user = userEvent.setup();

    renderLive();
    await waitFor(() => expect(balanceCell().getByText('Short — missing')).toBeInTheDocument());
    expect(balanceCell().getByText('$35.00')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Amount'), '35');
    await user.click(screen.getByRole('button', { name: 'Save rake' }));

    await waitFor(() => expect(balanceCell().getByText('Balanced')).toBeInTheDocument());
    // An empty "Held by" is sent as nobody, so it follows the banker.
    expect(bodyOf(fetchMock, '/api/sessions/s1/rake')).toEqual({ amount: 35, holder: null });
  });

  it('while someone still has chips, the gap is money on the table, not an error', async () => {
    stubApi({
      '/api/sessions/s1': session({ players: [player('s1-jeremy', 'Jeremy', 200, 260), player('s1-simon', 'Simon', 300, null)] }),
    });

    renderLive();

    await waitFor(() => expect(balanceCell().getByText('Still on the table')).toBeInTheDocument());
    expect(screen.queryByText(/Short/)).not.toBeInTheDocument();
  });

  it('End Session confirms the saved rake and ends with it, sending none of its own', async () => {
    const fetchMock = stubApi({
      '/api/sessions/s1': session({ rakeAmount: 35, rakeHolder: 'Jeremy' }),
      '/api/sessions/s1/end': {
        ...session({ status: 'completed', rakeAmount: 35, rakeHolder: 'Jeremy', bankPlayerId: 's1-jeremy' }),
        merges: [], rake: { amount: 35, holder: 'Jeremy', convertedFromPlayer: false, discardedPlayerAmount: null },
      },
    });
    const user = userEvent.setup();

    renderLive();
    await waitFor(() => expect(screen.getByRole('button', { name: 'End Session' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'End Session' }));

    expect(screen.getByText(/held by Jeremy/)).toBeInTheDocument();
    expect(screen.getByText('✓ The pot balances.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Rake')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'End session' }));

    await waitFor(() => expect(screen.getByText('Results page')).toBeInTheDocument());
    expect(bodyOf(fetchMock, '/api/sessions/s1/end')).toEqual({});
  });

  it('a pot that is off is flagged, but the session can still end', async () => {
    stubApi({ '/api/sessions/s1': session() });
    const user = userEvent.setup();

    renderLive();
    await waitFor(() => expect(screen.getByRole('button', { name: 'End Session' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'End Session' }));

    expect(screen.getByText('No rake entered')).toBeInTheDocument();
    expect(screen.getByText(/The pot is short by \$35\.00/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'End session' })).toBeEnabled();
  });

  it('a rake typed but not saved is saved before the end-of-session check', async () => {
    const fetchMock = stubApi({
      '/api/sessions/s1': session(),
      '/api/sessions/s1/rake': { ...session({ rakeAmount: 35 }), rake: { total: 35, holders: [] } },
    });
    const user = userEvent.setup();

    renderLive();
    await waitFor(() => expect(screen.getByRole('button', { name: 'End Session' })).toBeEnabled());
    await user.type(screen.getByLabelText('Amount'), '35');
    await user.click(screen.getByRole('button', { name: 'End Session' }));

    await waitFor(() => expect(screen.getByText('✓ The pot balances.')).toBeInTheDocument());
    expect(bodyOf(fetchMock, '/api/sessions/s1/rake')).toEqual({ amount: 35, holder: null });
  });
});

// A typed name moved onto someone else is said out loud: on 9 Oct 2026 "Daniel
// H" was quietly entered as "Daniel" because of a wrong merge, and nobody at
// the table was told.
describe('SessionDetail: saying when a typed name was redirected', () => {
  it('adding a merged-away name says who it was added as', async () => {
    stubApi({
      '/api/sessions/s1': session(),
      '/api/sessions/s1/players': {
        ...session({ players: [...session().players, player('s1-jeremy2', 'Jeremy', 0, null)] }),
        renamed: [{ from: 'Dre', to: 'Jeremy' }],
      },
    });
    const user = userEvent.setup();

    renderLive();
    await user.click(await screen.findByRole('button', { name: '+ Add Player' }));
    await user.type(screen.getByPlaceholderText('Player name'), 'Dre');
    await user.click(screen.getByRole('button', { name: 'Add Player' }));

    const notice = await screen.findByRole('status');
    expect(notice).toHaveTextContent('“Dre” was added as Jeremy');
    expect(notice).toHaveTextContent(/merged on the aliases page/);
  });

  it('a name added as typed says nothing', async () => {
    stubApi({
      '/api/sessions/s1': session(),
      '/api/sessions/s1/players': { ...session(), renamed: [] },
    });
    const user = userEvent.setup();

    renderLive();
    await user.click(await screen.findByRole('button', { name: '+ Add Player' }));
    await user.type(screen.getByPlaceholderText('Player name'), 'Simon');
    await user.click(screen.getByRole('button', { name: 'Add Player' }));

    await waitFor(() => expect(screen.queryByPlaceholderText('Player name')).not.toBeInTheDocument());
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('names moved in the starting roster are reported when the session opens', async () => {
    stubApi({ '/api/sessions/s1': session() });

    renderLive({ renamed: [{ from: 'Daniel H', to: 'Daniel' }] });

    expect(await screen.findByRole('status')).toHaveTextContent('“Daniel H” was added as Daniel');
  });

  it('the notice can be dismissed', async () => {
    stubApi({ '/api/sessions/s1': session() });
    const user = userEvent.setup();

    renderLive({ renamed: [{ from: 'Dre', to: 'Jeremy' }] });
    await user.click(await screen.findByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
