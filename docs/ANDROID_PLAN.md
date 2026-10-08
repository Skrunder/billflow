# Android app plan: standalone with optional sync

**Goal:** an installable Android APK that works fully on the phone with no server, no account and no internet. Users can optionally connect it to their self-hosted server, and the phone and web app then share the same data in both directions.

**Status:** M1 (shared core), M2 (data layer) and M3 (local engine) done. Next: M4, the first APK.

---

## 1. Architecture

```
┌──────────────────────── Android APK (Capacitor) ─────────────────────────┐
│  React UI (reused from frontend/)                                        │
│        │                                                                 │
│  Repository interface ──────────────┬────────────────────────────────┐   │
│        │ (Android)                  │ (web build)                    │   │
│  LocalRepository                    RemoteRepository (today's REST)  │   │
│        │                                                             │   │
│  On-device SQLite  ◄── Local engine (from packages/core):            │   │
│   bills, occurrences,     recurrence · occurrence generation ·       │   │
│   events, categories,     overdue status · auto-pay · audit history  │   │
│   settings, audit, outbox                                            │   │
│        │                                                             │   │
│  Native reminders (Android notifications, scheduled on device)       │   │
│        │                                                             │   │
│  Sync engine ── optional ── HTTPS/HTTP ──► Server /api/v1/sync ──────┘   │
└──────────────────────────────────────────────────────────────────────────┘
```

* **Offline-first:** the Android app always reads and writes its local SQLite database. The UI never waits for the network.
* **Same UI:** screens, forms, calendar and dialogs are reused from `frontend/`. Only the data layer underneath changes.
* **One source of business rules:** recurrence, occurrence generation, overdue logic and validation move into a shared package used by both the server and the phone. A fix there applies everywhere.

## 2. Key design decisions

