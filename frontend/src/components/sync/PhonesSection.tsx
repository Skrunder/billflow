import { Smartphone } from 'lucide-react';
import { useEffect, useState } from 'react';
import { errorMessage } from '../../api/client';
import * as account from '../../data/account';
import { timeAgo } from '../../sync/context';
import { useToast } from '../ui/Toast';

/** Web app Settings: phones that sync with this account, with remote sign-out (e.g. a lost phone). */
export function PhonesSection() {
  const toast = useToast();
  const [phones, setPhones] = useState<account.SignedInPhone[] | null>(null);

  const load = () => void account.listPhones().then(setPhones, () => setPhones([]));
  useEffect(load, []);

  if (!phones?.length) return null;
  return (
    <section className="card p-4 sm:p-6">
      <h2 className="text-base font-semibold">Phones</h2>
      <p className="mb-4 mt-0.5 text-sm text-slate-500 dark:text-slate-400">Android phones syncing with this account.</p>
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {phones.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-3 py-2">
            <div className="flex min-w-0 items-center gap-3">
              <Smartphone className="h-5 w-5 shrink-0 text-slate-400" aria-hidden />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{p.name}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">Last synced {timeAgo(p.lastSyncAt ?? undefined)}</div>
              </div>
            </div>
            <button
              type="button"
              className="btn-secondary btn-sm shrink-0 whitespace-nowrap"
              onClick={() =>
                void account.signOutPhone(p.id).then(
                  () => {
                    toast.success(`${p.name} signed out`);
                    load();
                  },
                  (e) => toast.error(errorMessage(e)),
                )
              }
            >
              Sign out
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
