import { useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { Activity, ArrowLeft, Cloud, CloudOff, Home, SlidersHorizontal, Users } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { pendingSyncCount } from '../db/db'
import { useI18n } from '../i18n'
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

/** A compact status chip. It makes the local-first promise visible at all times. */
export function SyncStatus({ onDark = false }: { onDark?: boolean }) {
  const { t } = useI18n()
  const online = useOnline()
  const pending = useLiveQuery(() => pendingSyncCount(), [], 0)
  const label = !online ? t.offline : pending > 0 ? `${pending} ${t.pendingSync}` : t.allSynced

  const tone = onDark
    ? 'bg-white/13 text-white/90 ring-white/20'
    : !online
      ? 'bg-slate-100/85 text-slate-600 ring-slate-200/80'
      : pending > 0
        ? 'bg-warn-50/90 text-warn-700 ring-warn-200/80'
        : 'bg-ok-50/90 text-ok-700 ring-ok-200/80'

  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-bold ring-1 backdrop-blur-md', tone)}>
      {online ? <Cloud size={13} /> : <CloudOff size={13} />}
      {label}
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
                  : 'text-slate-500 hover:bg-white/50 hover:text-slate-800',
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
      <div className="glass-panel flex h-full flex-col rounded-[2rem] p-3">
        <Link to="/" className="press flex items-center gap-3 rounded-2xl px-2.5 py-3 hover:bg-white/45">
          <BrandMark />
          <span>
            <span className="block text-lg font-extrabold tracking-[-0.05em] text-slate-900">AfyaCore</span>
            <span className="block text-[0.64rem] font-bold tracking-[0.13em] text-brand-700 uppercase">Clinical workspace</span>
          </span>
        </Link>

        <nav className="mt-8">
          <Navigation desktop />
        </nav>

        <div className="mt-auto rounded-2xl bg-brand-950 p-4 text-white shadow-lift">
          <span className="mb-3 inline-flex rounded-full bg-white/10 px-2.5 py-1 text-[0.65rem] font-bold tracking-[0.12em] text-white/75 uppercase">Local-first</span>
          <p className="text-sm leading-relaxed text-white/85">{t.dataNotice}</p>
          <div className="mt-4"><SyncStatus onDark /></div>
        </div>
      </div>
    </aside>
  )
}

function TabBar() {
  return (
    <nav className="glass-panel sticky bottom-0 z-30 mx-2 mb-2 rounded-[1.45rem] px-1.5 pb-safe lg:hidden">
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
      <div className="pointer-events-none fixed -top-24 left-[20%] -z-10 size-[26rem] rounded-full bg-brand-300/20 blur-3xl" />
      <div className="pointer-events-none fixed top-[32%] -right-36 -z-10 size-[24rem] rounded-full bg-sky-300/20 blur-3xl" />
      <DesktopRail />

      <div className="relative flex min-h-dvh flex-col lg:pl-[18rem]">
        <header
          className={cx(
            'pt-safe relative z-20',
            hero
              ? 'mx-2 overflow-hidden rounded-b-[2rem] bg-brand-gradient text-white shadow-float sm:mx-4 lg:mx-6 lg:rounded-b-[2.25rem]'
              : 'glass-panel sticky top-0 mx-2 rounded-b-[1.5rem] border-x-0 border-t-0 sm:mx-4 lg:mx-6',
          )}
        >
          {hero && <div className="grid-dots pointer-events-none absolute inset-0 opacity-35" />}
          <div className="relative mx-auto flex w-full max-w-5xl items-center gap-2 px-3 py-3 sm:px-5">
            {showBack ? (
              <button
                onClick={() => navigate(-1)}
                className={cx(
                  'tap-safe press press-active -ml-1 grid place-items-center rounded-2xl',
                  hero ? 'bg-white/10 text-white hover:bg-white/18' : 'bg-white/55 text-slate-700 hover:bg-white',
                )}
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
              <h1 className={cx('truncate text-xl leading-tight font-extrabold sm:text-2xl', hero ? 'text-white' : 'text-slate-900')}>
                {title}
              </h1>
              {subtitle && <p className={cx('mt-0.5 truncate text-sm font-medium', hero ? 'text-white/70' : 'text-slate-500')}>{subtitle}</p>}
            </div>

            {actions ?? <SyncStatus onDark={hero} />}
          </div>

          {heroContent && <div className="relative mx-auto w-full max-w-5xl px-3 pb-9 sm:px-5 sm:pb-11">{heroContent}</div>}
        </header>

        <main
          className={cx(
            'relative mx-auto flex w-full max-w-5xl flex-1 flex-col px-3 sm:px-5',
            hero ? '-mt-7 sm:-mt-9' : 'pt-5 sm:pt-6',
            tabs ? 'pb-6 lg:pb-8' : 'pb-0',
          )}
        >
          {children}
        </main>

        {tabs && <TabBar />}
      </div>
    </div>
  )
}
