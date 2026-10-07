import type { CategoryType } from './types.js';

/** Categories every new account starts with (fully editable by the user). */
export const DEFAULT_CATEGORIES: { type: CategoryType; name: string; color: string }[] = [
  { type: 'BILL', name: 'Housing', color: '#6366f1' },
  { type: 'BILL', name: 'Utilities', color: '#0ea5e9' },
  { type: 'BILL', name: 'Subscriptions', color: '#a855f7' },
  { type: 'BILL', name: 'Insurance', color: '#14b8a6' },
  { type: 'BILL', name: 'Transportation', color: '#f97316' },
  { type: 'BILL', name: 'Medical', color: '#ef4444' },
  { type: 'BILL', name: 'Credit Cards', color: '#ec4899' },
  { type: 'BILL', name: 'Loans', color: '#eab308' },
  { type: 'BILL', name: 'Taxes', color: '#64748b' },
  { type: 'BILL', name: 'Personal', color: '#22c55e' },
  { type: 'BILL', name: 'Other', color: '#78716c' },

  { type: 'EVENT', name: 'Payday Reminder', color: '#16a34a' },
  { type: 'EVENT', name: 'Birthday', color: '#db2777' },
  { type: 'EVENT', name: 'Anniversary', color: '#e11d48' },
  { type: 'EVENT', name: 'Appointment', color: '#2563eb' },
  { type: 'EVENT', name: 'Vacation', color: '#06b6d4' },
  { type: 'EVENT', name: 'Meeting', color: '#7c3aed' },
  { type: 'EVENT', name: 'Work', color: '#475569' },
  { type: 'EVENT', name: 'Personal', color: '#22c55e' },
  { type: 'EVENT', name: 'Holiday', color: '#f59e0b' },
  { type: 'EVENT', name: 'Vehicle Registration Renewal', color: '#ea580c' },
  { type: 'EVENT', name: 'Custom', color: '#78716c' },
];
