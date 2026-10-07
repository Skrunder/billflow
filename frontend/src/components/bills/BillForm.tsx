import { useState, type FormEvent } from 'react';
import type { BillInput } from '../../api/hooks';
import type { Bill, PaymentMethod } from '../../api/types';
import { useSettings } from '../../hooks/useSettings';
import { PAYMENT_METHOD_LABEL, todayIn } from '../../lib/format';
import { CategorySelect } from '../shared/CategorySelect';
import { RecurrenceEditor, type RecurrenceValue } from '../shared/RecurrenceEditor';
import { ReminderEditor } from '../shared/ReminderEditor';
import { Field } from '../ui/misc';
import { Spinner } from '../ui/Spinner';

interface Props {
  initial?: Bill;
  defaultDate?: string | null;
  busy?: boolean;
  onSubmit: (input: BillInput) => void;
  onCancel: () => void;
}

export function BillForm({ initial, defaultDate, busy, onSubmit, onCancel }: Props) {
  const settings = useSettings();
  const [name, setName] = useState(initial?.name ?? '');
  const [amount, setAmount] = useState(initial?.amount ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [categoryId, setCategoryId] = useState<string | null>(initial?.categoryId ?? null);
  const [startDate, setStartDate] = useState(initial?.startDate ?? defaultDate ?? todayIn(settings.timezone));
  const [hasTime, setHasTime] = useState(Boolean(initial?.dueTime));
  const [dueTime, setDueTime] = useState(initial?.dueTime ?? '09:00');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(initial?.paymentMethod ?? 'MANUAL');
  const [payDaysBefore, setPayDaysBefore] = useState(String(initial?.scheduledPayDaysBefore ?? 3));
  const [recurrence, setRecurrence] = useState<RecurrenceValue>(
    initial?.recurrence
      ? {
          frequency: initial.recurrence.frequency,
          interval: initial.recurrence.interval,
          byWeekday: initial.recurrence.byWeekday,
          endDate: initial.recurrence.endDate,
          count: initial.recurrence.count,
        }
      : null,
  );
  const [reminders, setReminders] = useState<number[]>(initial?.reminderOffsets ?? settings.defaultBillReminders);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = 'Name is required';
    if (!/^\d{1,10}(\.\d{1,2})?$/.test(amount.trim())) errs.amount = 'Enter an amount like 120 or 120.50';
    if (!startDate) errs.startDate = 'Due date is required';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    onSubmit({
      name: name.trim(),
      amount: amount.trim(),
      description: description.trim() || null,
      notes: notes.trim() || null,
      categoryId,
      startDate,
      dueTime: hasTime ? dueTime : null,
      paymentMethod,
      scheduledPayDaysBefore: paymentMethod === 'SCHEDULED_AUTOPAY' ? Number(payDaysBefore) || 0 : null,
      recurrence,
      reminderOffsets: reminders,
    });
  };

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" error={errors.name} className="sm:col-span-2">
          {(id) => <input id={id} className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Electric Bill" maxLength={120} required autoFocus />}
        </Field>
        <Field label={`Amount (${settings.currency})`} error={errors.amount}>
          {(id) => (
            <input id={id} className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" required />
          )}
        </Field>
        <Field label="Category">
          {(id) => <CategorySelect id={id} type="BILL" value={categoryId} onChange={setCategoryId} />}
        </Field>
        <Field label={recurrence ? 'First due date' : 'Due date'} error={errors.startDate}>
          {(id) => <input id={id} type="date" className="input" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />}
        </Field>
        <Field label="Due time" hint={hasTime ? undefined : `All day (reminders use ${settings.allDayReminderTime})`}>
          {(id) => (
            <div className="flex items-center gap-2">
              <input type="checkbox" aria-label="Set a due time" checked={hasTime} onChange={(e) => setHasTime(e.target.checked)} />
              <input id={id} type="time" className="input" value={dueTime} disabled={!hasTime} onChange={(e) => setDueTime(e.target.value)} />
            </div>
          )}
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Payment method">
          {(id) => (
            <select id={id} className="input" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}>
              {(Object.keys(PAYMENT_METHOD_LABEL) as PaymentMethod[]).map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABEL[m]}
                </option>
              ))}
            </select>
          )}
        </Field>
        {paymentMethod === 'SCHEDULED_AUTOPAY' && (
          <Field label="Pays how many days before due?">
            {(id) => <input id={id} type="number" min={0} max={60} className="input" value={payDaysBefore} onChange={(e) => setPayDaysBefore(e.target.value)} />}
          </Field>
        )}
        {paymentMethod !== 'MANUAL' && (
          <p className="text-xs text-slate-500 sm:col-span-2">
            {settings.autoCompleteAutopay
              ? 'Each occurrence is automatically marked completed on its payment date.'
              : 'Auto-completion is turned off in Settings — you will mark payments yourself.'}
          </p>
        )}
      </div>

      <RecurrenceEditor value={recurrence} onChange={setRecurrence} startDate={startDate} />

      <ReminderEditor value={reminders} onChange={setReminders} />

      <Field label="Description">
        {(id) => <input id={id} className="input" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} placeholder="Account number, payee…" />}
      </Field>
      <Field label="Notes">
        {(id) => <textarea id={id} className="input min-h-[80px]" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={5000} />}
      </Field>

      {initial?.isRecurring && (
        <p className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          Changes apply to upcoming occurrences you haven&apos;t touched. Completed, skipped, past or individually edited
          occurrences are never changed.
        </p>
      )}

      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy && <Spinner className="h-4 w-4 text-white" />}
          {initial ? 'Save changes' : 'Create bill'}
        </button>
      </div>
    </form>
  );
}
