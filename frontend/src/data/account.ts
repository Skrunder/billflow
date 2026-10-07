import type { AuthResponse, ServerConfig } from '@skr/core';
import { api } from '../api/client';

/**
 * Account features that only exist when connected to a server: sign-in,
 * registration, password reset, email verification, "sign out everywhere",
 * account deletion and server-side test notifications.
 *
 * These are intentionally separate from DataRepository — a standalone
 * Android install has no account, so the UI hides these when the data source
 * is local. (Push subscriptions live in lib/push.ts for the same reason.)
 */

export const getServerConfig = () => api<ServerConfig>('/auth/config', { auth: false });

export const login = (email: string, password: string) =>
  api<AuthResponse>('/auth/login', { method: 'POST', body: { email, password }, auth: false });

export const register = (input: { email: string; password: string; displayName: string; timezone: string }) =>
  api<AuthResponse | { verificationRequired: true }>('/auth/register', { method: 'POST', body: input, auth: false });

export const requestPasswordReset = (email: string) =>
  api('/auth/forgot-password', { method: 'POST', body: { email }, auth: false });

export const resetPassword = (token: string, password: string) =>
  api('/auth/reset-password', { method: 'POST', body: { token, password }, auth: false });

export const verifyEmail = (token: string) => api('/auth/verify-email', { method: 'POST', body: { token }, auth: false });

export const changePassword = (currentPassword: string, newPassword: string) =>
  api<{ ok: boolean }>('/users/me/password', { method: 'POST', body: { currentPassword, newPassword } });

export const logoutEverywhere = () => api('/auth/logout-all', { method: 'POST' });

export const deleteAccount = (password: string) => api('/users/me', { method: 'DELETE', body: { password } });

/** Sends a test reminder on every channel enabled for the account. */
export const sendTestNotification = () => api<Record<string, string>>('/notifications/test', { method: 'POST' });
