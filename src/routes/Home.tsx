import { Link, useNavigate } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowUpRight, CalendarPlus, ClipboardList, FileEdit, Sparkles, UserPlus } from 'lucide-react'
import { AppShell } from '../components/AppShell'
import { Avatar, Badge, Button, EmptyState, SectionTitle, SkeletonRows, riseStyle } from '../components/ui'
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

/**
 * One number and what it counts.
 *
 * Label above value: the eye lands on the digit, and it should already know
 * what the digit means rather than having to travel back up.
 */
function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="surface-card rounded-card px-3.5 py-3">
      <p className="text-[0.6875rem] font-semibold tracking-[0.06em] text-ink-3 uppercase">{label}</p>
      <p className="numeric mt-1.5 text-[1.75rem] leading-none font-semibold tracking-[-0.03em] text-ink">
        {value}
      </p>
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
      tabs
    >
      {/*
        The primary action leads, then the numbers, then the work.

        This was a brand-gradient panel whose top third carried no information
        at all: a heading that repeated the button beneath it, on a coloured
        slab. A clinician opening this screen wants one of two things, and both
        are now the first thing they can touch.
      */}
      <div className="flex flex-col gap-5 pb-4">
        <div className="flex flex-col gap-3">
          {/*
            Stacked on a phone, side by side from `sm` up.

            These were always two-up, and at every real phone width the primary
            label did not fit: a large button is 40px of padding plus an 18px
            icon plus its gap, which leaves about 105px for "New consultation"
            in a 175px half. So it wrapped to two lines, next to a
            vertically-centred icon and a neighbour that did not wrap, and the
            row read as broken. It survived review because the breakpoint that
            rescues it, `sm:flex-none`, starts at 640px — every desktop window
            and no phone.

            Full width is also the better phone target: these are the two things
            a clinician opens this screen to do.
          */}
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button
              size="lg"
              icon={<CalendarPlus size={18} />}
              onClick={() => navigate('/patients')}
              className="w-full sm:w-auto"
            >
              {t.newEncounter}
            </Button>
            <Button
              size="lg"
              variant="secondary"
              icon={<UserPlus size={18} />}
              onClick={() => navigate('/patient/new')}
              className="w-full sm:w-auto"
            >
              {t.newPatient}
            </Button>
          </div>
          <div className="grid grid-cols-3 gap-2.5">
            <Metric label={t.consultationsToday} value={data?.todayCount ?? 0} />
            <Metric label={t.thisMonth} value={data?.monthCount ?? 0} />
            <Metric label={t.patients} value={total} />
          </div>
        </div>

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
                      className="press press-active surface-card group relative overflow-hidden rounded-card p-4"
                      style={riseStyle(index)}
                    >
                      <div className="relative flex items-start gap-3">
                        <span className="grid size-10 shrink-0 place-items-center rounded-field bg-warn-50 text-warn-700 ring-1 ring-warn-200">
                          <FileEdit size={20} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[0.9375rem] font-semibold text-ink">
                            {draft.patient ? `${draft.patient.familyName} ${draft.patient.givenName}` : t.unknown}
                          </span>
                          <span className="mt-1 block truncate text-sm text-ink-3">{draft.chiefComplaint || draft.diagnosis || t.draft}</span>
                          <span className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-semibold text-warn-700">
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

            <section>
              <SectionTitle
                action={
                  <Link to="/patients" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:text-brand-800">
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
                <div className="surface-card overflow-hidden rounded-card p-1.5">
                  <ul className="divide-y divide-line/70">
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
                              <span className="block truncate font-extrabold text-ink">{patient.familyName} {patient.givenName}</span>
                              <span className="mt-0.5 block truncate text-sm text-ink-3">
                                {[age !== undefined ? `${age} ${t.years}` : null, lastVisit ? Date.now() - lastVisit < DAY ? t.today : `${t.lastSeen} ${formatDate(lastVisit, lang)}` : t.never].filter(Boolean).join(' · ')}
                              </span>
                            </span>
                            <ArrowUpRight size={18} className="shrink-0 text-ink-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-brand-600" />
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}
            </section>          </>
        )}
      </div>
    </AppShell>
  )
}
