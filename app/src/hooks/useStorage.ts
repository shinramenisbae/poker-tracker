import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type { Session, AppSettings } from '../types';
import {
  fetchSessions as apiFetchSessions,
  createSession as apiCreateSession,
  updateSession as apiUpdateSession,
  deleteSession as apiDeleteSession,
  addPlayer as apiAddPlayer,
  addBuyIn as apiAddBuyIn,
  updateBuyIn as apiUpdateBuyIn,
  deleteBuyIn as apiDeleteBuyIn,
  cashOut as apiCashOut,
} from '../api';

const SETTINGS_KEY = 'poker-tracker-settings';

const defaultSettings: AppSettings = {
  currency: 'USD',
  defaultBuyIn: 100,
  commonPlayers: ['Stephen', 'Aarya', 'Min', 'Jeremy', 'Jordan', 'Patt', 'George', 'Alvin', 'Alfie', 'Simon', 'Paul', 'Nick'],
};

// Keep localStorage for settings only (not synced to backend)
export function useLocalStorage<T>(key: string, initialValue: T): [T, (value: T | ((prev: T) => T)) => void] {
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      console.error('Error reading from localStorage:', error);
      return initialValue;
    }
  });

  const setValue = useCallback((value: T | ((prev: T) => T)) => {
    try {
      setStoredValue((prev) => {
        const newValue = value instanceof Function ? value(prev) : value;
        window.localStorage.setItem(key, JSON.stringify(newValue));
        return newValue;
      });
    } catch (error) {
      console.error('Error writing to localStorage:', error);
    }
  }, [key]);

  return [storedValue, setValue];
}

