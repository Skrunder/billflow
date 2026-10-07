import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { describeOffset } from '../../lib/format';

export const REMINDER_PRESETS = [
  { minutes: 0, label: 'At time' },
  { minutes: 15, label: '15 min' },
  { minutes: 60, label: '1 hour' },
  { minutes: 1440, label: '1 day' },
  { minutes: 4320, label: '3 days' },
  { minutes: 10080, label: '7 days' },
];

const MAX = 30 * 1440;

/** Preset reminder toggles + a custom reminder schedule (any minutes/hours/days before). */
export function ReminderEditor({ value, onChange, legend = 'Reminders' }: { value: number[]; onChange: (v: number[]) => void; legend?: string }) {
  const [amount, setAmount] = useState('2');
  const [unit, setUnit] = useState<'minutes' | 'hours' | 'days'>('hours');
  const sorted = [...value].sort((a, b) => b - a);
  const toggle = (m: number) => onChange(value.includes(m) ? value.filter((x) => x !== m) : [...value, m]);

  const addCustom = () => {
    const n = Math.round(Number(amount));
    if (!Number.isFinite(n) || n < 0) return;
    const minutes = unit === 'days' ? n * 1440 : unit === 'hours' ? n * 60 : n;
    if (minutes > MAX || value.includes(minutes) || value.length >= 10) return;
    onChange([...value, minutes]);
  };

  return (
    <fieldset>
      <legend className="label">{legend}</legend>
      <div className="flex flex-wrap gap-1.5">
        {REMINDER_PRESETS.map((p) => {
          const on = value.includes(p.minutes);
          return (
            <button type="button" key={p.minutes} aria-pressed={on} className={on ? 'chip-on' : 'chip-off'} onClick={() => toggle(p.minutes)}>
              {p.label}
            </button>
          );
        })}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          type="number"
          min={0}
          aria-label="Custom reminder amount"
          className="input w-20"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <select aria-label="Custom reminder unit" className="input w-28" value={unit} onChange={(e) => setUnit(e.target.value as typeof unit)}>
          <option value="minutes">minutes</option>
          <option value="hours">hours</option>
          <option value="days">days</option>
        </select>
        <span className="text-sm text-slate-500">before</span>
        <button type="button" className="btn-secondary btn-sm" onClick={addCustom}>
          <Plus className="h-3.5 w-3.5" aria-hidden /> Add
        </button>
      </div>

      {sorted.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {sorted.map((m) => (
            <li key={m} className="chip border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
              {describeOffset(m)}
              <button type="button" aria-label={`Remove reminder ${describeOffset(m)}`} onClick={() => toggle(m)}>
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint">No reminders.</p>
      )}
    </fieldset>
  );
}
