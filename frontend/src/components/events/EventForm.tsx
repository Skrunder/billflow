import { useState, type FormEvent } from 'react';
import type { EventInput } from '../../api/hooks';
import { type CalendarEvent, todayIn } from '@skr/core';
import { useSettings } from '../../hooks/useSettings';
import { CategorySelect } from '../shared/CategorySelect';
import { RecurrenceEditor, type RecurrenceValue } from '../shared/RecurrenceEditor';
import { ReminderEditor } from '../shared/ReminderEditor';
import { Field } from '../ui/misc';
import { Spinner } from '../ui/Spinner';

interface Props {
  initial?: CalendarEvent;
  defaultDate?: string | null;
  busy?: boolean;
  onSubmit: (input: EventInput) => void;
  onCancel: () => void;
}

export function EventForm({ initial, defaultDate, busy, onSubmit, onCancel }: Props) {
  const settings = useSettings();
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [location, setLocation] = useState(initial?.location ?? '');
  const [categoryId, setCategoryId] = useState<string | null>(initial?.categoryId ?? null);
  const [startDate, setStartDate] = useState(initial?.startDate ?? defaultDate ?? todayIn(settings.timezone));
  const [allDay, setAllDay] = useState(initial ? initial.allDay : true);
  const [startTime, setStartTime] = useState(initial?.startTime ?? '09:00');
  const [endTime, setEndTime] = useState(initial?.endTime ?? '');
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
  const [reminders, setReminders] = useState<number[]>(initial?.reminderOffsets ?? settings.defaultEventReminders);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!title.trim()) errs.title = 'Title is required';
    if (!startDate) errs.startDate = 'Date is required';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    onSubmit({
      title: title.trim(),
      description: description.trim() || null,
      notes: notes.trim() || null,
      location: location.trim() || null,
      categoryId,
      startDate,
      startTime: allDay ? null : startTime,
      endTime: allDay || !endTime ? null : endTime,
      recurrence,
      reminderOffsets: reminders,
    });
  };

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-800 dark:bg-sky-500/10 dark:text-sky-300">
        Events are reminders only — they never count toward bill totals or spending.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Title" error={errors.title} className="sm:col-span-2">
          {(id) => <input id={id} className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Payday" maxLength={120} autoFocus />}
        </Field>
        <Field label="Category">
          {(id) => <CategorySelect id={id} type="EVENT" value={categoryId} onChange={setCategoryId} />}
        </Field>
        <Field label={recurrence ? 'First date' : 'Date'} error={errors.startDate}>
          {(id) => <input id={id} type="date" className="input" value={startDate} onChange={(e) => setStartDate(e.target.value)} />}
        </Field>
        <div className="sm:col-span-2">
          <label className="inline-flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} /> All day
          </label>
        </div>
        {!allDay && (
          <>
            <Field label="Start time">
              {(id) => <input id={id} type="time" className="input" value={startTime} onChange={(e) => setStartTime(e.target.value)} />}
            </Field>
            <Field label="End time" hint="Optional">
              {(id) => <input id={id} type="time" className="input" value={endTime} onChange={(e) => setEndTime(e.target.value)} />}
            </Field>
          </>
        )}
        <Field label="Location" className="sm:col-span-2">
          {(id) => <input id={id} className="input" value={location} onChange={(e) => setLocation(e.target.value)} maxLength={200} />}
        </Field>
      </div>

      <RecurrenceEditor value={recurrence} onChange={setRecurrence} startDate={startDate} />
      <ReminderEditor value={reminders} onChange={setReminders} />

      <Field label="Description">
        {(id) => <input id={id} className="input" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} />}
      </Field>
      <Field label="Notes">
        {(id) => <textarea id={id} className="input min-h-[80px]" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={5000} />}
      </Field>

      {initial?.isRecurring && (
        <p className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          Changes apply to upcoming occurrences you haven&apos;t touched. Completed, cancelled, past or individually edited
          occurrences are never changed.
        </p>
      )}

      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy && <Spinner className="h-4 w-4 text-white" />}
          {initial ? 'Save changes' : 'Create event'}
        </button>
      </div>
    </form>
  );
}
