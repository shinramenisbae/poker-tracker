import type { Session, Player } from '../types';

const API_BASE_URL = '/api';

// Helper for handling fetch responses
async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API Error: ${response.status} - ${errorText || response.statusText}`);
  }
  return response.json() as Promise<T>;
}

// Sessions API
export async function fetchSessions(): Promise<Session[]> {
  const response = await fetch(`${API_BASE_URL}/sessions`);
  return handleResponse<Session[]>(response);
}

export async function createSession(data: Omit<Session, 'id' | 'createdAt' | 'updatedAt'>): Promise<Session> {
  const response = await fetch(`${API_BASE_URL}/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });
  return handleResponse<Session>(response);
}

export async function updateSession(id: string, data: Partial<Session>): Promise<Session> {
  const response = await fetch(`${API_BASE_URL}/sessions/${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });
  return handleResponse<Session>(response);
}

export async function deleteSession(id: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/sessions/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API Error: ${response.status} - ${errorText || response.statusText}`);
  }
}

// Player API
export async function addPlayer(sessionId: string, player: Omit<Player, 'id'>): Promise<Session> {
  const response = await fetch(`${API_BASE_URL}/sessions/${sessionId}/players`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(player),
  });
  return handleResponse<Session>(response);
}

// Buy-in API
export async function addBuyIn(
  sessionId: string,
  playerId: string,
  amount: number,
  method: 'cash' | 'bank' = 'cash',
  notes: string = ''
): Promise<Session> {
  const response = await fetch(`${API_BASE_URL}/sessions/${sessionId}/players/${playerId}/buyins`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount,
      method,
      notes,
      timestamp: Date.now(),
    }),
  });
  return handleResponse<Session>(response);
}

// Cash out API
export async function cashOut(
  sessionId: string,
  playerId: string,
  amount: number
): Promise<Session> {
  const response = await fetch(`${API_BASE_URL}/sessions/${sessionId}/players/${playerId}/cashout`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount,
      timestamp: Date.now(),
    }),
  });
  return handleResponse<Session>(response);
}
