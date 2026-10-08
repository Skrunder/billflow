# Changelog

BillFlow follows semantic versioning (see [docs/UPGRADING.md](docs/UPGRADING.md)). Every release updates the server, the web app and the Android app together.

## 1.5.1 (2026-10-08)
* Fixed: the web app (Docker) could keep showing the old icon. The icon files have new names, so browsers fetch the new artwork instead of reusing cached copies. An installed PWA may still need reinstalling to change its home-screen icon.

## 1.5.0: BillFlow (2026-10-08)
* **New name and icon.** SKR's Bill Calendar is now **BillFlow**: titles, emails, notifications, the Android app name and the APK file (`billflow-<version>.apk`). The new icon (a bill with a flowing wave) covers the web app, the installable PWA, the Android launcher (including Android 13+ themed icons) and the notification icon.
* Backup and export downloads are named `billflow-backup-…` / `billflow-export-…`. Older backups still restore.
* Nothing that holds data changes: the Android package id, Docker volumes and Compose project, database name and user, image names and backup formats stay the same, so updating keeps everything.

## 1.4.0: Estimated amounts (2026-10-08)
* A bill's amount can be marked as an **estimate**. Paying it asks for the actual amount (the ✓ on a row opens the payment form with the estimate selected).
* Estimates are tagged "est." in lists, "~" on the calendar and in dashboard totals, and "About $X" in reminders. One month can be set apart with "Edit this occurrence".
* Totals now count what was actually paid for completed bills.
* Database: migration `20261009000000_bill_estimates` (additive). Phones on 1.4.0 and servers on 1.3.x can sync safely in either order.

## 1.3.1 (2026-10-08)
* Fixed: the web app could sign you out when a page reload interrupted a sign-in renewal.
* Phone dialogs stack their buttons with the main action on top, away from the Android navigation bar.

## 1.3.0: Tailwind CSS 4 (2026-10-08)
* Styling moved to Tailwind CSS 4. Browsers: Chrome/Edge 111+, Safari 16.4+, Firefox 128+; Android System WebView 111+ (older phones get a page explaining how to update it).

## 1.2.1 (2026-10-08)
* The Android app names a server that is too old for phone sync instead of reporting a wrong password.

## 1.2.0: Phone sync (2026-10-07)
* The Android app can connect to your server and sync both ways, offline-first, with conflict handling that never loses a payment.

## 1.1.0: Android app (2026-10-07)
* Standalone Android app: data on the phone (SQLite), reminders as Android notifications, backup and restore to a file, signed release builds.

## 1.0.0 (2026-10-07)
* First release: bills and events with independent occurrences, recurrence, calendar, dashboard, reminders (in-app, email, Web Push), PWA, multi-user, Docker deployment, backups.
