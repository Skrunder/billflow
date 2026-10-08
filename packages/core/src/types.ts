/**
 * API data contracts shared by the server (serializers), the web app and the
 * Android app. Dates are "YYYY-MM-DD" local days, instants are ISO-8601 UTC
 * strings and money is a decimal string such as "120.50".
 */

export type Role = 'ADMIN' | 'USER';
export type Theme = 'SYSTEM' | 'LIGHT' | 'DARK';
export type CategoryType = 'BILL' | 'EVENT';
export type PaymentMethod = 'MANUAL' | 'AUTOPAY' | 'SCHEDULED_AUTOPAY';
export type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
/** Status values actually stored for a bill occurrence. */
export type StoredBillStatus = 'PENDING' | 'COMPLETED' | 'SKIPPED';
/** Status as shown to users — OVERDUE is derived (see status.ts). */
export type BillStatus = StoredBillStatus | 'OVERDUE';
export type EventStatus = 'UPCOMING' | 'COMPLETED' | 'CANCELLED';
export type TimeFormat = '12h' | '24h';
export type CalendarView = 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay' | 'listMonth';

export interface User {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  emailVerified: boolean;
  createdAt: string;
}

export interface Settings {
  timezone: string;
  theme: Theme;
  weekStartsOn: number;
  currency: string;
  locale: string;
  timeFormat: TimeFormat;
  defaultCalendarView: CalendarView;
  defaultBillReminders: number[];
  defaultEventReminders: number[];
  allDayReminderTime: string;
  autoCompleteAutopay: boolean;
  inAppNotifications: boolean;
  emailNotifications: boolean;
  pushNotifications: boolean;
  updatedAt: string;
}

export interface AuthResponse {
  accessToken: string;
  expiresIn: number;
  user: User;
}

export interface ServerConfig {
  registrationOpen: boolean;
  needsSetup: boolean;
  emailVerificationRequired: boolean;
  passwordResetEnabled: boolean;
  pushEnabled: boolean;
  emailNotificationsEnabled: boolean;
}

export interface CategoryLite {
  id: string;
  name: string;
  color: string;
  icon: string | null;
}

