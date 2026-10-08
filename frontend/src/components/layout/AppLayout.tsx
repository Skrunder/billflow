import clsx from 'clsx';
import {
  Bell,
  CalendarDays,
  CalendarHeart,
  LayoutDashboard,
  LogOut,
  Plus,
  Receipt,
  Settings as SettingsIcon,
  Tags,
  WifiOff,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useUnreadCount } from '../../api/hooks';
import { useRepository } from '../../data/RepositoryProvider';
import { useAuth } from '../../auth/AuthProvider';
import { useOnline, useSettings, useThemeSync } from '../../hooks/useSettings';
import { describeSync, SyncIndicator } from '../sync/SyncIndicator';
import { useSyncStatus } from '../../sync/context';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/bills', label: 'Bills', icon: Receipt },
  { to: '/events', label: 'Events', icon: CalendarHeart },
  { to: '/categories', label: 'Categories', icon: Tags },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
];

const MOBILE_NAV = NAV.filter((n) => n.to !== '/categories');

function QuickAdd() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  const go = (to: string) => {
    setOpen(false);
    navigate(to);
  };
  return (
    <div className="relative" ref={ref}>
      <button className="btn-primary px-3" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        <Plus className="h-4 w-4" aria-hidden />
        <span className="hidden sm:inline">New</span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-40 mt-2 w-44 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800">
          <button role="menuitem" className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-700" onClick={() => go('/bills/new')}>
            <Receipt className="h-4 w-4" aria-hidden /> New bill
          </button>
          <button role="menuitem" className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-700" onClick={() => go('/events/new')}>
            <CalendarHeart className="h-4 w-4" aria-hidden /> New event
          </button>
        </div>
      )}
    </div>
  );
}

export function AppLayout() {
  const { user, logout, status } = useAuth();
  const settings = useSettings();
  const online = useOnline();
  const standalone = useRepository().kind === 'local';
  const sync = useSyncStatus();
  // The on-device database never depends on the network.
  const offline = !standalone && (status === 'offline' || !online);
  const { data: unread } = useUnreadCount(!offline);
  useThemeSync(settings.theme);

  return (
    <div className="min-h-screen md:flex">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-sm focus:bg-white focus:px-3 focus:py-2">
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 md:flex">
        <Link to="/" className="flex items-center gap-2.5 px-5 py-5">
          <img src="/billflow.svg" alt="" className="h-8 w-8" />
          <span className="text-base font-semibold tracking-tight">BillFlow</span>
        </Link>
        <nav className="flex-1 space-y-1 px-3" aria-label="Main">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
                  isActive
                    ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
                )
              }
            >
              <Icon className="h-4 w-4" aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-200 p-3 dark:border-slate-800">
          <div className="truncate px-3 text-sm font-medium">{user?.displayName}</div>
          {standalone ? (
            <div className="px-3 text-xs text-slate-500">
              {sync && sync.phase !== 'disconnected' ? describeSync(sync).text : 'Data stored on this device'}
            </div>
          ) : (
            <>
              <div className="truncate px-3 text-xs text-slate-500">{user?.email}</div>
              <button className="btn-ghost mt-2 w-full justify-start" onClick={() => void logout()}>
                <LogOut className="h-4 w-4" aria-hidden /> Sign out
              </button>
            </>
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-slate-200 bg-white/85 px-4 pb-3 pt-[max(0.75rem,var(--inset-top))] backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/85 md:px-6">
          <Link to="/" className="flex items-center gap-2 md:hidden">
            <img src="/billflow.svg" alt="" className="h-7 w-7" />
            <span className="text-sm font-semibold">BillFlow</span>
          </Link>
          <div className="hidden md:block" />
          <div className="flex items-center gap-1.5">
            <SyncIndicator />
            <Link to="/notifications" className="icon-btn relative" aria-label={`Notifications${unread?.count ? `, ${unread.count} unread` : ''}`}>
              <Bell className="h-5 w-5" aria-hidden />
              {Boolean(unread?.count) && (
                <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
                  {unread!.count > 99 ? '99+' : unread!.count}
                </span>
              )}
            </Link>
            <QuickAdd />
          </div>
        </header>

        {offline && (
          <div role="status" className="flex items-center gap-2 bg-amber-100 px-4 py-2 text-sm text-amber-900 dark:bg-amber-500/15 dark:text-amber-200 md:px-6">
            <WifiOff className="h-4 w-4 shrink-0" aria-hidden />
            You&apos;re offline — showing saved data. Changes are disabled until you reconnect.
          </div>
        )}

        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-5 pb-28 md:px-6 md:pb-8">
          <Outlet />
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-slate-200 bg-white/95 pb-(--inset-bottom) backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/95 md:hidden"
      >
        {MOBILE_NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              clsx(
                'flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium',
                isActive ? 'text-brand-600 dark:text-brand-400' : 'text-slate-500 dark:text-slate-400',
              )
            }
          >
            <Icon className="h-5 w-5" aria-hidden />
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
