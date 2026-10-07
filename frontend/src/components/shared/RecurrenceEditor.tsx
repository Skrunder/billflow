import clsx from 'clsx';
import type { Frequency, Recurrence } from '../../api/types';
import { describeRecurrence, WEEKDAYS_SHORT } from '../../lib/format';
import { Field, Toggle } from '../ui/misc';

export type RecurrenceValue = Omit<Recurrence, 'rrule'> | null;

const UNITS: Record<Frequency, string> = { DAILY: 'day(s)', WEEKLY: 'week(s)', MONTHLY: 'month(s)', YEARLY: 'year(s)' };

type EndMode = 'never' | 'date' | 'count';

/**
 * Edits a recurrence rule: Daily / Weekly (with weekdays) / Monthly / Yearly,
 * any custom interval ("every 2 weeks"), and an optional end (date or count).
 */
export function RecurrenceEditor({
  value,
  onChange,
  startDate,
}: {
  value: RecurrenceValue;
  onChange: (v: RecurrenceValue) => void;
  startDate: string;
}) {
  const endMode: EndMode = value?.count ? 'count' : value?.endDate ? 'date' : 'never';
  const set = (patch: Partial<NonNullable<RecurrenceValue>>) => value && onChange({ ...value, ...patch });

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
      <Toggle
        label="Repeats"
        description={value ? describeRecurrence(value, startDate) : 'This happens once'}
        checked={Boolean(value)}
        onChange={(on) =>
          onChange(on ? { frequency: 'MONTHLY', interval: 1, byWeekday: [], endDate: null, count: null } : null)
        }
      />
      {value && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Frequency">
              {(id) => (
                <select
                  id={id}
                  className="input"
                  value={value.frequency}
                  onChange={(e) => set({ frequency: e.target.value as Frequency, byWeekday: [] })}
                >
                  <option value="DAILY">Daily</option>
                  <option value="WEEKLY">Weekly</option>
                  <option value="MONTHLY">Monthly</option>
                  <option value="YEARLY">Yearly</option>
                </select>
              )}
            </Field>
            <Field label={`Every … ${UNITS[value.frequency]}`} hint="Custom interval, e.g. 2 = every other">
              {(id) => (
                <input
                  id={id}
                  type="number"
                  min={1}
                  max={365}
                  className="input"
                  value={value.interval}
                  onChange={(e) => set({ interval: Math.max(1, Math.min(365, Number(e.target.value) || 1)) })}
                />
              )}
            </Field>
          </div>

          {value.frequency === 'WEEKLY' && (
            <fieldset>
              <legend className="label">On these days</legend>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAYS_SHORT.map((d, i) => {
                  const on = value.byWeekday.includes(i);
                  return (
                    <button
                      type="button"
                      key={d}
                      aria-pressed={on}
                      className={clsx(on ? 'chip-on' : 'chip-off', 'w-12 justify-center')}
                      onClick={() =>
                        set({ byWeekday: on ? value.byWeekday.filter((x) => x !== i) : [...value.byWeekday, i].sort() })
                      }
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
              <p className="hint">Leave empty to repeat on the start date&apos;s weekday.</p>
            </fieldset>
          )}

          <fieldset>
            <legend className="label">Ends</legend>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              {(['never', 'date', 'count'] as EndMode[]).map((m) => (
                <label key={m} className="inline-flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="recurrence-end"
                    checked={endMode === m}
                    onChange={() =>
                      set({
                        endDate: m === 'date' ? (value.endDate ?? startDate) : null,
                        count: m === 'count' ? (value.count ?? 12) : null,
                      })
                    }
                  />
                  {m === 'never' ? 'Never' : m === 'date' ? 'On date' : 'After'}
                </label>
              ))}
            </div>
            {endMode === 'date' && (
              <input
                type="date"
                aria-label="End date"
                className="input mt-2 max-w-xs"
                min={startDate}
                value={value.endDate ?? ''}
                onChange={(e) => set({ endDate: e.target.value || null })}
              />
            )}
            {endMode === 'count' && (
              <div className="mt-2 flex items-center gap-2 text-sm">
                <input
                  type="number"
                  aria-label="Number of occurrences"
                  className="input w-24"
                  min={1}
                  max={1000}
                  value={value.count ?? 1}
                  onChange={(e) => set({ count: Math.max(1, Math.min(1000, Number(e.target.value) || 1)) })}
                />
                occurrences
              </div>
            )}
          </fieldset>
        </>
      )}
    </div>
  );
}
