import { Download, LogOut, Send, Smartphone, Tags, Upload } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { errorMessage } from '../api/client';
import { useChangePassword, useExportData, useMe, useServerConfig, useUpdateProfile, useUpdateSettings } from '../api/hooks';
import * as account from '../data/account';
import { useRepository } from '../data/RepositoryProvider';
import type { CalendarView, Settings, Theme } from '@skr/core';
import { useAuth } from '../auth/AuthProvider';
import { ReminderEditor } from '../components/shared/ReminderEditor';
import { Modal } from '../components/ui/Modal';
import { ErrorNotice, Field, PageHeader, Segmented, Toggle } from '../components/ui/misc';
import { LoadingBlock, Spinner } from '../components/ui/Spinner';
import { useToast } from '../components/ui/Toast';
import { useCanEdit } from '../hooks/useCanEdit';
import { PhonesSection } from '../components/sync/PhonesSection';
import { ServerSyncSection } from '../components/sync/ServerSyncSection';
import { useSyncClient } from '../sync/context';
import { applyTheme } from '../hooks/useSettings';
import { currentSubscription, pushSupported, subscribeToPush, unsubscribeFromPush } from '../lib/push';
import { getPhoneReminders, saveFile, type PhoneReminderStatus } from '../native/device';
import type { LocalRepository } from '../data/local/engine';
import { queryClient } from '../queryClient';

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="card p-4 sm:p-6">
      <h2 className="text-base font-semibold">{title}</h2>
      {description && <p className="mb-4 mt-0.5 text-sm text-slate-500 dark:text-slate-400">{description}</p>}
      <div className={description ? '' : 'mt-4'}>{children}</div>
    </section>
  );
}

const CURRENCIES = ['USD', 'CAD', 'EUR', 'GBP', 'AUD', 'NZD', 'JPY', 'CHF', 'SEK', 'NOK', 'DKK', 'INR', 'MXN', 'BRL', 'ZAR', 'SGD', 'HKD', 'PHP'];

