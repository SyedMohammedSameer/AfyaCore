import { useDeferredValue, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronRight, Search, UserPlus, Users, X } from 'lucide-react'
import { AppShell } from '../components/AppShell'
import { Avatar, Badge, Button, EmptyState, Input, SkeletonRows, cx, riseStyle } from '../components/ui'
import { liveEncounters, livePatientCount, patientAge, searchPatients } from '../db/repo'
import { formatDate } from '../lib/format'
import { useI18n } from '../i18n'
import type { Patient } from '../db/schema'

type Filter = 'all' | 'today' | 'drafts'

function PatientRow({ patient, meta, badge }: { patient: Patient; meta: string; badge?: string }) {
  return (
    <Link
      to={`/patient/${patient.id}`}
      className="press press-active surface-card group flex items-center gap-3 rounded-card p-3.5 hover:-translate-y-0.5 hover:shadow-float"
    >
      <Avatar familyName={patient.familyName} givenName={patient.givenName} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-bold text-ink">
          {patient.familyName} <span className="font-medium text-ink-2">{patient.givenName}</span>
        </span>
        {meta && <span className="block truncate text-sm text-ink-3">{meta}</span>}
      </span>
      {badge ? <Badge tone="watch">{badge}</Badge> : <ChevronRight size={18} className="shrink-0 text-ink-4 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-600" />}
    </Link>
  )
}

export function Roster() {
  const { t, lang } = useI18n()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  // Keeps typing responsive on a low-end device while the scan runs.
  const deferredQuery = useDeferredValue(query)

  const patients = useLiveQuery(() => searchPatients(deferredQuery, 200), [deferredQuery])
  const encounters = useLiveQuery(() => liveEncounters(), [])
  const total = useLiveQuery(() => livePatientCount(), [], 0)

  /** Per-patient annotations, computed once rather than per row. */
  const annotations = useMemo(() => {
    const map = new Map<string, { lastVisit?: number; hasDraft: boolean; seenToday: boolean }>()
    const dayStart = new Date().setHours(0, 0, 0, 0)
    for (const e of encounters ?? []) {
      const entry = map.get(e.patientId) ?? { hasDraft: false, seenToday: false }
      if (e.status === 'draft') entry.hasDraft = true
      else {
        if (entry.lastVisit === undefined || e.occurredAt > entry.lastVisit) entry.lastVisit = e.occurredAt
        if (e.occurredAt >= dayStart) entry.seenToday = true
      }
      map.set(e.patientId, entry)
    }
    return map
  }, [encounters])

  const visible = (patients ?? []).filter((p) => {
    const a = annotations.get(p.id)
    if (filter === 'drafts') return a?.hasDraft ?? false
    if (filter === 'today') return a?.seenToday ?? false
    return true
  })

  const counts = {
    all: patients?.length ?? 0,
    today: (patients ?? []).filter((p) => annotations.get(p.id)?.seenToday).length,
    drafts: (patients ?? []).filter((p) => annotations.get(p.id)?.hasDraft).length,
  }

  const FILTERS: { key: Filter; label: string }[] = [
    { key: 'all', label: t.patients },
    { key: 'today', label: t.today },
    { key: 'drafts', label: t.draftsPending },
  ]

  return (
    <AppShell title={t.patients} subtitle={`${total} ${t.patientCount}`} tabs>
      <div className="surface-card sticky top-[4.6rem] z-10 -mx-1 mb-4 rounded-2xl p-2 sm:top-[5.1rem]">
        <div className="relative">
          <Search size={20} className="absolute top-1/2 left-3.5 -translate-y-1/2 text-brand-600" />
          <Input
            type="search"
            inputMode="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.searchPlaceholder}
            className="pr-11 pl-11"
            aria-label={t.searchPlaceholder}
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              aria-label={t.cancel}
              className="absolute top-1/2 right-2 grid size-9 -translate-y-1/2 place-items-center rounded-full text-ink-4 active:bg-sunken"
            >
              <X size={18} />
            </button>
          )}
        </div>

        {/* Segmented filter. "Drafts" earns a place because an unfinished
            consultation is the only state that can lose information. */}
        <div className="mt-2 flex gap-1.5">
          {FILTERS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={cx(
                'press press-active rounded-xl px-3 py-2 text-sm font-bold ring-1',
                filter === key
                  ? 'bg-brand-gradient text-white shadow-lift ring-white/20'
                  : 'bg-white/55 text-ink-2 ring-white/75 hover:bg-white/80',
              )}
            >
              {label}
              <span className={cx('numeric ml-1.5', filter === key ? 'text-white/70' : 'text-ink-4')}>
                {counts[key]}
              </span>
            </button>
          ))}
        </div>
      </div>

      {patients === undefined ? (
        <SkeletonRows />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<Users size={30} />}
          title={query ? t.noResults : filter === 'all' ? t.noPatients : t.noResults}
          hint={query || filter !== 'all' ? undefined : t.noPatientsHint}
          action={
            <Link to="/patient/new" className="mt-2">
              <Button icon={<UserPlus size={20} />}>{t.newPatient}</Button>
            </Link>
          }
        />
      ) : (
        <ul className="flex flex-col gap-2 pb-28">
          {visible.map((p, i) => {
            const a = annotations.get(p.id)
            const age = patientAge(p)
            const meta = [
              age !== undefined ? `${age} ${t.years}` : null,
              p.sex === 'female' ? t.female : p.sex === 'male' ? t.male : null,
              a?.lastVisit ? `${t.lastSeen} ${formatDate(a.lastVisit, lang)}` : t.never,
            ]
              .filter(Boolean)
              .join(' · ')
            return (
              <li key={p.id} className="animate-rise" style={riseStyle(i)}>
                <PatientRow patient={p} meta={meta} badge={a?.hasDraft ? t.draft : undefined} />
              </li>
            )
          })}
        </ul>
      )}

      {patients !== undefined && visible.length > 0 && (
        <Link
          to="/patient/new"
          aria-label={t.newPatient}
          className="press press-active fixed right-4 bottom-24 z-20 flex items-center gap-2 rounded-2xl bg-brand-gradient px-5 py-4 font-semibold text-white shadow-float ring-1 ring-white/25 hover:-translate-y-0.5 lg:right-8 lg:bottom-8"
        >
          <UserPlus size={22} />
          {t.newPatient}
        </Link>
      )}
    </AppShell>
  )
}
