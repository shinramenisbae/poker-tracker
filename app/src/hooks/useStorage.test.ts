import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useSessions } from './useStorage';

// Shaped like the backend's real GET /api/sessions/:id response (raw DB columns
// included), not just the fields the hook reads.
function apiSession(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    date: '2026-09-12',
    status: 'active',
    notes: `Game ${id}`,
    bankPlayerId: null,
    gameType: 'in-person',
    createdAt: '2026-09-12T08:00:00.000Z',
    updatedAt: '2026-09-12T08:00:00.000Z',
    discordThreadId: null,
    settledAt: null,
    settledBy: null,
    players: [
      {
        id: `${id}-p1`,
        sessionId: id,
        name: 'Alvin',
        paymentMethod: 'cash',
        cashOutAmount: null,
        cashOutDate: null,
        buyIns: [
          { id: `${id}-b1`, playerId: `${id}-p1`, amount: 50, timestamp: '2026-09-12T08:05:00.000Z', isRebuy: 0, method: 'cash', rebuyType: null, stackedHand: null },
        ],
        cashOut: null,
      },
    ],
    ...overrides,
  };
}

// Serves exactly the given URLs; anything else 404s, so a request to the wrong
// endpoint can't accidentally satisfy a test.
function stubApi(routes: Record<string, unknown[]>) {
  const fetchMock = vi.fn(async (url: string) => {
    const queue = routes[url];
    if (!queue || queue.length === 0) {
      return new Response(JSON.stringify({ error: 'Session not found' }), { status: 404 });
    }
    const body = queue.length > 1 ? queue.shift() : queue[0];
    return new Response(JSON.stringify(body), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const requestedUrls = (fetchMock: ReturnType<typeof stubApi>) => fetchMock.mock.calls.map(([url]) => url);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useSessions', () => {
  // The slow-load bug: a session page downloaded every session ever played
  // (1.3 MB, ~2.5 s in group A) just to show one.
  it('with a session id, fetches only that session', async () => {
    const fetchMock = stubApi({ '/api/sessions/s1': [apiSession('s1')] });

    const { result } = renderHook(() => useSessions('s1'));

    await waitFor(() => expect(result.current.getSession('s1')).toBeDefined());
    expect(result.current.getSession('s1')?.players[0].name).toBe('Alvin');
    expect(result.current.getSession('s1')?.players[0].buyIns).toHaveLength(1);
    expect(result.current.isLoading).toBe(false);
    expect(requestedUrls(fetchMock)).toEqual(['/api/sessions/s1']);
  });

  // Results' "Fix & repost" refreshes to pick up the new discordThreadId.
  it('refreshSessions re-fetches only that session', async () => {
    const fetchMock = stubApi({
      '/api/sessions/s1': [apiSession('s1'), apiSession('s1', { discordThreadId: '987654321' })],
    });

    const { result } = renderHook(() => useSessions('s1'));
    await waitFor(() => expect(result.current.getSession('s1')).toBeDefined());
    expect(result.current.getSession('s1')?.discordThreadId).toBeNull();

    await act(() => result.current.refreshSessions());

    expect(result.current.getSession('s1')?.discordThreadId).toBe('987654321');
    expect(requestedUrls(fetchMock)).toEqual(['/api/sessions/s1', '/api/sessions/s1']);
  });

  // The session page shows "Session not found" once loading ends with no session.
  it('an unknown session id finishes loading with no session', async () => {
    const fetchMock = stubApi({});
    vi.spyOn(console, 'error').mockImplementation(() => {}); // the hook logs the 404

    const { result } = renderHook(() => useSessions('missing'));

    await waitFor(() => expect(result.current.error).toMatch(/404/));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.getSession('missing')).toBeUndefined();
    expect(requestedUrls(fetchMock)).toEqual(['/api/sessions/missing']);
  });

  it('endSession posts to the end endpoint and stores the finished session', async () => {
    const finished = {
      ...apiSession('s1', { status: 'completed', bankPlayerId: 's1-p1' }),
      merges: [{ name: 'Leo', keepId: 's1-p1', entries: 2, totalBuyIn: 600, totalCashOut: 583 }],
    };
    const fetchMock = stubApi({
      '/api/sessions/s1': [apiSession('s1')],
      '/api/sessions/s1/end': [finished],
    });

    const { result } = renderHook(() => useSessions('s1'));
    await waitFor(() => expect(result.current.getSession('s1')).toBeDefined());

    let returned: Awaited<ReturnType<typeof result.current.endSession>> | undefined;
    await act(async () => { returned = await result.current.endSession('s1'); });

    expect(returned?.merges).toEqual([
      { name: 'Leo', keepId: 's1-p1', entries: 2, totalBuyIn: 600, totalCashOut: 583 },
    ]);
    expect(result.current.getSession('s1')?.status).toBe('completed');
    expect(requestedUrls(fetchMock)).toEqual(['/api/sessions/s1', '/api/sessions/s1/end']);
  });

  // Home, Stats and Debts genuinely need every session.
  it('without an id, still loads the full list', async () => {
    const fetchMock = stubApi({ '/api/sessions': [[apiSession('s1'), apiSession('s2')]] });

    const { result } = renderHook(() => useSessions());

    await waitFor(() => expect(result.current.sessions).toHaveLength(2));
    expect(result.current.getSession('s2')?.notes).toBe('Game s2');
    expect(requestedUrls(fetchMock)).toEqual(['/api/sessions']);
  });
});
