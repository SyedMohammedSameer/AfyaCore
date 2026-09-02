import { useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { Activity, ArrowLeft, Cloud, CloudOff, HardDrive, Home, SlidersHorizontal, Users } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { pendingSyncCount } from '../db/db'
import { getSyncSettings, isEnrolled } from '../lib/sync'
import { useI18n } from '../i18n'
import { LanguageMenu } from './LanguageMenu'
import { LockButton } from './LockButton'
import { cx } from './ui'

/** Track connectivity so the UI can be honest about what will and won't work. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}

/**
 * A compact status chip. It makes the local-first promise visible at all times.
 *
 * "N pending" is only the truth when a server exists to be pending *on*. With
 * no sync configured that counter can never fall, so it reads as a growing pile
 * of stuck work when the actual situation is that everything is safely on the
 * device and nothing is waiting for anything. So the unconfigured case says so.
 */
export function SyncStatus({ onDark = false }: { onDark?: boolean }) {
  const { t } = useI18n()
  const online = useOnline()
  const pending = useLiveQuery(() => pendingSyncCount(), [], 0)
  const configured = useLiveQuery(
    async () => {
      return isEnrolled(await getSyncSettings())
    },
    [],
    false,
  )

  const waiting = configured && pending > 0
  const label = !configured ? t.savedOnDevice : !online ? t.offline : waiting ? `${pending} ${t.pendingSync}` : t.allSynced

  const tone = onDark
    ? 'bg-white/13 text-white/90 ring-white/20'
    : !configured
      ? 'bg-sunken/85 text-ink-2 ring-line/80'
      : !online
        ? 'bg-sunken/85 text-ink-2 ring-line/80'
        : waiting
          ? 'bg-warn-50/90 text-warn-700 ring-warn-200/80'
          : 'bg-ok-50/90 text-ok-700 ring-ok-200/80'

  return (
    // Icon-only on a phone. Three chips plus a title do not fit 375px, and the
    // one that has to give is the status: its icon and colour already carry the
    // state, the wording is spelled out in Settings, and the thing it was
    // crushing was the patient's name. The label returns as soon as there is
    // room for it. Capped even then, so a long translation cannot take over.
    <span
      title={label}
      aria-label={label}
      className={cx('inline-flex max-w-[9.5rem] items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-bold ring-1 backdrop-blur-md', tone)}
    >
      {!configured ? <HardDrive size={13} className="shrink-0" /> : online ? <Cloud size={13} className="shrink-0" /> : <CloudOff size={13} className="shrink-0" />}
      <span className="hidden truncate sm:inline">{label}</span>
    </span>
  )
}

const TABS = [
  { to: '/', icon: Home, key: 'home' as const },
  { to: '/patients', icon: Users, key: 'patients' as const },
  { to: '/reports', icon: SlidersHorizontal, key: 'reports' as const },
]

function BrandMark({ small = false }: { small?: boolean }) {
  return (
    <span className={cx('relative grid place-items-center overflow-hidden bg-brand-gradient font-black text-white shadow-lift', small ? 'size-9 rounded-xl text-lg' : 'size-11 rounded-2xl text-xl')}>
      <span className="absolute -top-3 -right-3 size-7 rounded-full bg-white/25" />
      <Activity size={small ? 18 : 22} strokeWidth={2.8} className="relative" />
    </span>
  )
}

function Navigation({ desktop = false }: { desktop?: boolean }) {
  const { t } = useI18n()
  const { pathname } = useLocation()
  const labels = { home: t.today, patients: t.patients, reports: t.settings }

  return (
    <ul className={cx(desktop ? 'flex flex-col gap-1.5' : 'flex items-center justify-around')}>
      {TABS.map(({ to, icon: Icon, key }) => {
        const active = pathname === to
        return (
          <li key={to} className={desktop ? undefined : 'flex-1'}>
            <Link
              to={to}
              aria-current={active ? 'page' : undefined}
              className={cx(
                'press press-active flex items-center font-bold',
                desktop
                  ? 'gap-3 rounded-2xl px-3.5 py-3 text-sm'
                  : 'mx-auto flex-col gap-1 rounded-2xl py-2 text-[0.65rem] tracking-wide',
                active
                  ? desktop
                    ? 'bg-brand-gradient text-white shadow-lift ring-1 ring-white/20'
                    : 'text-brand-800'
                  : 'text-ink-3 hover:bg-white/50 hover:text-ink',
              )}
            >
              <span className={cx('grid place-items-center', desktop ? 'size-6' : 'h-7 w-12 rounded-full', active && !desktop && 'bg-brand-100')}>
                <Icon size={desktop ? 19 : 20} strokeWidth={active ? 2.5 : 2} />
              </span>
              <span>{labels[key]}</span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

function DesktopRail() {
  const { t } = useI18n()
  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-[17rem] p-4 lg:block">
      <div className="surface-card flex h-full flex-col rounded-[2rem] p-3">
        <Link to="/" className="press flex items-center gap-3 rounded-2xl px-2.5 py-3 hover:bg-white/45">
          <BrandMark />
          <span>
            <span className="block text-lg font-extrabold tracking-[-0.05em] text-ink">AfyaCore</span>
            <span className="block text-[0.64rem] font-bold tracking-[0.13em] text-brand-700 uppercase">Clinical workspace</span>
          </span>
        </Link>

        <nav className="mt-8">
          <Navigation desktop />
        </nav>

        <div className="mt-auto flex flex-col gap-3">
          <LanguageMenu expand />
          {/* A quiet note, not a black slab. It reassures; it is not the most
              important thing on the screen and should not look like it. */}
          <div className="surface-card rounded-card p-3.5">
            <span className="text-[0.625rem] font-semibold tracking-[0.09em] text-brand-700 uppercase">
              Local-first
            </span>
            <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-ink-3">{t.dataNotice}</p>
            <div className="mt-3">
              <SyncStatus />
            </div>
          </div>
        </div>
      </div>
    </aside>
  )
}

/**
 * Bottom navigation.
 *
 * `fixed`, not `sticky`. As the last child of the shell's flex column a sticky
 * bar has nothing after it to stick against, so it simply renders at the end of
 * the document and only appears once the page is scrolled to the bottom, which
 * is exactly where a tab bar is least useful. `main` reserves the height below.
 */
function TabBar() {
  return (
    <nav className="surface-card fixed inset-x-2 bottom-2 z-30 rounded-[1.45rem] px-1.5 pb-safe lg:hidden">
      <Navigation />
    </nav>
  )
}

interface AppShellProps {
  title: string
  subtitle?: string
  showBack?: boolean
  actions?: ReactNode
  variant?: 'plain' | 'hero'
  heroContent?: ReactNode
  tabs?: boolean
  children: ReactNode
}

export function AppShell({
  title,
  subtitle,
  showBack,
  actions,
  variant = 'plain',
  heroContent,
  tabs,
  children,
}: AppShellProps) {
  const navigate = useNavigate()
  const { t } = useI18n()
  const hero = variant === 'hero'

  return (
    <div className="relative min-h-dvh overflow-x-hidden">
      <DesktopRail />

      <div className="relative flex min-h-dvh flex-col lg:pl-[18rem]">
        {/*
          One header treatment, not two.

          The hero variant was a full-bleed brand gradient with white text. It
          looked like a landing page and, worse, it meant the top third of the
          launch screen carried no information at all. Now both variants are the
          same white surface on a hairline, and the hierarchy comes from type
          size rather than from a coloured slab.
        */}
        <header className="pt-safe sticky top-0 z-20 border-b border-line bg-surface">
          <div className="relative mx-auto flex w-full max-w-5xl items-center gap-2 px-3 py-3 sm:px-5">
            {showBack ? (
              <button
                onClick={() => navigate(-1)}
                className="tap-safe press press-active -ml-1 grid place-items-center rounded-field text-ink-2 hover:bg-sunken"
                aria-label={t.back}
              >
                <ArrowLeft size={22} />
              </button>
            ) : (
              !hero && (
                <Link to="/" className="-ml-1 lg:hidden" aria-label="AfyaCore">
                  <BrandMark small />
                </Link>
              )
            )}

            <div className="min-w-0 flex-1">
              <h1 className="truncate text-[1.375rem] leading-tight font-semibold tracking-[-0.022em] text-ink sm:text-2xl">
                {title}
              </h1>
              {subtitle && <p className="mt-0.5 truncate text-[0.8125rem] text-ink-3">{subtitle}</p>}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {actions ?? <SyncStatus />}
              {/* Top-level screens only. A sub-screen keeps its header for the
                  patient's name, and nobody switches language mid-consultation. */}
              {tabs && <LanguageMenu />}
              {/* Locking is reachable from every top-level screen on purpose:
                  handing the phone to a colleague is a constant, and a lock
                  buried in Settings is one nobody uses. */}
              {tabs && <LockButton />}
            </div>
          </div>

          {heroContent && <div className="relative mx-auto w-full max-w-5xl px-3 pb-6 sm:px-5 sm:pb-8">{heroContent}</div>}
        </header>

        <main
          className={cx(
            'relative mx-auto flex w-full max-w-5xl flex-1 flex-col px-3 sm:px-5',
            // The hero used to pull `main` up under itself so cards tucked into
            // its rounded bottom edge. That also swallowed whatever came first,
            // and what comes first is a section heading, not a card.
            hero ? 'pt-4 sm:pt-5' : 'pt-5 sm:pt-6',
            // Room for the fixed tab bar, which no longer occupies flow space.
            tabs ? 'pb-28 lg:pb-8' : 'pb-0',
          )}
        >
          {children}
        </main>

        {tabs && <TabBar />}
      </div>
    </div>
  )
}