export interface Category extends CategoryLite {
  type: CategoryType;
  sortOrder: number;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Recurrence {
  frequency: Frequency;
  interval: number;
  byWeekday: number[];
  endDate: string | null;
  count: number | null;
  rrule?: string | null;
}

export interface Bill {
  id: string;
  name: string;
  description: string | null;
  notes: string | null;
  amount: string;
  /** The amount is a guess; the real figure is entered when the bill is paid. */
  amountIsEstimate: boolean;
  category: CategoryLite | null;
  categoryId: string | null;
  paymentMethod: PaymentMethod;
  scheduledPayDaysBefore: number | null;
  startDate: string;
  dueTime: string | null;
  isRecurring: boolean;
  recurrence: Recurrence | null;
  reminderOffsets: number[];
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
  nextDueDate?: string | null;
  overdueCount?: number;
  stats?: Partial<Record<'PENDING' | 'COMPLETED' | 'SKIPPED', { count: number; amountPaid: string }>>;
}

export interface BillOccurrence {
  id: string;
  billId: string;
  name: string;
  description: string | null;
  category: CategoryLite | null;
  paymentMethod: PaymentMethod;
  isRecurring: boolean;
  originalDueDate: string;
  dueDate: string;
  dueTime: string | null;
  dueAt: string;
  amount: string;
  amountIsEstimate: boolean;
  status: BillStatus;
  storedStatus: StoredBillStatus;
  completedAt: string | null;
  amountPaid: string | null;
  confirmationNumber: string | null;
  notes: string | null;
  scheduledPayDate: string | null;
  isModified: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  description: string | null;
  notes: string | null;
  location: string | null;
  category: CategoryLite | null;
  categoryId: string | null;
  startDate: string;
  startTime: string | null;
  endTime: string | null;
  allDay: boolean;
  isRecurring: boolean;
  recurrence: Recurrence | null;
  reminderOffsets: number[];
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
  nextDate?: string | null;
  stats?: Partial<Record<EventStatus, { count: number }>>;
}

export interface EventOccurrence {
  id: string;
  eventId: string;
  title: string;
  description: string | null;
  location: string | null;
  category: CategoryLite | null;
  isRecurring: boolean;
  originalDate: string;
  eventDate: string;
  startTime: string | null;
  endTime: string | null;
  allDay: boolean;
  startAt: string;
  endAt: string | null;
  status: EventStatus;
  completedAt: string | null;
  cancelledAt: string | null;
  notes: string | null;
  isModified: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarItem {
  id: string;
  kind: 'bill' | 'event';
  occurrenceId: string;
  templateId: string;
  title: string;
  date: string;
  allDay: boolean;
  start: string;
  end: string | null;
  status: BillStatus | EventStatus;
  /** Bills: what was paid once completed, otherwise the amount due. */
  amount: string | null;
  amountIsEstimate: boolean;
  paymentMethod: PaymentMethod | null;
  isRecurring: boolean;
  color: string | null;
  categoryName: string | null;
}

export interface PeriodSummary {
  counts: { total: number; pending: number; completed: number; skipped: number; overdue: number };
  total: string;
  paid: string;
  remaining: string;
  overdue: string;
  /** Some of what is still to pay is estimated. */
  estimated: boolean;
}

export interface Dashboard {
  today: string;
  timezone: string;
  currency: string;
  range: { weekStart: string; weekEnd: string; monthStart: string; monthEnd: string };
  billsDueToday: BillOccurrence[];
  billsDueThisWeek: BillOccurrence[];
  billsDueThisMonth: BillOccurrence[];
  overdueBills: BillOccurrence[];
  upcomingEvents: EventOccurrence[];
  recentlyCompletedBills: BillOccurrence[];
  recentlyCompletedEvents: EventOccurrence[];
  summary: Record<'today' | 'week' | 'month' | 'overdue', PeriodSummary>;
}

export interface AppNotification {
  id: string;
  title: string;
  body: string;
  url: string | null;
  scheduledFor: string;
  readAt: string | null;
  billOccurrenceId: string | null;
  eventOccurrenceId: string | null;
}

export interface HistoryEntry {
  id: string;
  action: string;
  actorType: 'USER' | 'SYSTEM';
  changes: Record<string, { from: unknown; to: unknown }> | null;
  createdAt: string;
}

// ───────────────────────────────────────── request & query shapes ──
// Shared by every data source (server API today, on-device database next).

export type RecurrenceInputValue = Omit<Recurrence, 'rrule'>;

export interface ProfileData {
  user: User;
  settings: Settings;
}

export interface CategoryInput {
  name: string;
  type: CategoryType;
  color: string;
}

export type CategoryUpdate = Partial<Pick<CategoryInput, 'name' | 'color'>>;

export interface BillInput {
  name: string;
  description: string | null;
  notes: string | null;
  amount: string;
  /** Default false. */
  amountIsEstimate?: boolean;
  categoryId: string | null;
  paymentMethod: PaymentMethod;
  scheduledPayDaysBefore: number | null;
  startDate: string;
  dueTime: string | null;
  recurrence: RecurrenceInputValue | null;
  reminderOffsets: number[];
}

export interface EventInput {
  title: string;
  description: string | null;
  notes: string | null;
  location: string | null;
  categoryId: string | null;
  startDate: string;
  startTime: string | null;
  endTime: string | null;
  recurrence: RecurrenceInputValue | null;
  reminderOffsets: number[];
}

/** Filters for template lists. Empty strings mean "no filter". */
export interface TemplateListQuery {
  search?: string;
  categoryId?: string;
  archived?: 'true' | 'false' | 'all';
  recurring?: 'true' | 'false';
}

export interface BillOccurrenceQuery {
  start?: string;
  end?: string;
  status?: BillStatus;
  billId?: string;
  categoryId?: string;
  order?: 'asc' | 'desc';
  limit?: number;
}

export interface EventOccurrenceQuery {
  start?: string;
  end?: string;
  status?: EventStatus;
  eventId?: string;
  categoryId?: string;
  order?: 'asc' | 'desc';
  limit?: number;
}

export interface CompleteBillBody {
  completedAt?: string;
  amountPaid?: string | null;
  confirmationNumber?: string | null;
  notes?: string | null;
}

export interface UpdateBillOccurrenceBody {
  dueDate?: string;
  dueTime?: string | null;
  amount?: string;
  amountIsEstimate?: boolean;
  notes?: string | null;
  confirmationNumber?: string | null;
}

export interface NotesBody {
  notes?: string | null;
}

export interface UpdateEventOccurrenceBody {
  eventDate?: string;
  startTime?: string | null;
  endTime?: string | null;
  notes?: string | null;
}

export type CalendarFilter = 'all' | 'bills' | 'events';

export interface CalendarFeed {
  timezone: string;
  today: string;
  items: CalendarItem[];
}

export type HistoryKind = 'bills' | 'bill-occurrences' | 'events' | 'event-occurrences';

export interface NotificationQuery {
  unreadOnly?: boolean;
  limit?: number;
}
