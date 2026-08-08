import { Link, useNavigate } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowUpRight, CalendarPlus, ClipboardList, FileEdit, Sparkles, UserPlus, Users } from 'lucide-react'
import { AppShell } from '../components/AppShell'
import { Avatar, Badge, Button, Card, EmptyState, SectionTitle, SkeletonRows, riseStyle } from '../components/ui'
import { db } from '../db/db'
import { seedDemoData } from '../db/seed'
import { liveEncounters, livePatientCount, patientAge } from '../db/repo'
import { DATE_LOCALES, formatDate } from '../lib/format'
import { useI18n } from '../i18n'
import type { Encounter, Patient } from '../db/schema'

const DAY = 86_400_000

function startOfToday(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

interface Overview {
  todayCount: number
  monthCount: number
  drafts: (Encounter & { patient?: Patient })[]
  recent: { patient: Patient; lastVisit?: number }[]
}

function Metric({ label, value, bright = false }: { label: string; value: number; bright?: boolean }) {
  return (
    <div className={bright ? 'rounded-2xl bg-white/18 p-3.5 ring-1 ring-white/20 backdrop-blur-sm' : 'glass-subtle rounded-2xl p-3.5'}>
      <p className={bright ? 'text-xs font-bold tracking-wide text-white/65' : 'text-xs font-bold tracking-wide text-slate-500'}>{label}</p>
      <p className={bright ? 'numeric mt-1 text-3xl leading-none font-extrabold tracking-[-0.06em] text-white' : 'numeric mt-1 text-3xl leading-none font-extrabold tracking-[-0.06em] text-slate-900'}>{value}</p>
    </div>
  )
}

/** The clinical landing screen puts work-in-progress ahead of passive reporting. */
export function HomeScreen() {
  const { t, lang } = useI18n()
  const navigate = useNavigate()

  const data = useLiveQuery<Overview>(async () => {
    const since = startOfToday()
    const monthStart = new Date()
    monthStart.setDate(1)
    monthStart.setHours(0, 0, 0, 0)

    const encounters = await liveEncounters()
    const finals = encounters.filter((e) => e.status === 'final')
    const draftRows = encounters
      .filter((e) => e.status === 'draft')
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 3)
    const drafts = await Promise.all(draftRows.map(async (e) => ({ ...e, patient: await db.patients.get(e.patientId) })))

    const patients = await db.patients
      .orderBy('updatedAt')
      .reverse()
      .filter((p) => p.deletedAt === undefined)
      .limit(5)
      .toArray()
    const lastVisitBy = new Map<string, number>()
    for (const e of finals) {
      const previous = lastVisitBy.get(e.patientId)
      if (previous === undefined || e.occurredAt > previous) lastVisitBy.set(e.patientId, e.occurredAt)
    }

    return {
      todayCount: finals.filter((e) => e.occurredAt >= since).length,
      monthCount: finals.filter((e) => e.occurredAt >= monthStart.getTime()).length,
      drafts,
      recent: patients.map((patient) => ({ patient, lastVisit: lastVisitBy.get(patient.id) })),
    }
  }, [])

  const total = useLiveQuery(() => livePatientCount(), [], 0)
  const now = new Date()
  const dateLabel = now.toLocaleDateString(DATE_LOCALES[lang], {
    weekday: 'long', day: 'numeric', month: 'long',
  })

  return (
    <AppShell
      title={t.today}
      subtitle={dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1)}
      variant="hero"
      tabs
      heroContent={
        <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="relative overflow-hidden rounded-[1.55rem] bg-white/10 p-4 ring-1 ring-white/18 backdrop-blur-sm">
            <div className="pointer-events-none absolute -top-10 -right-8 size-32 rounded-full bg-white/12 blur-2xl" />
            <div className="relative">
              <p className="flex items-center gap-2 text-[0.7rem] font-extrabold tracking-[0.14em] text-white/65 uppercase">
                <Sparkles size={14} /> {t.quickActions}
              </p>
              <p className="mt-2 max-w-md text-lg font-bold tracking-[-0.035em] text-white">{t.newEncounter}</p>
              <p className="mt-1 max-w-md text-sm leading-relaxed text-white/68">{t.noActivityHint}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="onDark" icon={<CalendarPlus size={18} />} onClick={() => navigate('/patients')}>
                  {t.newEncounter}
                </Button>
                <Button variant="onDark" icon={<UserPlus size={18} />} onClick={() => navigate('/patient/new')}>
                  {t.newPatient}
                </Button>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2.5 self-end">
            <Metric label={t.consultationsToday} value={data?.todayCount ?? 0} bright />
            <Metric label={t.thisMonth} value={data?.monthCount ?? 0} bright />
            <Metric label={t.patients} value={total} bright />
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-5 pb-4">
        {data === undefined ? (
          <SkeletonRows count={4} />
        ) : (
          <>
            {data.drafts.length > 0 && (
              <section>
                <SectionTitle>{t.draftsPending}</SectionTitle>
                <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
                  {data.drafts.map((draft, index) => (
                    <Link
                      key={draft.id}
                      to={`/patient/${draft.patientId}/encounter/${draft.id}`}
                      className="press press-active glass-panel group relative overflow-hidden rounded-card p-4"
                      style={riseStyle(index)}
                    >
                      <div className="pointer-events-none absolute top-0 right-0 size-20 rounded-bl-[2.5rem] bg-warn-100/70" />
                      <div className="relative flex items-start gap-3">
                        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-warn-100 text-warn-700 ring-1 ring-warn-200">
                          <FileEdit size={20} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-base font-extrabold text-slate-900">
                            {draft.patient ? `${draft.patient.familyName} ${draft.patient.givenName}` : t.unknown}
                          </span>
                          <span className="mt-1 block truncate text-sm text-slate-500">{draft.chiefComplaint || draft.diagnosis || t.draft}</span>
                          <span className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-warn-700">
                            <Badge tone="watch">{t.resumeDraft}</Badge>
                            <ArrowUpRight size={14} className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                          </span>
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            <div className="grid gap-5 lg:grid-cols-[1.42fr_0.9fr]">
              <section>
                <SectionTitle
                  action={
                    <Link to="/patients" className="inline-flex items-center gap-1 text-xs font-extrabold text-brand-700">
                      {t.seeAll}<ArrowUpRight size={14} />
                    </Link>
                  }
                >
                  {t.recentPatients}
                </SectionTitle>
                {data.recent.length === 0 ? (
                  <EmptyState
                    icon={<ClipboardList size={30} />}
                    title={t.noActivityToday}
                    hint={t.noActivityHint}
                    action={
                      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                        <Button variant="secondary" icon={<Sparkles size={18} />} onClick={() => void seedDemoData()}>
                          {t.loadDemo}
                        </Button>
                        <Button icon={<UserPlus size={18} />} onClick={() => navigate('/patient/new')}>
                          {t.newPatient}
                        </Button>
                      </div>
                    }
                  />
                ) : (
                  <div className="glass-panel overflow-hidden rounded-card p-1.5">
                    <ul className="divide-y divide-slate-200/70">
                      {data.recent.map(({ patient, lastVisit }, index) => {
                        const age = patientAge(patient)
                        return (
                          <li key={patient.id} className="animate-rise" style={riseStyle(index)}>
                            <Link
                              to={`/patient/${patient.id}`}
                              className="press press-active group flex items-center gap-3 rounded-[1.15rem] px-3 py-3.5 hover:bg-white/68"
                            >
                              <Avatar familyName={patient.familyName} givenName={patient.givenName} />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate font-extrabold text-slate-900">{patient.familyName} {patient.givenName}</span>
                                <span className="mt-0.5 block truncate text-sm text-slate-500">
                                  {[age !== undefined ? `${age} ${t.years}` : null, lastVisit ? Date.now() - lastVisit < DAY ? t.today : `${t.lastSeen} ${formatDate(lastVisit, lang)}` : t.never].filter(Boolean).join(' · ')}
                                </span>
                              </span>
                              <ArrowUpRight size={18} className="shrink-0 text-slate-300 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-brand-600" />
                            </Link>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                )}
              </section>

              <section>
                <SectionTitle>{t.patients}</SectionTitle>
                {/* `flex` on the card and `flex-1` on the content, not `h-full`:
                    a percentage height against a parent that only has `min-h`
                    is indeterminate, so the column collapsed to its content and
                    the `mt-auto` below never pushed anything anywhere. */}
                <Card variant="plain" className="relative flex min-h-[14rem] flex-col overflow-hidden bg-slate-950 text-white">
                  <div className="grid-dots pointer-events-none absolute inset-0 opacity-25" />
                  <div className="pointer-events-none absolute -top-12 -right-12 size-40 rounded-full bg-brand-400/30 blur-2xl" />
                  <div className="relative flex flex-1 flex-col">
                    <span className="grid size-11 place-items-center rounded-2xl bg-white/10 text-brand-200 ring-1 ring-white/15"><Users size={21} /></span>
                    <p className="numeric mt-5 text-5xl leading-none font-extrabold tracking-[-0.07em]">{total}</p>
                    <p className="mt-1 text-sm font-semibold text-white/65">{t.patientCount}</p>
                    <Link to="/patients" className="press mt-auto inline-flex items-center gap-2 self-start rounded-xl bg-white/12 px-3 py-2 text-sm font-bold text-white ring-1 ring-white/16 hover:bg-white/18">
                      {t.seeAll}<ArrowUpRight size={16} />
                    </Link>
                  </div>
                </Card>
              </section>
            </div>
          </>
        )}
      </div>
    </AppShell>
  )
}
