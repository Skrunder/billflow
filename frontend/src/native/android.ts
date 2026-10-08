import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';
import { App } from '@capacitor/app';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { CapacitorHttp, SystemBars, SystemBarsStyle } from '@capacitor/core';
import { LocalNotifications, type LocalNotificationSchema } from '@capacitor/local-notifications';
import { createLocalRepository, type LocalRepository, type UpcomingReminder } from '../data/local/engine';
import { createNativeSqliteDriver } from '../data/local/native-driver';
import { queryClient } from '../queryClient';
import { navigateTo, setPhoneReminders, setSaveFile, setSyncAdapters } from './device';

/**
 * Android app startup: opens the on-device SQLite database and wires up the
 * phone's own features (reminders as system notifications, back button,
 * status bar). Loaded only inside the Android app; see data/local/browser.ts.
 */

const DB_NAME = 'billcalendar';
const CHANNEL_ID = 'reminders';
/** Android allows ~500 alarms per app; the nearest ones are enough because we reschedule on every change and app start. */
const MAX_SCHEDULED = 100;
const TEST_NOTIFICATION_ID = 1;

export async function openNativeRepository(): Promise<LocalRepository> {
  const sqlite = new SQLiteConnection(CapacitorSQLite);
  // After a WebView reload the native side may still hold the connection.
  const consistent = (await sqlite.checkConnectionsConsistency()).result;
  const exists = (await sqlite.isConnection(DB_NAME, false)).result;
  const conn =
    consistent && exists
      ? await sqlite.retrieveConnection(DB_NAME, false)
      : await sqlite.createConnection(DB_NAME, false, 'no-encryption', 1, false);
  if (!(await conn.isDBOpen()).result) await conn.open();
  await conn.execute('PRAGMA foreign_keys = ON', false);

  const repo = await createLocalRepository(
    createNativeSqliteDriver(conn, () => sqlite.closeConnection(DB_NAME, false)),
    {
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      locale: navigator.language || 'en-US',
      onChange: () => scheduler.soon(),
    },
  );
  const scheduler = createReminderScheduler(repo);

  await LocalNotifications.createChannel({
    id: CHANNEL_ID,
    name: 'Reminders',
    description: 'Bills that are due and upcoming events',
    importance: 4,
    visibility: 1,
  }).catch(() => undefined);

  setPhoneReminders({
    async status() {
      const [perm, exact] = await Promise.all([LocalNotifications.checkPermissions(), LocalNotifications.checkExactNotificationSetting()]);
      return { permission: perm.display === 'granted' ? 'granted' : perm.display === 'denied' ? 'denied' : 'prompt', exact: exact.exact_alarm === 'granted' };
    },
    async requestPermission() {
      let perm = await LocalNotifications.checkPermissions();
      if (perm.display !== 'granted') perm = await LocalNotifications.requestPermissions();
      scheduler.soon();
      return perm.display === 'granted';
    },
    async openExactAlarmSettings() {
      await LocalNotifications.changeExactNotificationSetting();
      scheduler.soon();
    },
    async sendTest() {
      await LocalNotifications.schedule({
        notifications: [
          {
            id: TEST_NOTIFICATION_ID,
            channelId: CHANNEL_ID,
            smallIcon: 'ic_stat_notify',
            title: 'Test notification',
            body: 'Reminders will appear like this.',
            schedule: { at: new Date(Date.now() + 2000), allowWhileIdle: true },
            extra: { url: '/notifications' },
          },
        ],
      });
    },
  });

  // Exports and backups: written to the app's cache (see res/xml/file_paths.xml), then shared.
  setSaveFile(async (name, text) => {
    const { uri } = await Filesystem.writeFile({ path: `exports/${name}`, data: text, directory: Directory.Cache, encoding: Encoding.UTF8, recursive: true });
    try {
      await Share.share({ title: name, files: [uri], dialogTitle: 'Save or send' });
    } catch (err) {
      // Closing the share sheet without picking anything is not an error.
      if (!/cancel/i.test(String((err as Error)?.message ?? err))) throw err;
    }
  });

  // Server sync: native HTTP (no CORS or mixed-content limits for a plain-http
  // home server) and the refresh token in a private file that Android's cloud
  // backup excludes (res/xml/backup_rules.xml, data_extraction_rules.xml).
  const TOKEN_FILE = { path: 'sync-auth.json', directory: Directory.Data };
  setSyncAdapters({
    deviceName: phoneName(),
    async http({ method, url, token, body, timeoutMs = 30_000 }) {
      const res = await CapacitorHttp.request({
        url,
        method,
        headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        data: body,
        connectTimeout: 15_000,
        readTimeout: timeoutMs,
        responseType: 'json',
      });
      return { status: res.status, data: res.data as unknown };
    },
    secrets: {
      async load() {
        try {
          return (JSON.parse(String((await Filesystem.readFile({ ...TOKEN_FILE, encoding: Encoding.UTF8 })).data)) as { refreshToken?: string }).refreshToken ?? null;
        } catch {
          return null;
        }
      },
      async save(refreshToken) {
        await Filesystem.writeFile({ ...TOKEN_FILE, data: JSON.stringify({ refreshToken }), encoding: Encoding.UTF8 });
      },
      async clear() {
        await Filesystem.deleteFile(TOKEN_FILE).catch(() => undefined);
      },
    },
  });

  // Tapping a reminder opens the bill or event it is about.
  await LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
    const url = (action.notification.extra as { url?: unknown } | undefined)?.url;
    if (typeof url === 'string' && url.startsWith('/')) navigateTo(url);
  });

  // Hardware/gesture back: go back within the app, leave it from the first page.
  await App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) navigateTo(-1);
    else void App.exitApp();
  });

  // Back from the background: catch up (auto-pay, new due dates, overdue) and refresh the screen.
  await App.addListener('resume', () => {
    void repo.runMaintenance().then(() => queryClient.invalidateQueries());
    scheduler.soon();
  });

  followThemeWithStatusBar();
  scheduler.soon();
  return repo;
}

