import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Android app (standalone: on-device database, no server required).
 * Build with ../scripts/build-apk.sh — see docs/ANDROID.md.
 *
 * appId is permanent: changing it makes Android treat the result as a
 * different app, so existing installs could not be updated.
 */
const config: CapacitorConfig = {
  appId: 'com.skr.billcalendar',
  appName: 'Bill Calendar',
  webDir: 'dist-standalone',
  server: {
    // Shown instead of the app when the page can't load or the WebView is too old.
    errorPath: 'webview-update.html',
  },
  android: {
    // Tailwind CSS 4 needs Chrome 111+ (cascade layers, color-mix, @property).
    minWebViewVersion: 111,
  },
  // WebView debugging stays at Capacitor's default: on in debug builds (used by
  // the automated emulator tests), off in release builds.
  plugins: {
    CapacitorSQLite: {
      androidIsEncryption: false,
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_notify',
      iconColor: '#4F46E5',
    },
  },
};

export default config;
