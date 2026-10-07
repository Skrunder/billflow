import { useEffect, useState } from 'react';
import { useMe } from '../api/hooks';
import type { Settings, Theme } from '@skr/core';

const FALLBACK: Settings = {
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  theme: 'SYSTEM',
  weekStartsOn: 0,
  currency: 'USD',
  locale: navigator.language || 'en-US',
  timeFormat: '12h',
  defaultCalendarView: 'dayGridMonth',
  defaultBillReminders: [1440],
  defaultEventReminders: [60],
  allDayReminderTime: '09:00',
  autoCompleteAutopay: true,
  inAppNotifications: true,
  emailNotifications: false,
  pushNotifications: false,
  updatedAt: new Date(0).toISOString(),
};

/** The signed-in user's settings (falls back to sensible browser defaults while loading). */
export function useSettings(): Settings {
  const { data } = useMe();
  return data?.settings ?? FALLBACK;
}

export function applyTheme(theme: Theme) {
  try {
    localStorage.setItem('skr-theme', theme);
  } catch {
    /* ignore */
  }
  const dark = theme === 'DARK' || (theme === 'SYSTEM' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0f172a' : '#4f46e5');
}

/** Keeps <html class="dark"> in sync with the setting and the OS preference. */
export function useThemeSync(theme: Theme) {
  useEffect(() => {
    applyTheme(theme);
    if (theme !== 'SYSTEM') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('SYSTEM');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}