// Hook for managing sessions via API
export function useSessions() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isFetching = useRef(false);

  // Fetch sessions on mount
  useEffect(() => {
    const loadSessions = async () => {
      if (isFetching.current) return;
      isFetching.current = true;
      setIsLoading(true);
      setError(null);
      try {
        const data = await apiFetchSessions();
        // Ensure each session has a players array
        const normalized = data.map((s: any) => ({
          ...s,
          players: Array.isArray(s.players) ? s.players : [],
        }));
        setSessions(normalized);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to fetch sessions';
        setError(message);
        console.error('Error fetching sessions:', err);
      } finally {
        setIsLoading(false);
        isFetching.current = false;
      }
    };

    loadSessions();
  }, []);

  // Refresh sessions manually
  const refreshSessions = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await apiFetchSessions();
      const normalized = data.map((s: any) => ({
        ...s,
        players: Array.isArray(s.players) ? s.players : [],
      }));
      setSessions(normalized);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch sessions';
      setError(message);
      console.error('Error fetching sessions:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const addSession = useCallback(async (session: Omit<Session, 'id' | 'createdAt' | 'updatedAt'>) => {
    setIsLoading(true);
    setError(null);
    try {
      const newSession = await apiCreateSession(session);
      setSessions((prev) => [newSession, ...prev]);
      return newSession;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create session';
      setError(message);
      console.error('Error creating session:', err);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const updateSession = useCallback(async (id: string, updates: Partial<Session>) => {
    setIsLoading(true);
    setError(null);
    try {
      const updatedSession = await apiUpdateSession(id, updates);
      setSessions((prev) =>
        prev.map((session) =>
          session.id === id ? updatedSession : session
        )
      );
      return updatedSession;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update session';
      setError(message);
      console.error('Error updating session:', err);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const deleteSession = useCallback(async (id: string) => {
    setIsLoading(true);
    setError(null);
    try {
      await apiDeleteSession(id);
      setSessions((prev) => prev.filter((session) => session.id !== id));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete session';
      setError(message);
      console.error('Error deleting session:', err);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const getSession = useCallback((id: string) => {
    return sessions.find((session) => session.id === id);
  }, [sessions]);

  // Player management
  const addPlayerToSession = useCallback(async (sessionId: string, player: Omit<Player, 'id'>) => {
    setIsLoading(true);
    setError(null);
    try {
      const updatedSession = await apiAddPlayer(sessionId, player);
      setSessions((prev) =>
        prev.map((session) =>
          session.id === sessionId ? updatedSession : session
        )
      );
      return updatedSession;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to add player';
      setError(message);
      console.error('Error adding player:', err);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Buy-in management
  const addPlayerBuyIn = useCallback(async (
    sessionId: string,
    playerId: string,
    amount: number,
    method: 'cash' | 'bank' = 'cash',
    notes: string = ''
  ) => {
    setIsLoading(true);
    setError(null);
    try {
      const updatedSession = await apiAddBuyIn(sessionId, playerId, amount, method, notes);
      setSessions((prev) =>
        prev.map((session) =>
          session.id === sessionId ? updatedSession : session
        )
      );
      return updatedSession;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to add buy-in';
      setError(message);
      console.error('Error adding buy-in:', err);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Update buy-in
  const updatePlayerBuyIn = useCallback(async (
    sessionId: string,
    playerId: string,
    buyInId: string,
    amount: number,
    method: 'cash' | 'bank'
  ) => {
    setIsLoading(true);
    setError(null);
    try {
      const updatedSession = await apiUpdateBuyIn(sessionId, playerId, buyInId, amount, method);
      setSessions((prev) =>
        prev.map((session) =>
          session.id === sessionId ? updatedSession : session
        )
      );
      return updatedSession;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update buy-in';
      setError(message);
      console.error('Error updating buy-in:', err);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Delete buy-in
  const deletePlayerBuyIn = useCallback(async (
    sessionId: string,
    playerId: string,
    buyInId: string
  ) => {
    setIsLoading(true);
    setError(null);
    try {
      const updatedSession = await apiDeleteBuyIn(sessionId, playerId, buyInId);
      setSessions((prev) =>
        prev.map((session) =>
          session.id === sessionId ? updatedSession : session
        )
      );
      return updatedSession;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete buy-in';
      setError(message);
      console.error('Error deleting buy-in:', err);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Cash out management
  const cashOutPlayer = useCallback(async (sessionId: string, playerId: string, amount: number) => {
    setIsLoading(true);
    setError(null);
    try {
      const updatedSession = await apiCashOut(sessionId, playerId, amount);
      setSessions((prev) =>
        prev.map((session) =>
          session.id === sessionId ? updatedSession : session
        )
      );
      return updatedSession;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to cash out player';
      setError(message);
      console.error('Error cashing out player:', err);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    sessions,
    isLoading,
    error,
    refreshSessions,
    addSession,
    updateSession,
    deleteSession,
    getSession,
    addPlayerToSession,
    addPlayerBuyIn,
    updatePlayerBuyIn,
    deletePlayerBuyIn,
    cashOutPlayer,
  };
}

// Import Player type for useSessions
import type { Player } from '../types';

export function useSettings() {
  const [settings, setSettings] = useLocalStorage<AppSettings>(SETTINGS_KEY, defaultSettings);

  // Ensure default common players are always present
  const mergedSettings = useMemo(() => {
    const existing = settings.commonPlayers.map(p => p.toLowerCase());
    const missing = defaultSettings.commonPlayers.filter(
      p => !existing.includes(p.toLowerCase())
    );
    if (missing.length > 0) {
      const merged = { ...settings, commonPlayers: [...settings.commonPlayers, ...missing] };
      return merged;
    }
    return settings;
  }, [settings]);

  const updateSettings = useCallback((updates: Partial<AppSettings>) => {
    setSettings((prev: AppSettings) => ({ ...prev, ...updates }));
  }, [setSettings]);

  const addCommonPlayer = useCallback((name: string) => {
    setSettings((prev: AppSettings) => {
      if (prev.commonPlayers.some(p => p.toLowerCase() === name.toLowerCase())) return prev;
      return { ...prev, commonPlayers: [...prev.commonPlayers, name] };
    });
  }, [setSettings]);

  return {
    settings: mergedSettings,
    updateSettings,
    addCommonPlayer,
  };
}
