import clsx from 'clsx';
import { Check, Repeat, Zap } from 'lucide-react';
import { useBillOccurrenceAction } from '../../api/hooks';
import { billDisplayAmount, type BillOccurrence, formatClock, formatDate, formatMoney } from '@skr/core';
import { useCanEdit } from '../../hooks/useCanEdit';
import { useSettings } from '../../hooks/useSettings';
import { CategoryDot, EstimateTag, StatusBadge } from '../ui/misc';
import { useToast } from '../ui/Toast';

export function BillOccurrenceRow({
  occ,
  onOpen,
  showName = true,
}: {
  occ: BillOccurrence;
  /** `pay`: open on the payment form. */
  onOpen: (id: string, pay?: boolean) => void;
  showName?: boolean;
}) {
  const settings = useSettings();
  const canEdit = useCanEdit();
  const action = useBillOccurrenceAction();
  const toast = useToast();
  const actionable = occ.status === 'PENDING' || occ.status === 'OVERDUE';

  const shown = billDisplayAmount(occ);

  const markPaid = () => {
    // An estimate needs the actual amount, so that opens the payment form instead.
    if (occ.amountIsEstimate) return onOpen(occ.id, true);
    action.mutate(
      { id: occ.id, action: 'complete' },
      {
        onSuccess: () => toast.success(`${occ.name} (${formatDate(occ.dueDate, settings.locale, 'short')}) marked paid`),
        onError: (e) => toast.error((e as Error).message),
      },
    );
  };

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => onOpen(occ.id)}>
        <CategoryDot color={occ.category?.color} />
        <div className="min-w-0 flex-1">
          <p className={clsx('truncate text-sm font-medium', occ.status === 'SKIPPED' && 'line-through opacity-60')}>
            {showName ? occ.name : formatDate(occ.dueDate, settings.locale)}
            {occ.isRecurring && <Repeat className="ml-1.5 inline h-3 w-3 text-slate-400" aria-label="Recurring" />}
            {occ.paymentMethod !== 'MANUAL' && <Zap className="ml-1 inline h-3 w-3 text-amber-500" aria-label="Auto-pay" />}
          </p>
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">
            {showName && formatDate(occ.dueDate, settings.locale)}
            {occ.dueTime && ` · ${formatClock(occ.dueTime, settings.timeFormat)}`}
            {occ.category && ` · ${occ.category.name}`}
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold tabular-nums">
            {formatMoney(shown.amount, settings.currency, settings.locale)}
            {shown.estimated && <EstimateTag />}
          </p>
          <StatusBadge status={occ.status} />
        </div>
      </button>
      {actionable && (
        <button
          className="icon-btn text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-500/10"
          aria-label={`Mark ${occ.name} due ${occ.dueDate} as paid`}
          title="Mark paid"
          disabled={!canEdit || action.isPending}
          onClick={markPaid}
        >
          <Check className="h-5 w-5" />
        </button>
      )}
    </li>
  );
}
