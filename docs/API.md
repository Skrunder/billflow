# REST API

Base path: **`/api/v1`**. All request and response bodies are JSON.

* **Auth:** `Authorization: Bearer <accessToken>` on every endpoint except `/auth/*` and `/health`.
* **Dates:** calendar days are `"YYYY-MM-DD"` (the user's local day). Instants are ISO-8601 UTC. Times of day are `"HH:mm"` (24 h).
* **Money:** decimal strings such as `"120.50"`.
* **Errors:** `{"error": {"code": "VALIDATION_ERROR", "message": "...", "details": [{"path": "amount", "message": "..."}]}}`. Codes: `BAD_REQUEST`, `VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `ACCOUNT_LOCKED` (423), `EMAIL_NOT_VERIFIED`, `CSRF_FAILED`, `TOKEN_ROTATED` (409), `RATE_LIMITED` (429), `INTERNAL_ERROR`.
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
| POST | `/refresh` | – | requires `X-CSRF-Token` header = `skr_csrf` cookie; rotates the refresh token |
| POST | `/logout` | – | requires CSRF header; revokes the session |
| POST | `/logout-all` | – | Bearer; revokes every session and access token |
| POST | `/forgot-password` | `{email}` | always 200 |
| POST | `/reset-password` | `{token, password}` | revokes all sessions |
| POST | `/verify-email` | `{token}` | |
| POST | `/resend-verification` | `{email}` | always 200 |

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
`recurrence: null` creates a one-time bill. A custom interval is any `interval > 1` (for example `{"frequency": "WEEKLY", "interval": 2}`). Reminder offsets are minutes before the due instant (0 = at the time, max 43,200 = 30 days, up to 10). Responses include `recurrence.rrule` (RFC 5545).

## Bill occurrences `/bill-occurrences`
| Method | Path | Description |
|---|---|---|
| GET | `/?start&end&status=PENDING\|COMPLETED\|SKIPPED\|OVERDUE&billId&categoryId&order&limit` | list; materialises future occurrences on demand |
| GET | `/:id` | one occurrence |
| PATCH | `/:id` | `{dueDate?, dueTime?, amount?, notes?, confirmationNumber?, amountPaid?}`; marks `isModified` |
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
  "amount": "120.50", "status": "PENDING", "storedStatus": "PENDING",
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
               "amount": "1450.00", "paymentMethod": "MANUAL", "isRecurring": true, "color": "#6366f1", "categoryName": "Housing" } ] }
```

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
