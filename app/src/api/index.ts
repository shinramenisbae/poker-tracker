import type { Session, Player } from '../types';

const API_BASE_URL = '/api';

// --- Optional API token ----------------------------------------------------
// When the backend has auth enabled (API_TOKEN set server-side), every request
// must carry a matching token. We keep it in localStorage and attach it to all
// requests automatically. When auth is disabled server-side the token is simply
// ignored, so this is safe to leave empty.
const API_TOKEN_KEY = 'poker-api-token';

export function getApiToken(): string {
  try {
    return localStorage.getItem(API_TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function setApiToken(token: string): void {
  try {
    const trimmed = token.trim();
    if (trimmed) localStorage.setItem(API_TOKEN_KEY, trimmed);
    else localStorage.removeItem(API_TOKEN_KEY);
  } catch {
    /* localStorage unavailable — ignore */
  }
}

// Single entry point for all backend calls: prefixes the base URL, attaches the
// token header when present, and defaults JSON content-type for bodies.
async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const token = getApiToken();
  if (token) headers.set('x-api-token', token);
  return fetch(`${API_BASE_URL}${path}`, { ...init, headers });
}

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
  const response = await apiFetch('/sessions');
  return handleResponse<Session[]>(response);
}

export async function createSession(data: Omit<Session, 'id' | 'createdAt' | 'updatedAt'>): Promise<Session> {
  const response = await apiFetch('/sessions', {
    method: 'POST',
    body: JSON.stringify(data),
  });
  return handleResponse<Session>(response);
}

export async function updateSession(id: string, data: Partial<Session>): Promise<Session> {
  const response = await apiFetch(`/sessions/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
  return handleResponse<Session>(response);
}

export async function deleteSession(id: string): Promise<void> {
  const response = await apiFetch(`/sessions/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API Error: ${response.status} - ${errorText || response.statusText}`);
  }
}

// Player API
export async function addPlayer(sessionId: string, player: Omit<Player, 'id'>): Promise<Session> {
  const response = await apiFetch(`/sessions/${sessionId}/players`, {
    method: 'POST',
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
  const response = await apiFetch(`/sessions/${sessionId}/players/${playerId}/buyins`, {
    method: 'POST',
    body: JSON.stringify({
      amount,
      method,
      notes,
      timestamp: Date.now(),
    }),
  });
  return handleResponse<Session>(response);
}

// Update buy-in API
export async function updateBuyIn(
  sessionId: string,
  playerId: string,
  buyInId: string,
  amount: number,
  method: 'cash' | 'bank'
): Promise<Session> {
  const response = await apiFetch(`/sessions/${sessionId}/players/${playerId}/buyins/${buyInId}`, {
    method: 'PUT',
    body: JSON.stringify({ amount, method }),
  });
  return handleResponse<Session>(response);
}

// Delete buy-in API
export async function deleteBuyIn(
  sessionId: string,
  playerId: string,
  buyInId: string
): Promise<Session> {
  const response = await apiFetch(`/sessions/${sessionId}/players/${playerId}/buyins/${buyInId}`, {
    method: 'DELETE',
  });
  return handleResponse<Session>(response);
}

// Import API
export interface ImportResult {
  imported: number;
  skipped: number;
  total: number;
  errors?: string[];
  message: string;
}

export async function importSpreadsheet(): Promise<ImportResult> {
  const response = await apiFetch('/import/spreadsheet', {
    method: 'POST',
  });
  return handleResponse<ImportResult>(response);
}

export async function clearImportedSessions(): Promise<{ deleted: number; message: string }> {
  const response = await apiFetch('/import/spreadsheet', {
    method: 'DELETE',
  });
  return handleResponse<{ deleted: number; message: string }>(response);
}

// Cash out API
export async function cashOut(
  sessionId: string,
  playerId: string,
  amount: number
): Promise<Session> {
  const response = await apiFetch(`/sessions/${sessionId}/players/${playerId}/cashout`, {
    method: 'PUT',
    body: JSON.stringify({
      amount,
      timestamp: Date.now(),
    }),
  });
  return handleResponse<Session>(response);
}

// Alias mappings API (for the /aliases crowd-sourcing page)
export interface AliasMapping {
  alias: string;
  realName: string | null;
}
export interface AliasMappingsResponse {
  aliases: AliasMapping[];
  canonicalPlayers: string[];
}

export async function fetchAliasMappings(): Promise<AliasMappingsResponse> {
  const response = await apiFetch('/alias-mappings');
  return handleResponse<AliasMappingsResponse>(response);
}

export async function setAliasMapping(alias: string, realName: string | null): Promise<AliasMapping> {
  const response = await apiFetch(`/alias-mappings/${encodeURIComponent(alias)}`, {
    method: 'PUT',
    body: JSON.stringify({ realName }),
  });
  return handleResponse<AliasMapping>(response);
}

export interface BankAccount {
  displayName: string;
  account: string;
}
export interface BankAccountsResponse {
  accounts: Record<string, BankAccount>;
}

export async function fetchBankAccounts(): Promise<BankAccountsResponse> {
  const response = await apiFetch('/bank-accounts');
  return handleResponse<BankAccountsResponse>(response);
}

export async function setBankAccount(name: string, info: BankAccount): Promise<BankAccount & { name: string }> {
  const response = await apiFetch(`/bank-accounts/${encodeURIComponent(name)}`, {
    method: 'PUT',
    body: JSON.stringify(info),
  });
  return handleResponse<BankAccount & { name: string }>(response);
}

export async function deleteBankAccount(name: string): Promise<{ ok: true; name: string; deleted: number }> {
  const response = await apiFetch(`/bank-accounts/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  });
  return handleResponse<{ ok: true; name: string; deleted: number }>(response);
}

