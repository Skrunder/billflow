import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from './client';
import type {
  AppNotification,
  Bill,
  BillOccurrence,
  CalendarEvent,
  CalendarItem,
  Category,
  CategoryType,
  Dashboard,
  EventOccurrence,
  HistoryEntry,
  Recurrence,
  ServerConfig,
  Settings,
  User,
} from '@skr/core';

type Query = Record<string, string | number | boolean | undefined | null>;

/** Everything that may change when any bill / event data changes. */
const DATA_KEYS = [
  'dashboard',
  'calendar',
  'bills',
  'bill',
  'bill-occurrences',
  'bill-occurrence',
  'events',
  'event',
  'event-occurrences',
  'event-occurrence',
  'history',
  'categories',
];

export function invalidateData(qc: QueryClient) {
  return Promise.all(DATA_KEYS.map((k) => qc.invalidateQueries({ queryKey: [k] })));
}

// ─────────────────────────────────────────────────── account ──

export const useServerConfig = () =>
  useQuery({ queryKey: ['config'], queryFn: () => api<ServerConfig>('/auth/config', { auth: false }), staleTime: 60_000 });

export const useMe = (enabled = true) =>
  useQuery({
    queryKey: ['me'],
    queryFn: () => api<{ user: User; settings: Settings }>('/users/me'),
    enabled,
    staleTime: 5 * 60_000,
  });

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (s: Partial<Settings>) => api<Settings>('/users/settings', { method: 'PUT', body: s }),
    onSuccess: (settings) => {
      qc.setQueryData<{ user: User; settings: Settings }>(['me'], (old) => (old ? { ...old, settings } : old));
      return invalidateData(qc);
    },
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { displayName: string }) => api<{ user: User }>('/users/me', { method: 'PATCH', body }),
    onSuccess: ({ user }) =>
      qc.setQueryData<{ user: User; settings: Settings }>(['me'], (old) => (old ? { ...old, user } : old)),
  });
}

export const useChangePassword = () =>
  useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string }) =>
      api<{ ok: boolean }>('/users/me/password', { method: 'POST', body }),
  });

// ──────────────────────────────────────────────── categories ──

export const useCategories = (type?: CategoryType) =>
  useQuery({
    queryKey: ['categories', type ?? 'all'],
    queryFn: () => api<Category[]>('/categories', { query: { type } }),
    staleTime: 5 * 60_000,
  });

export interface CategoryInput {
  name: string;
  type: CategoryType;
  color: string;
}

export function useSaveCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<CategoryInput> & { id?: string }) =>
      id
        ? api<Category>(`/categories/${id}`, { method: 'PATCH', body: { name: body.name, color: body.color } })
        : api<Category>('/categories', { method: 'POST', body }),
    onSuccess: () => invalidateData(qc),
  });
}

export function useDeleteCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/categories/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidateData(qc),
  });
}

// ──────────────────────────────────────────────────── bills ──

export interface BillInput {
  name: string;
  description: string | null;
  notes: string | null;
  amount: string;
  categoryId: string | null;
  paymentMethod: Bill['paymentMethod'];
  scheduledPayDaysBefore: number | null;
  startDate: string;
  dueTime: string | null;
  recurrence: Omit<Recurrence, 'rrule'> | null;
  reminderOffsets: number[];
}

export const useBills = (query: Query = {}) =>
  useQuery({ queryKey: ['bills', query], queryFn: () => api<Bill[]>('/bills', { query }) });

export const useBill = (id: string | undefined) =>
  useQuery({ queryKey: ['bill', id], queryFn: () => api<Bill>(`/bills/${id}`), enabled: Boolean(id) });

export function useSaveBill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: BillInput }) =>
      id ? api<Bill>(`/bills/${id}`, { method: 'PUT', body: input }) : api<Bill>('/bills', { method: 'POST', body: input }),
    onSuccess: () => invalidateData(qc),
  });
}

export function useBillTemplateAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'archive' | 'unarchive' | 'delete' }) =>
      action === 'delete'
        ? api<unknown>(`/bills/${id}`, { method: 'DELETE' })
        : api<unknown>(`/bills/${id}/${action}`, { method: 'POST' }),
    onSuccess: () => invalidateData(qc),
  });
}

export const useBillOccurrences = (query: Query, enabled = true) =>
  useQuery({
    queryKey: ['bill-occurrences', query],
    queryFn: () => api<BillOccurrence[]>('/bill-occurrences', { query }),
    enabled,
  });

export const useBillOccurrence = (id: string | null) =>
  useQuery({
    queryKey: ['bill-occurrence', id],
    queryFn: () => api<BillOccurrence>(`/bill-occurrences/${id}`),
    enabled: Boolean(id),
  });

export type BillOccurrenceAction =
  | { id: string; action: 'complete'; body?: { completedAt?: string; amountPaid?: string | null; confirmationNumber?: string | null; notes?: string | null } }
  | { id: string; action: 'skip'; body?: { notes?: string | null } }
  | { id: string; action: 'reopen' }
  | {
      id: string;
      action: 'update';
      body: { dueDate?: string; dueTime?: string | null; amount?: string; notes?: string | null; confirmationNumber?: string | null };
    };