| Topic | Decision |
|---|---|
| Wrapper | **Capacitor** around the existing React app (native Android project, Kotlin/Java only where needed) |
| Local database | SQLite via `@capacitor-community/sqlite`; `sql.js` in the browser for development and tests |
| Occurrence ids | **Deterministic**: `UUIDv5(templateId + originalDate)`. The phone and server generate the *same* id for the same slot, so offline generation never creates duplicates. Merging also matches on `(templateId, originalDate)` as a safety net for existing rows. |
| Independence rule | Unchanged: every occurrence is its own row with its own status and history, locally and on the server |
| Deletes | Soft deletes ("tombstones", `deleted_at`) on synced tables, so deletions propagate. Purged after all devices have synced. |
| Change tracking | Server: per-user monotonically increasing `sync_seq` on every changed row. Phone: local outbox of pending changes. |
| Conflicts | Last writer wins per record, by modification time, with two protections: (1) a *completion* or *skip* is never silently lost to a mere edit from another device; an explicit *reopen* is the only thing that overrides it. (2) Both versions are written to the occurrence's audit history so nothing disappears without a trace. |
| Reminders | Scheduled **on the device** with Android notifications, so they work with no server. When a phone is connected to a server, server push to that device is turned off to avoid double reminders (in-app and email on the server still work). |
| Auto-pay | Runs locally on app open and in the background. Idempotent, so device and server can't double-complete. |
| Auth | Standalone mode has no login. "Connect to server" signs in once. The refresh token is kept in Android encrypted storage (not cookies), using new native auth endpoints. |
| First connect | Local data is uploaded and merged into the server account. The user is shown a summary first (e.g. "12 bills on phone, 9 on server, 7 match"). |
| Backups (standalone) | Export/import a JSON file via the Android share sheet (same format as the server's export) |
| Plain HTTP on LAN | Android blocks cleartext HTTP by default. Allowed only for private-network addresses (192.168.x, 10.x, …) via a network-security config, with a warning in the app. HTTPS is recommended. |
| Min Android version | Android 8.0 (API 26). Handles Android 13+ notification permission and 12+ exact-alarm permission. |
| App id | `com.skr.billcalendar` (renaming later breaks updates, so this is decided up front) |
| Distribution | Sideloaded APK (enable "install unknown apps"). Play Store can come later. |
| Signing | Release keystore generated once and stored **outside the repo**, with backup instructions. Losing it means future APKs can't update the installed app. |
| Build | Inside Docker (JDK 17 + Android SDK + Gradle), so no Android Studio is needed: `./scripts/build-apk.sh` → `dist/skr-bill-calendar-<version>.apk` |

## 3. Milestones

### M1 · Shared core package ✅ done
* Convert the repo to npm workspaces: `packages/core`, `backend`, `frontend`.
* Move into `packages/core`: recurrence expansion, date/time-zone helpers, occurrence generation and reconciliation rules, status derivation (overdue), reminder math, validation schemas and shared types.
* Switch the backend to it. **All existing tests must still pass unchanged**, which proves nothing regressed.

### M2 · Data-layer abstraction in the frontend ✅ done
* Introduce a `Repository` interface covering everything the UI does (list/create/update bills, complete occurrences, calendar feed, dashboard, …).
* `RemoteRepository` wraps today's REST calls, so the web app behaves exactly as now.
* The UI talks only to the interface.

### M3 · Local engine (standalone, runs in the browser for development) ✅ done
* SQLite schema mirroring the server tables, plus `outbox` and `sync_state`.
* `LocalRepository` implements everything locally: occurrence generation and horizon extension, per-occurrence complete/skip/reopen/edit with audit history, dashboard and calendar queries, categories with defaults, settings, auto-pay.
* Tests: the same independence and integrity tests as the server suite, run against the local engine.

### M4 · First APK: fully standalone ✅ usable milestone
* Capacitor Android project, app icon/splash, status bar and back-button handling.
* Native reminders (presets and custom offsets, all-day reminder time, rescheduled whenever data changes or the app starts).
* Export/import backup file.
* Docker-based build script and signing-keystore setup.
* **Result:** an APK you can install and use daily with no server.

### M5 · Server sync support
* Database migration: `deleted_at`, `sync_seq`, `client_modified_at` on synced tables; a `devices` table.
* Switch the server to deterministic occurrence ids for new rows. Existing rows keep their ids and are matched by `(templateId, originalDate)`.
* Endpoints: `POST /api/v1/sync/push` (batched changes, idempotent by change id), `GET /api/v1/sync/pull?since=<seq>`, and native auth (`/auth/native/login`, `/auth/native/refresh`, `/auth/native/logout`).
* Web app keeps working exactly as before, and edits made on the web are picked up by phones.
* Integration tests: two simulated devices plus web edits, covering conflicts, deletes and offline catch-up.

### M6 · Sync in the app
* Settings → **Connect to server** (URL, login, first-merge preview), **Disconnect**, and **Sync now**.
* Background sync (on app open, on reconnect, periodically while open), with a status indicator ("Synced 2 min ago" / "3 changes waiting").
* Conflict handling as described above. Sync errors are shown clearly and never block local use.

### M7 · Release automation & docs
* CI builds the APK on every change (a broken Android build fails CI) and attaches a signed APK to GitHub releases (keystore via repository secrets).
* `docs/ANDROID.md`: install, update, backup, connect to server, troubleshooting.
* `CLAUDE.md` rule: **every change must be applied to server, web and Android; bump the app version and rebuild the APK.**

## 4. Testing approach
* **Unit:** shared core (recurrence, time zones and DST, status rules), run once and used by both apps.
* **Local engine:** the occurrence-independence suite, run against SQLite.
* **Sync:** scripted multi-device scenarios against a real PostgreSQL server.
* **APK:** built and smoke-tested in CI. Final checks on your phone (install, reminders firing, offline use, connect and sync with your server).

## 5. Things that will feel different on Android
* Reminders come from the phone itself, so they're on time even with no network, but an "exact alarm" permission prompt may appear on Android 12+.
* Battery optimisation on some brands (Samsung, Xiaomi) can delay background sync. The app syncs on open regardless.
* Uninstalling the app deletes its local data unless you exported a backup or connected to a server.
