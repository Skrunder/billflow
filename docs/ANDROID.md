# Android app

The Android app is the web app's **standalone** build (`VITE_DATA_SOURCE=local`) packaged with
[Capacitor 8](https://capacitorjs.com). It needs no server: bills, events and their history live in
SQLite on the phone, and reminders are ordinary Android notifications. It can optionally sync with
your self-hosted server (see *Connecting to your server* below).

| | |
|---|---|
| Package id | `com.skr.billcalendar` (permanent: changing it makes a different app) |
| Supports | Android 7.0 (API 24) and later, with Android System WebView 111+ (Play Store updates it); targets API 36 |
| Version | `frontend/package.json` `version`; versionCode = major·10000 + minor·100 + patch |
| Data | `@capacitor-community/sqlite` (own SQLite build), in the app's private storage |

## Building

Needs only **Docker** and **Node 20+**. The JDK and Android SDK run in a container
(`scripts/android/Dockerfile`). Building that image accepts the
[Android SDK license](https://developer.android.com/studio/terms) on your behalf.

```bash
npm install                        # repo root, once
scripts/android/new-keystore.sh    # once ever: creates the release signing key (see below)
scripts/build-apk.sh               # signed release → dist-apk/bill-calendar-<version>.apk
scripts/build-apk.sh debug         # debug build   → dist-apk/bill-calendar-<version>-debug.apk
```

The script builds the standalone web app, copies it into the Android project (`npx cap sync`),
then runs Gradle in the container. Gradle downloads are cached in the Docker volume
`skr-android-cache` (first build takes a few minutes, later ones under a minute).

### The signing key (back it up!)

Android only installs an update over an existing install when it is signed with the **same key**.
`new-keystore.sh` writes `release.jks` and `keystore.properties` (with a random password) to
`~/.config/skr-bill-calendar/android/` (override with `SKR_KEYSTORE_DIR`). It is never in the repo
(`.gitignore` blocks `*.jks` and `keystore.properties`).

**Copy that folder somewhere safe** (password manager, encrypted USB stick). If it is lost, installed
apps can't be updated: you'd have to uninstall (losing on-device data unless backed up) and install
a build signed with a new key.

## Installing on a phone

1. Copy `dist-apk/bill-calendar-<version>.apk` to the phone (USB, Drive, email to yourself, or a link on your LAN).
2. Open it. Android asks once to allow installs from that app (Files, Chrome…).
3. To update, install the newer APK over it. Data is kept.

Debug and release builds are signed with different keys, so switching between them needs an uninstall.

## Phone features

* **Reminders:** Settings → Notifications → *Phone notifications*. The app asks for notification
  permission, then hands Android the next 100 reminders. They fire even when the app is closed and
  survive restarts. The schedule is rebuilt after every change and whenever the app is opened.
  On Android 14+ exact alarms are off by default, so reminders can arrive a few minutes late. The
  *Allow exact timing* button opens the system setting. *Send test notification* checks the setup.
* **Tap a reminder** to open that bill or event occurrence.
* **Backup:** Settings → Backup → *Back up to file* opens the share sheet (save to Drive, Files,
  email…). *Restore from backup* replaces everything on the phone with a backup file, after
  confirmation. Backups are lossless JSON (`skr-bill-calendar-backup@1`, every table including
  audit history). A damaged or newer-version file is rejected without changing anything.
* **Back button** goes back within the app and leaves it from the first page.
* Light/dark theme follows the setting, including the status bar icons.

## Connecting to your server

Optional. Settings → **Server sync** → *Connect to server*:

1. **Server address:** what you open Bill Calendar at in a browser, e.g. `192.168.1.20:8080` or
   `https://bills.example.com`. Plain `http://` is accepted only for home-network addresses
   (192.168.x.x, 10.x.x.x, 172.16–31.x.x, `nas.local`, single names like `unraid`), and the app notes
   that it isn't encrypted. Anything reachable from the internet needs `https://`.
2. **Email and password** of your account on that server. The phone appears in the web app under
   Settings → *Phones*, where it can also be signed out remotely (e.g. a lost phone).
3. A preview shows what is on the phone and on the server. Choose:
   * **Combine both:** the phone's bills and events are uploaded and the server's are downloaded.
     Default categories with the same name become one. Bills that exist on both sides under the same
     name are listed first, because combining keeps both copies.
   * **Use the server's data:** the phone's bills and events are replaced by the server's. Make a
     backup first if you might want them.

After that the phone syncs by itself: at start, a few seconds after each change, when the app comes
back to the foreground or the network returns, and every five minutes while open. The cloud icon in
the header shows the state (synced / changes waiting / can't reach the server / signed out), and
Settings has *Sync now*. Everything keeps working offline; changes wait and upload later.

When the same thing was changed in two places, the newest change wins, with two protections: a bill
paid or skipped somewhere is never undone by an edit made elsewhere (only an explicit *reopen* is),
and replaced values are kept in the item's history ("Changed on two devices; newest kept"). Deleting
a bill, event or category wins over edits to it. Full rules: `API.md`, *Sync*.

* **Disconnect** keeps all data on the phone and signs it out on the server. Changes not yet uploaded
  stay only on the phone.
* **Signed out by the server** (password change, removed in *Phones*): the phone keeps working and
  keeps its waiting changes; enter the password in Settings → Server sync to sign in again.
* **Restoring a backup** disconnects the phone (the backup is a separate copy of the data); connect
  again and choose combine or replace.
* The sign-in token is kept in the app's private storage and excluded from Android's cloud backup and
  device transfer. Notification settings stay per device.
* Reverse proxies in front of the server must allow request bodies of 8 MB (`DEPLOYMENT.md`).

**Troubleshooting:** "Can't reach the server": check the phone is on the same network (or the
address is reachable over the internet), the port is right, and the server is running
(`http://<address>/api/health` in the phone's browser shows `"status":"ok"`). "No Bill Calendar
server answered": the address points at something else (often a wrong port).

## Code map

| Path | What |
|---|---|
| `frontend/capacitor.config.ts` | App id/name, plugins, minimum WebView (older ones get `public/webview-update.html`). WebView debugging follows Capacitor's default: on for debug builds only |
| `frontend/android/` | Generated Android project, committed. `cap sync` copies the web build in (not committed) |
| `frontend/src/native/device.tsx` | Platform-neutral hooks: `isNativeApp()`, phone reminders, `saveFile`, navigation |
| `frontend/src/native/android.ts` | Android startup: native SQLite, reminder scheduler, back button, status bar, file sharing |
| `frontend/src/data/local/native-driver.ts` | `SqlDriver` over the SQLite plugin (engine-managed transactions) |
| `frontend/src/data/local/engine.ts` | Shared on-device engine (same as the browser standalone build) |
| `frontend/src/data/local/sync-store.ts` | Sync storage on the phone: outbox (filled by triggers), applying server changes, id remaps |
| `frontend/src/sync/client.ts` | Sync client: connect, push/pull rounds, token refresh, status. Platform-neutral |
| `frontend/src/sync/SyncProvider.tsx` | Runs the client in the app (when to sync) |
| `frontend/src/components/sync/` | Settings → Server sync, the header status icon, the web app's *Phones* list |
| `android/app/src/main/res/xml/` | `network_security_config.xml` (http on the home network), backup rules (no sign-in token in backups) |
| `scripts/android/icons.py` | Generates launcher icons (pure Python) |
| `scripts/android/Dockerfile.emulator` | Headless emulator for tests (needs `/dev/kvm`) |

The server-backed web build never includes this code: `vite.config.ts` swaps
`data/local/browser.ts` for a stub outside standalone mode.

## Testing on an emulator

```bash
docker build -t skr-android-emulator:1 -f scripts/android/Dockerfile.emulator scripts/android
docker run -d --name skr-emu --device /dev/kvm --network host -e ANDROID_AVD_HOME=/cache/android/avd \
  -v "$PWD/dist-apk":/apk:ro,z skr-android-emulator:1 bash -c \
  'mkdir -p $ANDROID_AVD_HOME && echo no | avdmanager create avd -n test -k "system-images;android-36;google_apis;x86_64" -d pixel_6 >/dev/null &&
   exec emulator -avd test -no-window -no-audio -no-boot-anim -gpu swangle_indirect -no-snapshot -no-metrics -memory 3072'
docker exec skr-emu adb install -r /apk/bill-calendar-<version>-debug.apk
# Drive the WebView with Chrome DevTools / puppeteer:
docker exec skr-emu sh -c 'adb forward tcp:9222 localabstract:webview_devtools_remote_$(adb shell pidof com.skr.billcalendar)'
```

`-gpu swangle_indirect` is required in a container (the other software modes crash). Known
emulator-only glitch: with software rendering the dashboard heading sometimes isn't painted on
screen even though the WebView renders it (visible in a DevTools screenshot).

Checked for 1.4.0: estimated amounts (create, ✓ opens the payment form with the estimate selected,
actual amount shown after paying), upgrade from 1.3.1 with data (debug and release).
Checked for 1.3.1: dialog buttons stack with the main action on top, clear of the 3-button
navigation bar; release upgrade over 1.3.0.
Checked on Android 16 (API 36) for 1.3.0 (Tailwind CSS 4): every main screen in light and dark,
upgrade over 1.2.1 (release key), the WebView-too-old page (built with `minWebViewVersion: 999`).
Checked for 1.2.0: connecting to a server through Settings (plain http on
the home network, preview, combine), syncing both ways, upgrade from 1.1.0 with data.
Checked for 1.1.0: native SQLite persistence across restarts, reminder
scheduling and delivery, tapping a notification, back button, backup through the share sheet,
restore through the system file picker, release install and launcher icon.
