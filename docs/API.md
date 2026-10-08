# REST API

Base path: **`/api/v1`**. All request and response bodies are JSON.

* **Auth:** `Authorization: Bearer <accessToken>` on every endpoint except `/auth/*` and `/health`.
* **Dates:** calendar days are `"YYYY-MM-DD"` (the user's local day). Instants are ISO-8601 UTC. Times of day are `"HH:mm"` (24 h).
* **Money:** decimal strings such as `"120.50"`.
* **Errors:** `{"error": {"code": "VALIDATION_ERROR", "message": "...", "details": [{"path": "amount", "message": "..."}]}}`. Codes: `BAD_REQUEST`, `VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `ACCOUNT_LOCKED` (423), `EMAIL_NOT_VERIFIED`, `CSRF_FAILED`, `RATE_LIMITED` (429), `INTERNAL_ERROR`.
* **Isolation:** another user's ids return `404`.
* Every response carries `X-Request-Id`, which also appears in the server logs.

## Health
| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | liveness `{status, version, uptime}` |
| GET | `/api/health/ready` | readiness incl. DB check (503 if DB unreachable) |

## Auth `/auth`
| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/config` | – | `{registrationOpen, needsSetup, emailVerificationRequired, passwordResetEnabled, pushEnabled, emailNotificationsEnabled}` |
| POST | `/register` | `{email, password, displayName, timezone?}` | 201 → `{accessToken, expiresIn, user}` + cookies, or `{verificationRequired:true}` |
| POST | `/login` | `{email, password}` | `{accessToken, expiresIn, user}`; sets `skr_rt` (httpOnly) and `skr_csrf` cookies |
| POST | `/refresh` | – | requires `X-CSRF-Token` header = `skr_csrf` cookie; rotates the refresh token. Retrying with the previous token within 60 s (lost response, another tab) issues another one; older reuse revokes the session |
| POST | `/logout` | – | requires CSRF header; revokes the session |
| POST | `/logout-all` | – | Bearer; revokes every session and access token |
| POST | `/forgot-password` | `{email}` | always 200 |
| POST | `/reset-password` | `{token, password}` | revokes all sessions |
| POST | `/verify-email` | `{token}` | |
| POST | `/resend-verification` | `{email}` | always 200 |

**Android app (native) sign-in.** No cookies: the refresh token travels in the body and the app keeps it in its own storage. Each sign-in registers a *device*.

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/native/login` | `{email, password, deviceName?}` | `{accessToken, expiresIn, refreshToken, user, deviceId}` |
| POST | `/native/refresh` | `{refreshToken}` | rotates: `{accessToken, expiresIn, refreshToken, user, deviceId}`. Retrying with the previous token within 60 s (lost response) issues a new one and deletes the unseen one; older reuse revokes the device's sessions |
| POST | `/native/logout` | `{refreshToken}` | 204; signs the device out (its sessions and sync access) |

## Users & settings `/users`
| Method | Path | Description |
|---|---|---|
| GET | `/me` | `{user, settings}` |
| PATCH | `/me` | `{displayName}` |
| POST | `/me/password` | `{currentPassword, newPassword}`; signs out everywhere |
| DELETE | `/me` | `{password}`; deletes the account and all data |
| GET | `/me/export` | full JSON export |
| GET | `/settings` | settings |
| PUT | `/settings` | partial update: `timezone, theme, weekStartsOn, currency, locale, timeFormat, defaultCalendarView, defaultBillReminders[], defaultEventReminders[], allDayReminderTime, autoCompleteAutopay, inAppNotifications, emailNotifications, pushNotifications` |

## Categories `/categories`
| Method | Path | Description |
|---|---|---|
| GET | `/?type=BILL\|EVENT` | list with `usageCount` |
| POST | `/` | `{name, type, color?, icon?, sortOrder?}` |
| PATCH | `/:id` | `{name?, color?, icon?, sortOrder?}` |
| DELETE | `/:id` | items become uncategorised |

## Bills (templates) `/bills`
| Method | Path | Description |
|---|---|---|
| GET | `/?search&categoryId&archived=true\|false\|all&recurring=true\|false` | templates with `nextDueDate`, `overdueCount` |
| POST | `/` | create (see body below); generates occurrences |
| GET | `/:id` | template + `stats` per status |
| PUT | `/:id` | full update; reconciles untouched upcoming occurrences only |
| POST | `/:id/archive` | end the series (keeps history) |
| POST | `/:id/unarchive` | resume the series |
| DELETE | `/:id` | delete the template **and all its occurrences** (audited) |
| GET | `/:id/history` | template audit log |

Bill body:
```json
{
  "name": "Electric Bill",
  "amount": "120.50",
  "amountIsEstimate": false,
  "categoryId": "uuid | null",
  "description": "Acct 1234",
  "notes": null,
  "paymentMethod": "MANUAL | AUTOPAY | SCHEDULED_AUTOPAY",
  "scheduledPayDaysBefore": 3,
  "startDate": "2026-01-15",
  "dueTime": "17:00 | null",
  "recurrence": { "frequency": "MONTHLY", "interval": 1, "byWeekday": [], "endDate": null, "count": null },
  "reminderOffsets": [1440, 4320]
}
```
`amountIsEstimate: true` marks the amount as a guess (default `false`); occurrences copy it like the amount, and the actual figure is recorded as `amountPaid` when one is completed. `recurrence: null` creates a one-time bill. A custom interval is any `interval > 1` (for example `{"frequency": "WEEKLY", "interval": 2}`). Reminder offsets are minutes before the due instant (0 = at the time, max 43,200 = 30 days, up to 10). Responses include `recurrence.rrule` (RFC 5545).

## Bill occurrences `/bill-occurrences`
| Method | Path | Description |
|---|---|---|
| GET | `/?start&end&status=PENDING\|COMPLETED\|SKIPPED\|OVERDUE&billId&categoryId&order&limit` | list; materialises future occurrences on demand |
| GET | `/:id` | one occurrence |
| PATCH | `/:id` | `{dueDate?, dueTime?, amount?, amountIsEstimate?, notes?, confirmationNumber?, amountPaid?}`; marks `isModified` |
| POST | `/:id/complete` | `{completedAt?, amountPaid?, confirmationNumber?, notes?}` |
| POST | `/:id/skip` | `{notes?}` |
| POST | `/:id/reopen` | back to pending (shown as OVERDUE if past due) |
| GET | `/:id/history` | this occurrence's audit trail |

Occurrence shape:
```json
{
  "id": "…", "billId": "…", "name": "Electric Bill", "category": {"id":"…","name":"Utilities","color":"#0ea5e9","icon":null},
  "paymentMethod": "MANUAL", "isRecurring": true,
  "originalDueDate": "2026-02-15", "dueDate": "2026-02-15", "dueTime": null, "dueAt": "2026-02-15T15:00:00.000Z",
  "amount": "120.50", "amountIsEstimate": false, "status": "PENDING", "storedStatus": "PENDING",
  "completedAt": null, "amountPaid": null, "confirmationNumber": null, "notes": null,
  "scheduledPayDate": null, "isModified": false, "createdAt": "…", "updatedAt": "…"
}
```

## Events `/events` and `/event-occurrences`
These mirror bills. Event body: `{title, description?, notes?, location?, categoryId?, startDate, startTime?, endTime?, recurrence?, reminderOffsets?}`. Occurrence actions: `POST /event-occurrences/:id/complete`, `/cancel`, `/reopen`, and `PATCH /:id` (`{eventDate?, startTime?, endTime?, notes?}`). The list filter `status` takes `UPCOMING | COMPLETED | CANCELLED`.

## Calendar `/calendar`
`GET /calendar?start=YYYY-MM-DD&end=YYYY-MM-DD&type=all|bills|events&includeCompleted=true|false` (max 400 days)

```json
{ "timezone": "America/Chicago", "today": "2026-10-07",
  "items": [ { "id": "bill:<occId>", "kind": "bill", "occurrenceId": "…", "templateId": "…", "title": "Rent",
               "date": "2026-10-01", "allDay": true, "start": "2026-10-01", "end": null, "status": "OVERDUE",
               "amount": "1450.00", "amountIsEstimate": false, "paymentMethod": "MANUAL", "isRecurring": true, "color": "#6366f1", "categoryName": "Housing" } ] }
```
For bills, `amount` is what was paid once completed, otherwise the amount due (`amountIsEstimate` then says whether it is a guess).

## Dashboard `/dashboard`
Returns `today`, `range`, `billsDueToday`, `billsDueThisWeek`, `billsDueThisMonth`, `overdueBills`, `upcomingEvents` (30 days), `recentlyCompletedBills`, `recentlyCompletedEvents`, and `summary.{today,week,month,overdue}` = `{counts, total, paid, remaining, overdue}`. Only bills contribute to money totals.

## Notifications `/notifications` and `/push`
| Method | Path | Description |
|---|---|---|
| GET | `/notifications?unreadOnly&limit` | in-app inbox |
| GET | `/notifications/unread-count` | `{count}` |
| POST | `/notifications/:id/read` · `/notifications/read-all` | mark read |
| DELETE | `/notifications/:id` | |
| POST | `/notifications/test` | send a test message on every enabled channel |
| GET | `/push/public-key` | `{enabled, publicKey}` |
| POST | `/push/subscriptions` | browser `PushSubscription` JSON |
| DELETE | `/push/subscriptions` | `{endpoint}` |

## Audit `/audit`
`GET /audit?entityType&entityId&before&limit` returns the signed-in user's own activity log.

## Sync `/sync` (Android app)
Phones keep their own SQLite database and exchange **whole rows** with the server. Record formats, validation and merge rules live in `packages/core/src/sync.ts` (shared by both sides). Dates are `YYYY-MM-DD`, instants ISO UTC, money `"0.00"`.

| Method | Path | Body / query | Notes |
|---|---|---|---|
| GET | `/pull` | `?since=<cursor>&limit=100..5000` | `{changes:{settings, categories, bills, events, billOccurrences, eventOccurrences, auditLogs}, deletes:[{entity,id}], cursor, hasMore, serverTime}`. Start with no `since`; repeat while `hasMore`. Rows can arrive more than once, so apply them idempotently |
| POST | `/push` | `{deviceId, batchId, changes:{…same keys…}, deletes:[{entity,id,deletedAt}]}` | up to 2000 rows per entity (body ≤ 8 MB). `{applied, adopt:[{entity,record}], remove:[{entity,id}], remapped:[{entity,from,to}], conflicts}`. Re-sending a `batchId` returns the first answer |
| GET | `/devices` | – | signed-in phones: `{id, name, platform, lastSyncAt, createdAt}` |
| DELETE | `/devices/:id` | – | signs that phone out |

**After a push** the phone applies `remapped` first (rename the local row and references), then replaces local rows with each `adopt` record and deletes each `remove` entry.

**Merge rules** (server and phone apply the same ones):
* Last writer wins per record, by `updatedAt`; a tie keeps the server's copy.
* An occurrence's **status** (paid / skipped / cancelled / reopened, with completion fields) is decided by `statusChangedAt`, so an edit made elsewhere can never undo a payment; only a later explicit status change (e.g. reopen) can. `isModified` never switches back off.
* Deleting a **template or category** wins over edits to it made elsewhere.
* An **occurrence** removed on one side (template rescheduled) but paid, skipped or edited later on the other side is kept and comes back.
* Same category name on both sides becomes one category with the server's id; the same schedule slot under two ids becomes the server's row.
* Records may carry `baseUpdatedAt` (the server copy the edit started from). When the server copy changed since, the replaced values are written to the record's history as `SYNC_CONFLICT`.
* Notification switches (in-app / email / push) are per device and not synced.

**How changes are tracked:** a trigger stamps every write to a synced table with the writing transaction id (`sync_xid`), and deletes leave `sync_tombstones`. A pull returns rows from `since` onward and hands out the snapshot's *xmin* as the next cursor, so a transaction that commits after a later one is never skipped. The web app needs no changes: its writes are tracked the same way.

