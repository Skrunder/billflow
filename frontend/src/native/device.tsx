import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Platform-neutral hooks into the Android app. Nothing here imports
 * Capacitor: the Android code (./android.ts) registers itself at startup, and
 * on the web these all report "not available".
 */

/** True inside the Android app (Capacitor injects this global before the page loads). */
export function isNativeApp(): boolean {
  const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return cap?.isNativePlatform?.() === true;
}

export interface PhoneReminderStatus {
  /** Permission to show notifications at all. */
  permission: 'granted' | 'denied' | 'prompt';
  /** Android 12+: whether reminders may fire at the exact minute (otherwise Android may delay them). */
  exact: boolean;
}

/** System notifications on this phone (Android app only). */
export interface PhoneReminders {
  status(): Promise<PhoneReminderStatus>;
  /** Asks for permission if needed; true when notifications can be shown. */
  requestPermission(): Promise<boolean>;
  openExactAlarmSettings(): Promise<void>;
  sendTest(): Promise<void>;
}

let phoneReminders: PhoneReminders | null = null;
export const setPhoneReminders = (impl: PhoneReminders) => void (phoneReminders = impl);
export const getPhoneReminders = () => phoneReminders;

// ── navigation from outside React (notification taps, back button) ──

let navigate: ((to: string | number) => void) | null = null;
let pending: string | number | null = null;

export function navigateTo(to: string | number) {
  if (navigate) navigate(to);
  else pending = to;
}

/** Mount once inside the router so native events can change the page. */
export function DeviceNavigator() {
  const nav = useNavigate();
  useEffect(() => {
    navigate = (to) => (typeof to === 'number' ? nav(to) : nav(to));
    if (pending !== null) {
      navigateTo(pending);
      pending = null;
    }
    return () => {
      navigate = null;
    };
  }, [nav]);
  return null;
}
