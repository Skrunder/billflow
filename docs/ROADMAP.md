# Development roadmap & milestones

## ✅ v1.0: Foundation (this release)

| Milestone | Scope | Status |
|---|---|---|
| M1 · Platform | Monorepo, Docker images (non-root, health checks), Compose stack, env validation, structured logging, migrations-on-start | Done |
| M2 · Data model | Users, settings, categories, bill and event templates, **independent occurrence tables**, notifications, push subscriptions, audit logs, integrity CHECKs | Done |
| M3 · Auth & security | bcrypt, JWT access + rotating refresh with reuse detection, CSRF double-submit, rate limits, lockout, password reset, optional email verification, admin CLI | Done |
| M4 · Recurrence engine | Daily/weekly(+weekdays)/monthly/yearly with custom intervals, end date/count, month-end and leap-day clamping, horizon materialisation, safe in-place reconciliation on edits, RRULE output | Done |
| M5 · Bills & events API | CRUD, per-occurrence complete/skip/cancel/reopen/edit with audit, archive (end series), calendar feed, dashboard summaries | Done |
| M6 · Reminders | Offset reminders (presets + custom), idempotent planning, in-app inbox, SMTP email, Web Push (VAPID), auto-pay completion | Done |
| M7 · Web app | Dashboard, FullCalendar (month/week/day/agenda + filters), bills, events, categories, settings, notifications, light/dark, responsive, accessible | Done |
| M8 · PWA | Manifest + icons (Android/iOS/maskable), service worker app shell, offline read-only mode with persisted cache, push handling | Done |
| M9 · Operations | Backup sidecar, backup/restore scripts, JSON export, docs for Unraid/TrueNAS/Synology/Portainer/Proxmox and reverse proxies, CI | Done |

## v1.1: Quality of life
* iCalendar (`.ics`) subscription feed per user (read-only, token URL) for Google, Apple and Outlook calendars
* Bulk "mark all due today paid", undo toast
* Attach receipts/statements to occurrences (uses the existing `/app/data` volume)
* Spending reports: monthly totals by category and year-over-year charts (bills only)
* Admin page in the UI (user list, disable/enable, registration toggle)
* Translations (i18n) and locale-aware date input

## v1.2: Notifications+
* SMS channel (Twilio / generic webhook) via the existing `NotificationChannel.SMS`
* Ntfy / Gotify / Apprise / Discord webhooks, which suit home labs well
* Daily digest email ("what's due this week")
* Per-category default reminders

## v2.0: Sharing
* **Shared calendars and family accounts:** `households` + `household_members` (role: owner/editor/viewer). Templates and occurrences get an optional `household_id`, and the owner-scoping predicate expands to include memberships.
* Assign a bill to a member, with "who paid" on completion
* Activity feed per household

## v2.x: Integrations
* Two-way Google Calendar / Microsoft Graph (Outlook) sync for events, mapping occurrences to RRULE exceptions (`originalDueDate` is the stable recurrence id)
* Optional OIDC single sign-on (Authelia, Authentik, Keycloak)
* Native mobile wrapper (Capacitor) on the same `/api/v1`
* Multi-instance mode: Postgres-backed rate-limit store and a single scheduler leader via advisory lock

## Engineering standards (ongoing)
* Every change: typecheck, unit and integration tests in CI, image build
* Migrations follow expand → migrate → contract; no destructive change outside a major version
* Dependencies pinned exactly; monthly update pass with Dependabot/Renovate
