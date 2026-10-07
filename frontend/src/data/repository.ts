import type {
  AppNotification,
  Bill,
  BillInput,
  BillOccurrence,
  BillOccurrenceQuery,
  CalendarEvent,
  CalendarFeed,
  CalendarFilter,
  Category,
  CategoryInput,
  CategoryType,
  CategoryUpdate,
  CompleteBillBody,
  Dashboard,
  EventInput,
  EventOccurrence,
  EventOccurrenceQuery,
  HistoryEntry,
  HistoryKind,
  NotesBody,
  NotificationQuery,
  ProfileData,
  Settings,
  TemplateListQuery,
  UpdateBillOccurrenceBody,
  UpdateEventOccurrenceBody,
  User,
} from '@skr/core';

/**
 * Everything the UI can read or change about a user's data.
 *
 * The screens talk only to this interface — never to HTTP directly — so the
 * same UI can run against different sources:
 *   - RemoteRepository: the self-hosted server's REST API (web app, today)
 *   - LocalRepository:  the on-device database (Android app, milestone 3+)
 *
 * Implementations must enforce the same rules: each occurrence is changed
 * individually, never through its template; OVERDUE is derived; events never
 * count toward money totals. Errors are thrown as exceptions with a readable
 * `message`.
 *
 * Account features that only exist with a server (sign-in, password reset,
 * push subscriptions…) are deliberately NOT part of this interface — see
 * `account.ts`.
 */
export interface DataRepository {
  /** Which kind of source this is (lets the UI hide server-only features). */
  readonly kind: 'remote' | 'local';

  // ── profile & settings ──
  getProfile(): Promise<ProfileData>;
  updateProfile(input: { displayName: string }): Promise<User>;
  updateSettings(patch: Partial<Settings>): Promise<Settings>;

  // ── categories ──
  listCategories(type?: CategoryType): Promise<Category[]>;
  createCategory(input: CategoryInput): Promise<Category>;
  updateCategory(id: string, input: CategoryUpdate): Promise<Category>;
  deleteCategory(id: string): Promise<void>;

  // ── bills (templates) ──
  listBills(query?: TemplateListQuery): Promise<Bill[]>;
  getBill(id: string): Promise<Bill>;
  createBill(input: BillInput): Promise<Bill>;
  updateBill(id: string, input: BillInput): Promise<Bill>;
  /** End (true) or resume (false) a recurring series. History is kept. */
  setBillArchived(id: string, archived: boolean): Promise<void>;
  /** Permanently deletes the template and all of its occurrences. */
  deleteBill(id: string): Promise<void>;

  // ── bill occurrences (each one independent) ──
  listBillOccurrences(query: BillOccurrenceQuery): Promise<BillOccurrence[]>;
  getBillOccurrence(id: string): Promise<BillOccurrence>;
  completeBillOccurrence(id: string, body?: CompleteBillBody): Promise<BillOccurrence>;
  skipBillOccurrence(id: string, body?: NotesBody): Promise<BillOccurrence>;
  reopenBillOccurrence(id: string): Promise<BillOccurrence>;
  updateBillOccurrence(id: string, body: UpdateBillOccurrenceBody): Promise<BillOccurrence>;

  // ── events (templates) ──
  listEvents(query?: TemplateListQuery): Promise<CalendarEvent[]>;
  getEvent(id: string): Promise<CalendarEvent>;
  createEvent(input: EventInput): Promise<CalendarEvent>;
  updateEvent(id: string, input: EventInput): Promise<CalendarEvent>;
  setEventArchived(id: string, archived: boolean): Promise<void>;
  deleteEvent(id: string): Promise<void>;

  // ── event occurrences ──
  listEventOccurrences(query: EventOccurrenceQuery): Promise<EventOccurrence[]>;
  getEventOccurrence(id: string): Promise<EventOccurrence>;
  completeEventOccurrence(id: string, body?: NotesBody): Promise<EventOccurrence>;
  cancelEventOccurrence(id: string, body?: NotesBody): Promise<EventOccurrence>;
  reopenEventOccurrence(id: string): Promise<EventOccurrence>;
  updateEventOccurrence(id: string, body: UpdateEventOccurrenceBody): Promise<EventOccurrence>;

  // ── views ──
  getCalendar(start: string, end: string, filter: CalendarFilter): Promise<CalendarFeed>;
  getDashboard(): Promise<Dashboard>;
  getHistory(kind: HistoryKind, id: string): Promise<HistoryEntry[]>;

  // ── notifications inbox ──
  listNotifications(query?: NotificationQuery): Promise<AppNotification[]>;
  getUnreadNotificationCount(): Promise<number>;
  markNotificationRead(id: string): Promise<void>;
  markAllNotificationsRead(): Promise<void>;

  // ── data portability ──
  /** Full JSON export of the user's data (same format for every source). */
  exportData(): Promise<unknown>;
}
