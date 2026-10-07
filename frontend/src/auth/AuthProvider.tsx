import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, logoutRequest, NetworkError, refreshSession, setAccessToken, setAuthLostHandler } from '../api/client';
import type { AuthResponse, User } from '@skr/core';
import { clearPersistedCache } from '../queryClient';

/**
 * Session lifecycle:
 *   loading        → trying to resume a session via the refresh cookie
 *   authenticated  → access token in memory
 *   offline        → server unreachable but we have this user's cached data
 *                    (read-only browsing of the persisted query cache)
 *   anonymous      → show the sign-in screens
 */
type Status = 'loading' | 'authenticated' | 'offline' | 'anonymous';

interface AuthContextValue {
  status: Status;
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  register: (input: { email: string; password: string; displayName: string }) => Promise<{ verificationRequired: boolean }>;
  logout: () => Promise<void>;
  /** Called after password change etc. when the server revoked our session. */
  expireSession: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const LAST_USER_KEY = 'skr-last-user';

function rememberUser(user: User | null) {
  try {
    if (user) localStorage.setItem(LAST_USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(LAST_USER_KEY);
  } catch {
    /* storage unavailable */
  }
}

function lastUser(): User | null {
  try {
    const raw = localStorage.getItem(LAST_USER_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<User | null>(null);

  const applySession = useCallback((data: AuthResponse) => {
    const previous = lastUser();
    if (previous && previous.id !== data.user.id) {
      // Different account on this device: never show the previous user's cache.
      qc.clear();
      clearPersistedCache();
    }
    setAccessToken(data.accessToken);
    setUser(data.user);
    rememberUser(data.user);
    setStatus('authenticated');
  }, [qc]);

  const signOutLocally = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    rememberUser(null);
    qc.clear();
    clearPersistedCache();
    setStatus('anonymous');
  }, [qc]);

  // Resume an existing session on load.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await refreshSession();
        if (cancelled) return;
        if (data) applySession(data);
        else signOutLocally();
      } catch (err) {
        if (cancelled) return;
        const cached = lastUser();
        if (err instanceof NetworkError && cached) {
          setUser(cached);
          setStatus('offline');
        } else {
          signOutLocally();
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applySession, signOutLocally]);

  // Leave offline mode automatically once the server is reachable again.
  useEffect(() => {
    if (status !== 'offline') return;
    const retry = async () => {
      try {
        const data = await refreshSession();
        if (data) applySession(data);
        else signOutLocally();
      } catch {
        /* still offline */
      }
    };
    window.addEventListener('online', retry);
    const t = setInterval(retry, 30_000);
    return () => {
      window.removeEventListener('online', retry);
      clearInterval(t);
    };
  }, [status, applySession, signOutLocally]);

  useEffect(() => setAuthLostHandler(signOutLocally), [signOutLocally]);

  const login = useCallback(
    async (email: string, password: string) => {
      const data = await api<AuthResponse>('/auth/login', { method: 'POST', body: { email, password }, auth: false });
      applySession(data);
    },
    [applySession],
  );

  const register = useCallback(
    async (input: { email: string; password: string; displayName: string }) => {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const data = await api<AuthResponse | { verificationRequired: true }>('/auth/register', {
        method: 'POST',
        body: { ...input, timezone },
        auth: false,
      });
      if ('accessToken' in data) {
        applySession(data);
        return { verificationRequired: false };
      }
      return { verificationRequired: true };
    },
    [applySession],
  );

  const logout = useCallback(async () => {
    try {
      await logoutRequest();
    } finally {
      signOutLocally();
    }
  }, [signOutLocally]);

  const value = useMemo(
    () => ({ status, user, login, register, logout, expireSession: signOutLocally }),
    [status, user, login, register, logout, signOutLocally],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

