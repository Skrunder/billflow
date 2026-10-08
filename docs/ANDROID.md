# Android app

The Android app is the web app's **standalone** build (`VITE_DATA_SOURCE=local`) packaged with
[Capacitor 8](https://capacitorjs.com). It needs no server: bills, events and their history live in
SQLite on the phone, and reminders are ordinary Android notifications. Server sync is planned
(see `ANDROID_PLAN.md`, M5–M6).

| | |
|---|---|
| Package id | `com.skr.billcalendar` (permanent: changing it makes a different app) |
| Supports | Android 7.0 (API 24) and later; targets API 36 |
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

## Code map

| Path | What |
|---|---|
| `frontend/capacitor.config.ts` | App id/name, plugins. WebView debugging follows Capacitor's default: on for debug builds only |
| `frontend/android/` | Generated Android project, committed. `cap sync` copies the web build in (not committed) |
| `frontend/src/native/device.tsx` | Platform-neutral hooks: `isNativeApp()`, phone reminders, `saveFile`, navigation |
| `frontend/src/native/android.ts` | Android startup: native SQLite, reminder scheduler, back button, status bar, file sharing |
| `frontend/src/data/local/native-driver.ts` | `SqlDriver` over the SQLite plugin (engine-managed transactions) |
| `frontend/src/data/local/engine.ts` | Shared on-device engine (same as the browser standalone build) |
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

Checked on Android 16 (API 36) for 1.1.0: native SQLite persistence across restarts, reminder
scheduling and delivery, tapping a notification, back button, backup through the share sheet,
restore through the system file picker, release install and launcher icon.
