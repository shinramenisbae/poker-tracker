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

describe('SessionDetail: credit limit', () => {
  const fresh = (id: string, name: string, buyIns: unknown[] = []) => ({ ...player(id, name, 0, null), buyIns });
  const bank = (id: string, amount: number) =>
    ({ id, playerId: 'x', amount, timestamp: '2026-09-28T05:00:00.000Z', isRebuy: 0, method: 'bank' });
  const live = (over: Record<string, unknown> = {}) => session({
    creditLimit: 500, creditCollector: 'Stephen',
    players: [fresh('s1-leo', 'Leo', [bank('b1', 400)]), fresh('s1-newbie', 'Newbie')],
    ...over,
  });
  // Leo has played before and still owes $120 from it; Newbie never has.
  const earlier = {
    ...session({ id: 's0', status: 'completed', bankPlayerId: 's0-jeremy' }),
    players: [
      { ...player('s0-jeremy', 'Jeremy', 100, 220), sessionId: 's0' },
      { ...player('s0-leo', 'Leo', 0, 0), sessionId: 's0', buyIns: [bank('b0', 120)] },
    ],
  };
  const history = (current: unknown) => ({
    '/api/sessions': [current, earlier],
    '/api/payments': { paymentsBySession: {} },
  });

  it('shows the limit, what each player owes against it, and who is new', async () => {
    const current = live();
    stubApi({ '/api/sessions/s1': current, ...history(current) });

    renderLive();

    expect(await screen.findByLabelText('Each player may owe')).toHaveValue(500);
    expect(screen.getByLabelText('Over the limit, pay')).toHaveValue('Stephen');
    await waitFor(() => expect(screen.getAllByTestId('credit-used')).toHaveLength(2));
    const [leo, newbie] = screen.getAllByTestId('credit-used');
    expect(leo).toHaveTextContent('Owes $400.00 of $500.00 credit');
    expect(newbie).toHaveTextContent('New player — no credit');
  });

  it('warns about debts from earlier sessions', async () => {
    const current = live();
    stubApi({ '/api/sessions/s1': current, ...history(current) });

    renderLive();

    expect(await screen.findByTestId('old-debt')).toHaveTextContent('Still owes $120.00 from 1 earlier session');
  });

  it('saves a changed limit and collector', async () => {
    const current = live();
    const fetchMock = stubApi({ '/api/sessions/s1': current, ...history(current) });
    const user = userEvent.setup();

    renderLive();
    const limit = await screen.findByLabelText('Each player may owe');
    await user.clear(limit);
    await user.type(limit, '300');
    await user.clear(screen.getByLabelText('Over the limit, pay'));
    await user.type(screen.getByLabelText('Over the limit, pay'), 'Nick');
    await user.click(screen.getByRole('button', { name: 'Save credit limit' }));

    await waitFor(() => {
      const put = fetchMock.mock.calls.find(([u, init]) => u === '/api/sessions/s1' && (init as RequestInit | undefined)?.method === 'PUT');
      expect(put && JSON.parse(String((put[1] as RequestInit).body))).toEqual({ creditLimit: 300, creditCollector: 'Nick' });
    });
  });

  it('online sessions have no credit limit', async () => {
    stubApi({ '/api/sessions/s1': live({ gameType: 'online' }) });

    renderLive();

    await screen.findByText('Leo');
    expect(screen.queryByLabelText('Each player may owe')).not.toBeInTheDocument();
  });

  it('a buy-in that went over the limit says who to pay now', async () => {
    const current = live();
    stubApi({
      '/api/sessions/s1': current,
      ...history(current),
      '/api/sessions/s1/players/s1-newbie/buyins': {
        ...current,
        creditSplit: { owed: 0, prepaid: 100, collector: 'Stephen', limit: 0, newPlayer: true },
      },
    });
    const user = userEvent.setup();

    renderLive();
    await screen.findByText('Newbie');
    const newbieRow = screen.getByText('Newbie').closest('.rounded-xl') as HTMLElement;
    await user.click(within(newbieRow).getByRole('button', { name: 'Bank' }));
    await user.click(within(newbieRow).getByRole('button', { name: '+$100' }));

    expect(await screen.findByTestId('credit-notice')).toHaveTextContent(
      'Newbie is new, so gets no credit — pay $100.00 to Stephen now (instant transfer or cash).');
  });
});
