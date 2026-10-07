import type {
  AppNotification,
  Bill,
  BillOccurrence,
  CalendarEvent,
  CalendarFeed,
  Category,
  Dashboard,
  EventOccurrence,
  HistoryEntry,
  ProfileData,
  Settings,
  User,
} from '@skr/core';
import { api } from '../api/client';
import type { DataRepository } from './repository';

/**
 * DataRepository backed by the self-hosted server's REST API (/api/v1).
 * Each method is exactly one HTTP request; the server enforces all rules.
 */
export function createRemoteRepository(): DataRepository {
  const post = <T>(path: string, body: unknown = {}) => api<T>(path, { method: 'POST', body });

  return {
    kind: 'remote',

    // profile & settings
    getProfile: () => api<ProfileData>('/users/me'),
    updateProfile: async (input) => (await api<{ user: User }>('/users/me', { method: 'PATCH', body: input })).user,
    updateSettings: (patch) => api<Settings>('/users/settings', { method: 'PUT', body: patch }),

    // categories
    listCategories: (type) => api<Category[]>('/categories', { query: { type } }),
    createCategory: (input) => api<Category>('/categories', { method: 'POST', body: input }),
    updateCategory: (id, input) => api<Category>(`/categories/${id}`, { method: 'PATCH', body: input }),
    deleteCategory: (id) => api<void>(`/categories/${id}`, { method: 'DELETE' }),

    // bills
    listBills: (query = {}) => api<Bill[]>('/bills', { query: { ...query } }),
    getBill: (id) => api<Bill>(`/bills/${id}`),
    createBill: (input) => api<Bill>('/bills', { method: 'POST', body: input }),
    updateBill: (id, input) => api<Bill>(`/bills/${id}`, { method: 'PUT', body: input }),
    setBillArchived: async (id, archived) => {
      await post(`/bills/${id}/${archived ? 'archive' : 'unarchive'}`);
    },
    deleteBill: (id) => api<void>(`/bills/${id}`, { method: 'DELETE' }),

    // bill occurrences
    listBillOccurrences: (query) => api<BillOccurrence[]>('/bill-occurrences', { query: { ...query } }),
    getBillOccurrence: (id) => api<BillOccurrence>(`/bill-occurrences/${id}`),
    completeBillOccurrence: (id, body = {}) => post<BillOccurrence>(`/bill-occurrences/${id}/complete`, body),
    skipBillOccurrence: (id, body = {}) => post<BillOccurrence>(`/bill-occurrences/${id}/skip`, body),
    reopenBillOccurrence: (id) => post<BillOccurrence>(`/bill-occurrences/${id}/reopen`),
    updateBillOccurrence: (id, body) => api<BillOccurrence>(`/bill-occurrences/${id}`, { method: 'PATCH', body }),

    // events
    listEvents: (query = {}) => api<CalendarEvent[]>('/events', { query: { ...query } }),
    getEvent: (id) => api<CalendarEvent>(`/events/${id}`),
    createEvent: (input) => api<CalendarEvent>('/events', { method: 'POST', body: input }),
    updateEvent: (id, input) => api<CalendarEvent>(`/events/${id}`, { method: 'PUT', body: input }),
    setEventArchived: async (id, archived) => {
      await post(`/events/${id}/${archived ? 'archive' : 'unarchive'}`);
    },
    deleteEvent: (id) => api<void>(`/events/${id}`, { method: 'DELETE' }),

    // event occurrences
    listEventOccurrences: (query) => api<EventOccurrence[]>('/event-occurrences', { query: { ...query } }),
    getEventOccurrence: (id) => api<EventOccurrence>(`/event-occurrences/${id}`),
    completeEventOccurrence: (id, body = {}) => post<EventOccurrence>(`/event-occurrences/${id}/complete`, body),
    cancelEventOccurrence: (id, body = {}) => post<EventOccurrence>(`/event-occurrences/${id}/cancel`, body),
    reopenEventOccurrence: (id) => post<EventOccurrence>(`/event-occurrences/${id}/reopen`),
    updateEventOccurrence: (id, body) => api<EventOccurrence>(`/event-occurrences/${id}`, { method: 'PATCH', body }),

    // views
    getCalendar: (start, end, filter) => api<CalendarFeed>('/calendar', { query: { start, end, type: filter } }),
    getDashboard: () => api<Dashboard>('/dashboard'),
    getHistory: (kind, id) => api<HistoryEntry[]>(`/${kind}/${id}/history`),

    // notifications
    listNotifications: (query = {}) => api<AppNotification[]>('/notifications', { query: { ...query } }),
    getUnreadNotificationCount: async () => (await api<{ count: number }>('/notifications/unread-count')).count,
    markNotificationRead: async (id) => {
      await post(`/notifications/${id}/read`);
    },
    markAllNotificationsRead: async () => {
      await post('/notifications/read-all');
    },

    // data portability
    exportData: () => api<unknown>('/users/me/export'),
  };
}