export interface AnnounceResult {
  ok: true;
  threadId?: string;
  threadName?: string;
  alreadyAnnouncedThreadId?: string;
}
export async function announceSessionToDiscord(sessionId: string): Promise<AnnounceResult> {
  const response = await apiFetch(`/sessions/${sessionId}/announce-discord`, {
    method: 'POST',
  });
  return handleResponse<AnnounceResult>(response);
}

// Hand-log / all-in EV API
export interface EvHandPoint {
  actualNet: number;
  expectedNet: number;
  isAllInEv: boolean;
}
export interface EvSeriesEntry {
  handIndex: number;
  handNumber: number;
  gameType: 'holdem' | 'omaha';
  perPlayer: Record<string, EvHandPoint>;
}
export interface EvSeriesResponse {
  players: string[];
  series: EvSeriesEntry[];
}
export async function fetchSessionEv(sessionId: string): Promise<EvSeriesResponse> {
  const response = await apiFetch(`/sessions/${sessionId}/ev`);
  return handleResponse<EvSeriesResponse>(response);
}
export interface UploadHandLogResult {
  ok: true;
  totalHands: number;
  eligibleEvHands: number;
  players: string[];
}
export async function uploadHandLog(sessionId: string, rawLog: string): Promise<UploadHandLogResult> {
  const response = await apiFetch(`/sessions/${sessionId}/handlog`, {
    method: 'POST',
    body: JSON.stringify({ rawLog }),
  });
  return handleResponse<UploadHandLogResult>(response);
}
export interface LuckLeaderboardEntry {
  playerName: string;
  sessions: number;
  allInHands: number;
  actualOnAllIns: number;
  expectedOnAllIns: number;
  luckDelta: number;
}
export async function fetchLuckLeaderboard(): Promise<LuckLeaderboardEntry[]> {
  const response = await apiFetch('/luck-leaderboard');
  return handleResponse<LuckLeaderboardEntry[]>(response);
}

export interface MergePlayersResult {
  ok: true;
  from: string;
  into: string;
  updated: { players: number; aliasMappings: number; handEvs: number };
}
export async function mergePlayers(from: string, into: string): Promise<MergePlayersResult> {
  const response = await apiFetch('/players/merge', {
    method: 'POST',
    body: JSON.stringify({ from, into }),
  });
  return handleResponse<MergePlayersResult>(response);
}

export interface DeletePlayerResult {
  ok: true;
  name: string;
  deleted: { players: number; aliasMappingsByRealName: number; aliasMappingsByKey: number; handEvs: number };
}
export async function deletePlayer(name: string): Promise<DeletePlayerResult> {
  const response = await apiFetch(`/players/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  });
  return handleResponse<DeletePlayerResult>(response);
}

export async function deleteAlias(alias: string): Promise<{ ok: true; alias: string; deleted: number }> {
  const response = await apiFetch(`/alias-mappings/${encodeURIComponent(alias)}`, {
    method: 'DELETE',
  });
  return handleResponse(response);
}

export async function deleteAllUnmappedAliases(): Promise<{ ok: true; deleted: number }> {
  const response = await apiFetch('/alias-mappings?onlyUnmapped=true', {
    method: 'DELETE',
  });
  return handleResponse(response);
}

export interface PlayerStyleStats {
  playerName: string;
  sessions?: number;
  handsDealt: number;
  vpip: number;          // 0..1
  pfr: number;           // 0..1
  af: number | null;     // postflop aggression factor; null if undefined (no calls)
  postflopBets: number;
  postflopRaises: number;
  postflopCalls: number;
}
export async function fetchSessionPlayerStats(sessionId: string): Promise<PlayerStyleStats[]> {
  const response = await apiFetch(`/sessions/${sessionId}/player-stats`);
  return handleResponse<PlayerStyleStats[]>(response);
}
export async function fetchPlayerStats(): Promise<PlayerStyleStats[]> {
  const response = await apiFetch('/player-stats');
  return handleResponse<PlayerStyleStats[]>(response);
}