/** "Pixel 8" from the WebView's user agent, for the server's list of signed-in phones. */
function phoneName(): string {
  const model = navigator.userAgent.match(/Android [\d.]+; ([^;)]+)/)?.[1]?.replace(/\s+Build\/.*$/, '').trim();
  return model && model !== 'K' ? model.slice(0, 60) : 'Android phone';
}

/** FNV-1a: a stable 31-bit notification id for each occurrence + offset (never the test id). */
export function notificationId(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const id = h & 0x7fffffff;
  return id <= TEST_NOTIFICATION_ID ? id + 2 : id;
}

function toNotification(r: UpcomingReminder): LocalNotificationSchema {
  return {
    id: notificationId(r.key),
    channelId: CHANNEL_ID,
    smallIcon: 'ic_stat_notify',
    title: r.title,
    body: r.body,
    schedule: { at: new Date(r.at), allowWhileIdle: true },
    extra: { url: r.url },
  };
}

/**
 * Keeps Android's scheduled notifications equal to the next reminders in the
 * database: everything is cancelled and rescheduled shortly after any change.
 */
function createReminderScheduler(repo: LocalRepository) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<void> | null = null;
  let again = false;

  async function reschedule() {
    const { settings } = await repo.getProfile();
    const perm = await LocalNotifications.checkPermissions();
    const scheduled = (await LocalNotifications.getPending()).notifications.filter((n) => n.id !== TEST_NOTIFICATION_ID);
    if (scheduled.length) await LocalNotifications.cancel({ notifications: scheduled.map((n) => ({ id: n.id })) });
    if (!settings.pushNotifications || perm.display !== 'granted') return;
    const upcoming = await repo.getUpcomingReminders({ limit: MAX_SCHEDULED });
    if (upcoming.length) await LocalNotifications.schedule({ notifications: upcoming.map(toNotification) });
  }

  function run() {
    if (running) {
      again = true;
      return;
    }
    running = reschedule()
      .catch((err) => console.error('Could not schedule reminders', err))
      .finally(() => {
        running = null;
        if (again) {
          again = false;
          run();
        }
      });
  }

  return {
    soon() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        run();
      }, 1000);
    },
  };
}

/** Light status-bar icons on the dark theme, dark icons on the light theme. */
function followThemeWithStatusBar() {
  const apply = () => {
    const dark = document.documentElement.classList.contains('dark');
    void SystemBars.setStyle({ style: dark ? SystemBarsStyle.Dark : SystemBarsStyle.Light }).catch(() => undefined);
  };
  apply();
  new MutationObserver(apply).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
}
