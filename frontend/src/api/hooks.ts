import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
  BillInput,
  BillOccurrenceQuery,
  CalendarFilter,
  CategoryInput,
  CategoryType,
  CompleteBillBody,
  EventInput,
  EventOccurrenceQuery,
  HistoryKind,
  NotesBody,
  ProfileData,
  Settings,
  TemplateListQuery,
  UpdateBillOccurrenceBody,
  UpdateEventOccurrenceBody,
} from '@skr/core';
import * as account from '../data/account';
import { useRepository } from '../data/RepositoryProvider';

/**
 * React Query hooks for every screen. All data access goes through the
 * DataRepository from <RepositoryProvider>, so these hooks work unchanged
 * against the server or the on-device database.
 */

export type { BillInput, CategoryInput, EventInput };

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

// ─────────────────────────────────────────── account (server only) ──

export const useServerConfig = () =>
  useQuery({ queryKey: ['config'], queryFn: account.getServerConfig, staleTime: 60_000 });

export const useChangePassword = () =>
  useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string }) =>
      account.changePassword(body.currentPassword, body.newPassword),
  });

// ──────────────────────────────────────────── profile & settings ──

export const useMe = (enabled = true) => {
  const repo = useRepository();
  return useQuery({ queryKey: ['me'], queryFn: () => repo.getProfile(), enabled, staleTime: 5 * 60_000 });
};

export function useUpdateSettings() {
  const repo = useRepository();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Settings>) => repo.updateSettings(patch),
    onSuccess: (settings) => {
      qc.setQueryData<ProfileData>(['me'], (old) => (old ? { ...old, settings } : old));
      return invalidateData(qc);
    },
  });
}

export function useUpdateProfile() {
  const repo = useRepository();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { displayName: string }) => repo.updateProfile(body),
    onSuccess: (user) => qc.setQueryData<ProfileData>(['me'], (old) => (old ? { ...old, user } : old)),
  });
}

// ──────────────────────────────────────────────────── categories ──

export const useCategories = (type?: CategoryType) => {
  const repo = useRepository();
  return useQuery({
    queryKey: ['categories', type ?? 'all'],
    queryFn: () => repo.listCategories(type),
    staleTime: 5 * 60_000,
  });
};

export function useSaveCategory() {
  const repo = useRepository();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<CategoryInput> & { id?: string }) =>
      id
        ? repo.updateCategory(id, { name: body.name, color: body.color })
        : repo.createCategory(body as CategoryInput),
    onSuccess: () => invalidateData(qc),
  });
}

export function useDeleteCategory() {
  const repo = useRepository();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => repo.deleteCategory(id),
    onSuccess: () => invalidateData(qc),
  });
}

// ──────────────────────────────────────────────────────── bills ──

export const useBills = (query: TemplateListQuery = {}) => {
  const repo = useRepository();
  return useQuery({ queryKey: ['bills', query], queryFn: () => repo.listBills(query) });
};

export const useBill = (id: string | undefined) => {
  const repo = useRepository();
  return useQuery({ queryKey: ['bill', id], queryFn: () => repo.getBill(id!), enabled: Boolean(id) });
};

export function useSaveBill() {
  const repo = useRepository();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: BillInput }) => (id ? repo.updateBill(id, input) : repo.createBill(input)),
    onSuccess: () => invalidateData(qc),
  });
}

export function useBillTemplateAction() {
  const repo = useRepository();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'archive' | 'unarchive' | 'delete' }) =>
      action === 'delete' ? repo.deleteBill(id) : repo.setBillArchived(id, action === 'archive'),
    onSuccess: () => invalidateData(qc),
  });
}

export const useBillOccurrences = (query: BillOccurrenceQuery, enabled = true) => {
  const repo = useRepository();
  return useQuery({ queryKey: ['bill-occurrences', query], queryFn: () => repo.listBillOccurrences(query), enabled });
};

export const useBillOccurrence = (id: string | null) => {
  const repo = useRepository();
  return useQuery({ queryKey: ['bill-occurrence', id], queryFn: () => repo.getBillOccurrence(id!), enabled: Boolean(id) });
};

export type BillOccurrenceAction =
  | { id: string; action: 'complete'; body?: CompleteBillBody }
  | { id: string; action: 'skip'; body?: NotesBody }
  | { id: string; action: 'reopen' }
  | { id: string; action: 'update'; body: UpdateBillOccurrenceBody };