export function SettingsPage() {
  const { data, isLoading } = useMe();
  const standalone = useRepository().kind === 'local';
  const { data: config } = useServerConfig(!standalone);
  const { expireSession } = useAuth();
  const update = useUpdateSettings();
  const toast = useToast();
  const canEdit = useCanEdit();
  const syncClient = useSyncClient();

  const timezones = useMemo(() => {
    try {
      return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf('timeZone');
    } catch {
      return [];
    }
  }, []);

  if (isLoading || !data) return <LoadingBlock />;
  const s = data.settings;

  const save = (patch: Partial<Settings>, message = 'Settings saved') => {
    if (patch.theme) applyTheme(patch.theme);
    update.mutate(patch, { onSuccess: () => toast.success(message), onError: (e) => toast.error(errorMessage(e)) });
  };

  const detectedTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const tzOptions = timezones.includes(s.timezone) ? timezones : [s.timezone, ...timezones];

  return (
    <>
      <PageHeader title="Settings" subtitle={update.isPending ? <span className="inline-flex items-center gap-1"><Spinner className="h-3 w-3" /> Saving…</span> : 'Changes save automatically.'} />
      {/* min-w-0: a fieldset otherwise grows to fit its widest content (e.g. a long phone name) */}
      <fieldset disabled={!canEdit} className="min-w-0 space-y-5">
        <ProfileSection displayName={data.user.displayName} email={standalone ? null : data.user.email} />

        <Section title="Region & time" description="All dates, reminders and calendar views use your timezone.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Timezone" hint={s.timezone !== detectedTz ? <button type="button" className="text-brand-600 hover:underline" onClick={() => save({ timezone: detectedTz })}>Use this device&apos;s timezone ({detectedTz})</button> : 'Matches this device'}>
              {(id) => (
                <select id={id} className="input" value={s.timezone} onChange={(e) => save({ timezone: e.target.value })}>
                  {tzOptions.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Currency">
              {(id) => (
                <select id={id} className="input" value={s.currency} onChange={(e) => save({ currency: e.target.value })}>
                  {(CURRENCIES.includes(s.currency) ? CURRENCIES : [s.currency, ...CURRENCIES]).map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Language / number format" hint="e.g. en-US, en-GB, fr-CA, de-DE">
              {(id) => (
                <input
                  id={id}
                  className="input"
                  defaultValue={s.locale}
                  onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== s.locale && save({ locale: e.target.value.trim() })}
                />
              )}
            </Field>
            <Field label="Week starts on">
              {(id) => (
                <select id={id} className="input" value={s.weekStartsOn} onChange={(e) => save({ weekStartsOn: Number(e.target.value) })}>
                  <option value={0}>Sunday</option>
                  <option value={1}>Monday</option>
                  <option value={6}>Saturday</option>
                </select>
              )}
            </Field>
            <div>
              <span className="label">Time format</span>
              <Segmented label="Time format" value={s.timeFormat} onChange={(v) => save({ timeFormat: v })} options={[{ value: '12h', label: '12-hour' }, { value: '24h', label: '24-hour' }]} />
            </div>
          </div>
        </Section>

        <Section title="Appearance">
          <div className="flex flex-wrap items-end gap-6">
            <div>
              <span className="label">Theme</span>
              <Segmented<Theme>
                label="Theme"
                value={s.theme}
                onChange={(v) => save({ theme: v })}
                options={[
                  { value: 'SYSTEM', label: 'System' },
                  { value: 'LIGHT', label: 'Light' },
                  { value: 'DARK', label: 'Dark' },
                ]}
              />
            </div>
            <Field label="Default calendar view">
              {(id) => (
                <select id={id} className="input" value={s.defaultCalendarView} onChange={(e) => save({ defaultCalendarView: e.target.value as CalendarView })}>
                  <option value="dayGridMonth">Month</option>
                  <option value="timeGridWeek">Week</option>
                  <option value="timeGridDay">Day</option>
                  <option value="listMonth">Agenda</option>
                </select>
              )}
            </Field>
            <Link to="/categories" className="btn-secondary">
              <Tags className="h-4 w-4" aria-hidden /> Manage categories
            </Link>
          </div>
        </Section>

        <Section title="Reminders" description="Defaults for new bills and events. Each bill or event can override them.">
          <div className="space-y-5">
            <ReminderEditor legend="Default bill reminders" value={s.defaultBillReminders} onChange={(v) => save({ defaultBillReminders: v })} />
            <ReminderEditor legend="Default event reminders" value={s.defaultEventReminders} onChange={(v) => save({ defaultEventReminders: v })} />
            <Field label="Reminder time for all-day items" hint="Used for bills/events without a specific time" className="max-w-xs">
              {(id) => <input id={id} type="time" className="input" value={s.allDayReminderTime} onChange={(e) => e.target.value && save({ allDayReminderTime: e.target.value })} />}
            </Field>
            <Toggle
              label="Auto-complete auto-pay bills"
              description="Mark auto-pay occurrences as completed automatically on their payment date."
              checked={s.autoCompleteAutopay}
              onChange={(v) => save({ autoCompleteAutopay: v })}
            />
          </div>
        </Section>

        {standalone ? (
          <Section title="Notifications" description="Reminders that are due appear under the bell icon.">
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              <Toggle label="In-app notifications" checked={s.inAppNotifications} onChange={(v) => save({ inAppNotifications: v })} />
              {getPhoneReminders() && <PhoneReminderSettings enabled={s.pushNotifications} onSave={save} />}
            </div>
          </Section>
        ) : (
          <NotificationSection settings={s} pushServer={Boolean(config?.pushEnabled)} emailServer={Boolean(config?.emailNotificationsEnabled)} onSave={save} />
        )}

        {standalone && syncClient && <ServerSyncSection />}
        {!standalone && <SecuritySection onReauth={expireSession} />}
        {!standalone && <PhonesSection />}

        <DataSection onDeleted={expireSession} canDeleteAccount={!standalone} />
        {standalone && <BackupSection />}
      </fieldset>
    </>
  );
}

function ProfileSection({ displayName, email }: { displayName: string; email: string | null }) {
  const update = useUpdateProfile();
  const toast = useToast();
  const [name, setName] = useState(displayName);
  return (
    <Section title="Profile">
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          update.mutate({ displayName: name.trim() }, { onSuccess: () => toast.success('Profile updated'), onError: (err) => toast.error(errorMessage(err)) });
        }}
      >
        <Field label="Display name">
          {(id) => (
            <div className="flex gap-2">
              <input id={id} className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
              <button className="btn-secondary" disabled={update.isPending || name.trim() === displayName}>
                Save
              </button>
            </div>
          )}
        </Field>
        {email !== null && <Field label="Email">{(id) => <input id={id} className="input" value={email} disabled />}</Field>}
      </form>
    </Section>
  );
}

function NotificationSection({ settings: s, pushServer, emailServer, onSave }: { settings: Settings; pushServer: boolean; emailServer: boolean; onSave: (p: Partial<Settings>, m?: string) => void }) {
  const toast = useToast();
  const [deviceSubscribed, setDeviceSubscribed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void currentSubscription().then((sub) => setDeviceSubscribed(Boolean(sub)));
  }, []);

  const togglePushDevice = async () => {
    setBusy(true);
    try {
      if (deviceSubscribed) {
        await unsubscribeFromPush();
        setDeviceSubscribed(false);
        toast.success('Push disabled on this device');
      } else {
        await subscribeToPush();
        setDeviceSubscribed(true);
        if (!s.pushNotifications) onSave({ pushNotifications: true }, 'Push enabled on this device');
        else toast.success('Push enabled on this device');
      }
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async () => {
    try {
      const res = await account.sendTestNotification();
      toast.info(Object.entries(res).map(([k, v]) => `${k}: ${v}`).join('\n') || 'No channels enabled');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Section title="Notifications" description="Where reminders are delivered.">
      <div className="divide-y divide-slate-100 dark:divide-slate-800">
        <Toggle label="In-app notifications" description="Shown under the bell icon." checked={s.inAppNotifications} onChange={(v) => onSave({ inAppNotifications: v })} />
        <Toggle
          label="Email notifications"
          description={emailServer ? 'Sent to your account email.' : 'Unavailable: the server administrator has not configured SMTP.'}
          checked={s.emailNotifications}
          disabled={!emailServer}
          onChange={(v) => onSave({ emailNotifications: v })}
        />
        <Toggle
          label="Push notifications"
          description={pushServer ? 'Delivered to every device where push is enabled below.' : 'Unavailable: the server administrator has not configured VAPID keys.'}
          checked={s.pushNotifications}
          disabled={!pushServer}
          onChange={(v) => onSave({ pushNotifications: v })}
        />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {pushServer && pushSupported() && (
          <button type="button" className="btn-secondary" onClick={togglePushDevice} disabled={busy || deviceSubscribed === null}>
            <Smartphone className="h-4 w-4" aria-hidden /> {deviceSubscribed ? 'Disable push on this device' : 'Enable push on this device'}
          </button>
        )}
        <button type="button" className="btn-secondary" onClick={sendTest}>
          <Send className="h-4 w-4" aria-hidden /> Send test notification
        </button>
      </div>
      {pushServer && !pushSupported() && (
        <p className="hint mt-2">This browser can&apos;t receive push notifications. On iPhone/iPad, add the app to your Home Screen (Share → Add to Home Screen) and open it from there.</p>
      )}
    </Section>
  );
}

/** Android app: reminders as system notifications (stored in the pushNotifications setting). */
function PhoneReminderSettings({ enabled, onSave }: { enabled: boolean; onSave: (p: Partial<Settings>, m?: string) => void }) {
  const phone = getPhoneReminders()!;
  const toast = useToast();
  const [status, setStatus] = useState<PhoneReminderStatus | null>(null);
  const refresh = () => void phone.status().then(setStatus, () => setStatus(null));

  useEffect(() => {
    refresh();
    // Permissions can change in Android's settings while the app is in the background.
    addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);

  const toggle = async (on: boolean) => {
    if (!on) return onSave({ pushNotifications: false }, 'Phone notifications off');
    if (await phone.requestPermission()) onSave({ pushNotifications: true }, 'Phone notifications on');
    else toast.error('Notifications are blocked. Allow them for BillFlow in Android settings.');
    refresh();
  };

  const blocked = status?.permission === 'denied';
  return (
    <div className="py-2">
      <Toggle
        label="Phone notifications"
        description={
          blocked
            ? 'Blocked in Android settings (Apps → BillFlow → Notifications).'
            : 'Reminders pop up on this phone at their reminder time, even when the app is closed.'
        }
        checked={enabled && status?.permission === 'granted'}
        onChange={(v) => void toggle(v)}
      />
      {enabled && status?.permission === 'granted' && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {!status.exact && (
            <button type="button" className="btn-secondary" onClick={() => void phone.openExactAlarmSettings().finally(refresh)}>
              Allow exact timing
            </button>
          )}
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void phone.sendTest().then(() => toast.success('Test notification on its way'), (e) => toast.error(errorMessage(e)))}
          >
            <Send className="h-4 w-4" aria-hidden /> Send test notification
          </button>
          {!status.exact && <p className="hint w-full">Without exact timing Android may deliver reminders a few minutes late.</p>}
        </div>
      )}
    </div>
  );
}

function SecuritySection({ onReauth }: { onReauth: () => void }) {
  const change = useChangePassword();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<Error | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (next !== confirm) return setError(new Error('New passwords do not match'));
    setError(null);
    change.mutate(
      { currentPassword: current, newPassword: next },
      {
        onSuccess: () => {
          toast.success('Password changed — please sign in again');
          onReauth();
        },
        onError: (err) => setError(new Error(errorMessage(err))),
      },
    );
  };

  const logoutAll = async () => {
    try {
      await account.logoutEverywhere();
      toast.success('Signed out of all devices');
      onReauth();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Section title="Security">
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-3">
        <div className="sm:col-span-3">
          <ErrorNotice error={error} />
        </div>
        <Field label="Current password">
          {(id) => <input id={id} type="password" autoComplete="current-password" className="input" value={current} onChange={(e) => setCurrent(e.target.value)} required />}
        </Field>
        <Field label="New password" hint="At least 8 characters">
          {(id) => <input id={id} type="password" autoComplete="new-password" minLength={8} className="input" value={next} onChange={(e) => setNext(e.target.value)} required />}
        </Field>
        <Field label="Confirm new password">
          {(id) => <input id={id} type="password" autoComplete="new-password" className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />}
        </Field>
        <div className="flex flex-wrap gap-2 sm:col-span-3">
          <button className="btn-primary" disabled={change.isPending}>
            {change.isPending && <Spinner className="h-4 w-4 text-white" />} Change password
          </button>
          <button type="button" className="btn-secondary" onClick={logoutAll}>
            <LogOut className="h-4 w-4" aria-hidden /> Sign out everywhere
          </button>
        </div>
      </form>
    </Section>
  );
}

/** Standalone app: everything lives on this device, so offer a full backup file. */
function BackupSection() {
  const repo = useRepository() as LocalRepository;
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ name: string; data: unknown; createdAt: string | null } | null>(null);
  const [busy, setBusy] = useState(false);

  const backup = async () => {
    try {
      const data = await repo.createBackup();
      const stamp = data.createdAt.slice(0, 16).replace(/[T:]/g, '-');
      await saveFile(`billflow-backup-${stamp}.json`, JSON.stringify(data), 'application/json');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const pick = async (file: File | undefined) => {
    if (fileInput.current) fileInput.current.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text()) as { createdAt?: unknown };
      setPending({ name: file.name, data, createdAt: typeof data?.createdAt === 'string' ? data.createdAt : null });
    } catch {
      toast.error('This file is not a BillFlow backup.');
    }
  };

  const restore = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      await repo.restoreBackup(pending.data);
      setPending(null);
      await queryClient.invalidateQueries();
      toast.success('Backup restored');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Backup" description="Your bills and events are stored only on this device. Keep a backup somewhere safe, such as Google Drive.">
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary" onClick={backup}>
          <Download className="h-4 w-4" aria-hidden /> Back up to file
        </button>
        <button type="button" className="btn-secondary" onClick={() => fileInput.current?.click()}>
          <Upload className="h-4 w-4" aria-hidden /> Restore from backup
        </button>
        <input ref={fileInput} type="file" accept="application/json,.json" className="hidden" aria-label="Backup file" onChange={(e) => void pick(e.target.files?.[0])} />
      </div>
      <Modal open={pending !== null} onClose={() => !busy && setPending(null)} title="Restore this backup?" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Everything currently in the app is replaced by <strong className="break-all">{pending?.name}</strong>
            {pending?.createdAt && <> (made {new Date(pending.createdAt).toLocaleString()})</>}. This cannot be undone.
          </p>
          <div className="dialog-actions">
            <button type="button" className="btn-secondary" onClick={() => setPending(null)} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn-danger" onClick={() => void restore()} disabled={busy}>
              {busy && <Spinner className="h-4 w-4 text-white" />} Replace everything
            </button>
          </div>
        </div>
      </Modal>
    </Section>
  );
}

function DataSection({ onDeleted, canDeleteAccount }: { onDeleted: () => void; canDeleteAccount: boolean }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const exporter = useExportData();
  const exportData = async () => {
    try {
      const data = await exporter.mutateAsync();
      await saveFile(`billflow-export-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2), 'application/json');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const deleteAccount = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await account.deleteAccount(password);
      onDeleted();
    } catch (err) {
      setError(new Error(errorMessage(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Your data">
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary" onClick={exportData}>
          <Download className="h-4 w-4" aria-hidden /> Export all data (JSON)
        </button>
        {canDeleteAccount && (
          <button type="button" className="btn-secondary text-red-600 dark:text-red-400" onClick={() => setOpen(true)}>
            Delete account
          </button>
        )}
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="Delete your account?" size="sm">
        <form onSubmit={deleteAccount} className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            This permanently deletes your account and every bill, event, occurrence, category and notification. This cannot be undone. Consider exporting your data first.
          </p>
          <ErrorNotice error={error} />
          <Field label="Confirm with your password">
            {(id) => <input id={id} type="password" autoComplete="current-password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} required />}
          </Field>
          <div className="dialog-actions">
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="btn-danger" disabled={busy}>
              {busy && <Spinner className="h-4 w-4 text-white" />} Delete forever
            </button>
          </div>
        </form>
      </Modal>
    </Section>
  );
}