export function useBillOccurrenceAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: BillOccurrenceAction) =>
      a.action === 'update'
        ? api<BillOccurrence>(`/bill-occurrences/${a.id}`, { method: 'PATCH', body: a.body })
        : api<BillOccurrence>(`/bill-occurrences/${a.id}/${a.action}`, { method: 'POST', body: 'body' in a ? (a.body ?? {}) : {} }),
    onSuccess: (occ) => {
      qc.setQueryData(['bill-occurrence', occ.id], occ);
      return invalidateData(qc);
    },
  });
}

// ─────────────────────────────────────────────────── events ──

export interface EventInput {
  title: string;
  description: string | null;
  notes: string | null;
  location: string | null;
  categoryId: string | null;
  startDate: string;
  startTime: string | null;
  endTime: string | null;
  recurrence: Omit<Recurrence, 'rrule'> | null;
  reminderOffsets: number[];
}

export const useEvents = (query: Query = {}) =>
  useQuery({ queryKey: ['events', query], queryFn: () => api<CalendarEvent[]>('/events', { query }) });

export const useEvent = (id: string | undefined) =>
  useQuery({ queryKey: ['event', id], queryFn: () => api<CalendarEvent>(`/events/${id}`), enabled: Boolean(id) });

export function useSaveEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: EventInput }) =>
      id
        ? api<CalendarEvent>(`/events/${id}`, { method: 'PUT', body: input })
        : api<CalendarEvent>('/events', { method: 'POST', body: input }),
    onSuccess: () => invalidateData(qc),
  });
}

export function useEventTemplateAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'archive' | 'unarchive' | 'delete' }) =>
      action === 'delete'
        ? api<unknown>(`/events/${id}`, { method: 'DELETE' })
        : api<unknown>(`/events/${id}/${action}`, { method: 'POST' }),
    onSuccess: () => invalidateData(qc),
  });
}

export const useEventOccurrences = (query: Query, enabled = true) =>
  useQuery({
    queryKey: ['event-occurrences', query],
    queryFn: () => api<EventOccurrence[]>('/event-occurrences', { query }),
    enabled,
  });

export const useEventOccurrence = (id: string | null) =>
  useQuery({
    queryKey: ['event-occurrence', id],
    queryFn: () => api<EventOccurrence>(`/event-occurrences/${id}`),
    enabled: Boolean(id),
  });

export type EventOccurrenceAction =
  | { id: string; action: 'complete' | 'cancel'; body?: { notes?: string | null } }
  | { id: string; action: 'reopen' }
  | { id: string; action: 'update'; body: { eventDate?: string; startTime?: string | null; endTime?: string | null; notes?: string | null } };

export function useEventOccurrenceAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: EventOccurrenceAction) =>
      a.action === 'update'
        ? api<EventOccurrence>(`/event-occurrences/${a.id}`, { method: 'PATCH', body: a.body })
        : api<EventOccurrence>(`/event-occurrences/${a.id}/${a.action}`, { method: 'POST', body: 'body' in a ? (a.body ?? {}) : {} }),
    onSuccess: (occ) => {
      qc.setQueryData(['event-occurrence', occ.id], occ);
      return invalidateData(qc);
    },
  });
}

// ─────────────────────────────────────── calendar & dashboard ──

export const useCalendar = (start: string | null, end: string | null, type: 'all' | 'bills' | 'events') =>
  useQuery({
    queryKey: ['calendar', start, end, type],
    queryFn: () =>
      api<{ timezone: string; today: string; items: CalendarItem[] }>('/calendar', { query: { start, end, type } }),
    enabled: Boolean(start && end),
    placeholderData: (prev) => prev,
  });

export const useDashboard = () => useQuery({ queryKey: ['dashboard'], queryFn: () => api<Dashboard>('/dashboard') });

export const useHistory = (kind: 'bills' | 'bill-occurrences' | 'events' | 'event-occurrences', id: string | null) =>
  useQuery({
    queryKey: ['history', kind, id],
    queryFn: () => api<HistoryEntry[]>(`/${kind}/${id}/history`),
    enabled: Boolean(id),
  });

// ──────────────────────────────────────────── notifications ──

export const useNotifications = () =>
  useQuery({ queryKey: ['notifications'], queryFn: () => api<AppNotification[]>('/notifications', { query: { limit: 100 } }) });

export const useUnreadCount = (enabled = true) =>
  useQuery({
    queryKey: ['unread-count'],
    queryFn: () => api<{ count: number }>('/notifications/unread-count'),
    refetchInterval: 60_000,
    enabled,
  });

export function useMarkNotifications() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id?: string) =>
      id ? api(`/notifications/${id}/read`, { method: 'POST' }) : api('/notifications/read-all', { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      void qc.invalidateQueries({ queryKey: ['unread-count'] });
    },
  });
}