export function useBillOccurrenceAction() {
  const repo = useRepository();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: BillOccurrenceAction) => {
      switch (a.action) {
        case 'complete':
          return repo.completeBillOccurrence(a.id, a.body);
        case 'skip':
          return repo.skipBillOccurrence(a.id, a.body);
        case 'reopen':
          return repo.reopenBillOccurrence(a.id);
        case 'update':
          return repo.updateBillOccurrence(a.id, a.body);
      }
    },
    onSuccess: (occ) => {
      qc.setQueryData(['bill-occurrence', occ.id], occ);
      return invalidateData(qc);
    },
  });
}

// ─────────────────────────────────────────────────────── events ──

export const useEvents = (query: TemplateListQuery = {}) => {
  const repo = useRepository();
  return useQuery({ queryKey: ['events', query], queryFn: () => repo.listEvents(query) });
};

export const useEvent = (id: string | undefined) => {
  const repo = useRepository();
  return useQuery({ queryKey: ['event', id], queryFn: () => repo.getEvent(id!), enabled: Boolean(id) });
};

export function useSaveEvent() {
  const repo = useRepository();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: EventInput }) => (id ? repo.updateEvent(id, input) : repo.createEvent(input)),
    onSuccess: () => invalidateData(qc),
  });
}

export function useEventTemplateAction() {
  const repo = useRepository();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'archive' | 'unarchive' | 'delete' }) =>
      action === 'delete' ? repo.deleteEvent(id) : repo.setEventArchived(id, action === 'archive'),
    onSuccess: () => invalidateData(qc),
  });
}

export const useEventOccurrences = (query: EventOccurrenceQuery, enabled = true) => {
  const repo = useRepository();
  return useQuery({ queryKey: ['event-occurrences', query], queryFn: () => repo.listEventOccurrences(query), enabled });
};

export const useEventOccurrence = (id: string | null) => {
  const repo = useRepository();
  return useQuery({ queryKey: ['event-occurrence', id], queryFn: () => repo.getEventOccurrence(id!), enabled: Boolean(id) });
};

export type EventOccurrenceAction =
  | { id: string; action: 'complete' | 'cancel'; body?: NotesBody }
  | { id: string; action: 'reopen' }
  | { id: string; action: 'update'; body: UpdateEventOccurrenceBody };

export function useEventOccurrenceAction() {
  const repo = useRepository();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: EventOccurrenceAction) => {
      switch (a.action) {
        case 'complete':
          return repo.completeEventOccurrence(a.id, a.body);
        case 'cancel':
          return repo.cancelEventOccurrence(a.id, a.body);
        case 'reopen':
          return repo.reopenEventOccurrence(a.id);
        case 'update':
          return repo.updateEventOccurrence(a.id, a.body);
      }
    },
    onSuccess: (occ) => {
      qc.setQueryData(['event-occurrence', occ.id], occ);
      return invalidateData(qc);
    },
  });
}

// ───────────────────────────────────────── calendar & dashboard ──

export const useCalendar = (start: string | null, end: string | null, filter: CalendarFilter) => {
  const repo = useRepository();
  return useQuery({
    queryKey: ['calendar', start, end, filter],
    queryFn: () => repo.getCalendar(start!, end!, filter),
    enabled: Boolean(start && end),
    placeholderData: (prev) => prev,
  });
};

export const useDashboard = () => {
  const repo = useRepository();
  return useQuery({ queryKey: ['dashboard'], queryFn: () => repo.getDashboard() });
};

export const useHistory = (kind: HistoryKind, id: string | null) => {
  const repo = useRepository();
  return useQuery({ queryKey: ['history', kind, id], queryFn: () => repo.getHistory(kind, id!), enabled: Boolean(id) });
};

// ────────────────────────────────────────────── notifications ──

export const useNotifications = () => {
  const repo = useRepository();
  return useQuery({ queryKey: ['notifications'], queryFn: () => repo.listNotifications({ limit: 100 }) });
};

export const useUnreadCount = (enabled = true) => {
  const repo = useRepository();
  return useQuery({
    queryKey: ['unread-count'],
    queryFn: async () => ({ count: await repo.getUnreadNotificationCount() }),
    refetchInterval: 60_000,
    enabled,
  });
};

export function useMarkNotifications() {
  const repo = useRepository();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id?: string) => (id ? repo.markNotificationRead(id) : repo.markAllNotificationsRead()),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      void qc.invalidateQueries({ queryKey: ['unread-count'] });
    },
  });
}

/** Full export of the user's data, from whichever source is active. */
export function useExportData() {
  const repo = useRepository();
  return useMutation({ mutationFn: () => repo.exportData() });
}
