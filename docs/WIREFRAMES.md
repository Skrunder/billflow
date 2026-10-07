# UI wireframes

These describe the shipped UI. Desktop (≥ 768 px) uses a left sidebar. Mobile uses a top bar plus a bottom tab bar (Dashboard · Calendar · Bills · Events · Settings), and dialogs become bottom sheets. Every screen supports light and dark themes.

## App shell

```
┌──────────────┬──────────────────────────────────────────────────────────┐
│ [icon] SKR's │                                          🔔(2)  [+ New ▾]│
│ Bill Calendar├──────────────────────────────────────────────────────────┤
│              │ ⚠ You're offline — showing saved data.   (only offline)  │
│ ▣ Dashboard  │                                                          │
│ ▦ Calendar   │                    <page content>                        │
│ $ Bills      │                                                          │
│ ♥ Events     │                                                          │
│ # Categories │                                                          │
│ ⚙ Settings   │                                                          │
│──────────────│                                                          │
│ Sam Admin    │                                                          │
│ ⇥ Sign out   │                                                          │
└──────────────┴──────────────────────────────────────────────────────────┘
```
*+ New* opens a menu: New bill / New event. The bell shows the unread count and links to Notifications.

## Dashboard

```
Good afternoon, Sam
Wednesday, October 7, 2026

┌ DUE TODAY ───┐┌ THIS WEEK ───┐┌ THIS MONTH ──────┐┌ OVERDUE ─────┐
│ $96.20       ││ $111.69      ││ 6% paid          ││ $1,492.10    │
│ 1 bill       ││ $0 of $111.69││ ▓░░░░░░ $120/$1.9k││ 2 bills      │
└──────────────┘└──────────────┘└──────────────────┘└──────────────┘
┌ Overdue bills (2) ──────────────────────────────────────────────────┐
│ ● Rent ↻         Thu, Oct 1 · Housing           $1,450.00 [Overdue] ✓│
│ ● Water          Sat, Oct 3 · Utilities            $42.10 [Overdue] ✓│
└──────────────────────────────────────────────────────────────────────┘
┌ Bills due today (1) ───────────┐┌ Upcoming events (8)    All events →┐
│ ● Car Insurance  5:00 PM $96.20✓││ ● Dentist   Thu Oct 8 2:30 PM [Up] │
└────────────────────────────────┘│ ● Mom's Birthday  Mon Oct 12  [Up] │
                                  └────────────────────────────────────┘
┌ Bills due this week (2)                              [Week | Month] ┐
│ …rows…                                                               │
└──────────────────────────────────────────────────────────────────────┘
┌ Recently completed bills ───────┐┌ Recently completed events ───────┐
```
Rows open the occurrence dialog. The ✓ button marks **only that occurrence** paid.

## Calendar

```
Calendar                                   [Bills & Events | Bills | Events]
Times shown in America/Chicago
┌──────────────────────────────────────────────────────────────────────┐
│ [‹][›] [Today]        October 2026        [Month|Week|Day|Agenda]    │
│ Sun   Mon        Tue   Wed          Thu           Fri        Sat     │
│                              1 💵$1,450 Rent(red) 2 📅Payday  3 💵Water│
│ 4     5 📅10:00 Staff    7 💵5PM $96.20 Car…  8 📅2:30 Dentist …      │
│ …  15 💵~~$120.50 Electric~~ (completed: faded + struck through)      │
└──────────────────────────────────────────────────────────────────────┘
```
* Bills show the amount and category colour. Overdue items are red with a left bar. Completed, skipped or cancelled items are faded and struck through.
* Clicking an item opens its occurrence dialog. Clicking an empty day asks "Add a Bill / Event on this date".
* Mobile defaults to the Agenda list with a Month/Agenda switch.

## Occurrence dialog (bill)

```
┌ Car Insurance ─────────────────────────────── ✕ ┐
│ [Details | History]                    [Pending] │
│ Due   Wed, Oct 7, 2026 · 5:00 PM   Amount $96.20 │
│ Payment Manual payment             Category ● Ins│
│ ✎ Edit this occurrence   ↗ View series           │
├──────────────────────────────────────────────────┤
│                         [⏭ Skip]  [✓ Mark paid]  │
└──────────────────────────────────────────────────┘
```
*Mark paid* expands to: Amount paid · Paid on (date-time) · Confirmation # → *Confirm payment*. It says explicitly that other occurrences stay unchanged.
Completed or skipped occurrences show *Reopen* instead. *History* lists this occurrence's audit entries (created, completed, reopened, edited with field diffs, auto-pay by system). Event dialogs offer *Mark completed* / *Cancel occurrence* / *Reopen*.

## Bills

```
Bills                                                    [+ New bill]
[Upcoming | Overdue | Completed | All bills]  [🔍 Search] [All categories ▾]
┌──────────────────────────────────────────────────────────────────┐
│ ● Rent ↻        Thu, Oct 1, 2026 · Housing     $1,450.00 [Overdue]✓│
│ …                                                                  │
```
*All bills* shows template cards: name, category, amount, "Monthly on day 15", ⚡ Auto-pay, next due date, overdue count. A checkbox includes ended series.

## Bill detail (series)

```
Rent                                     [✎ Edit] [End series] [🗑 Delete]
● Housing
┌ Summary ─────────────┐ ┌ [Occurrences | Series history]  [Upcoming|Past] ┐
│ $1,450.00            │ │ ● Thu, Oct 1, 2026                 $1,450 [Over]✓│
│ Monthly on day 1     │ │ ● Sun, Nov 1, 2026                 $1,450 [Pend]✓│
│ FREQ=MONTHLY         │ │ …                                                │
│ Payment: Manual      │ └──────────────────────────────────────────────────┘
│ Reminders: 1 day     │
│ Paid 0 · Pending 13  │
│ Total paid $0.00     │
└──────────────────────┘
```
*End series* keeps history and stops future occurrences. *Delete* removes everything, with a red confirmation that recommends End series instead.

## Bill / event form

Fields: Name · Amount · Category · Due date · Due time (checkbox, else all-day) · Payment method (Manual / Auto-pay / Scheduled auto-pay + "days before") · **Repeats** toggle → Frequency, *Every N units*, weekday chips (weekly), Ends: Never / On date / After N · **Reminders** preset chips (At time, 15 min, 1 hour, 1 day, 3 days, 7 days) plus custom "N minutes/hours/days before" · Description · Notes. Editing a recurring series shows a note that history is never altered.
The event form adds All day, Start/End time and Location, plus a note that events never affect totals.

## Categories

Two columns, *Bill categories* and *Event categories*. Each has an add row (colour picker + name + Add) and a list of colour dot, name, usage count, ✎ and 🗑. Deleting asks for confirmation and explains that items become uncategorised.

## Settings

Stacked cards that save automatically:
**Profile** (display name, email) · **Region & time** (timezone with "use this device's timezone", currency, locale, week start, 12/24 h) · **Appearance** (System/Light/Dark, default calendar view, manage categories) · **Reminders** (default bill/event reminders, all-day reminder time, auto-complete auto-pay) · **Notifications** (in-app, email, push toggles; enable push on this device; send test) · **Security** (change password, sign out everywhere) · **Your data** (export JSON, delete account with password confirmation).

## Auth screens

Centered card with the app icon: Sign in (email, password, forgot link, sign-up link when open). Create account, titled "Set up your server" for the first admin, notes the auto-detected timezone. Forgot password explains the CLI when SMTP is off. Reset password and Verify email complete the set.
