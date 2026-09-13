import { Link, useNavigate } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowUpRight, CalendarPlus, ClipboardList, FileEdit, FlaskConical, Sparkles, TrendingUp, UserPlus } from 'lucide-react'
import { BarStrip } from '../components/charts'
import { dailyCounts, indicatorSignals } from '../lib/surveillance'
import { indicatorLabel } from '../lib/dhis2'
import { AppShell } from '../components/AppShell'
import { Avatar, Badge, Button, Card, EmptyState, SectionTitle, SkeletonRows, cx, riseStyle } from '../components/ui'
import { db } from '../db/db'
import { seedDemoData } from '../db/seed'
import { liveEncounters, livePatientCount, searchPatients } from '../db/repo'
import { DATE_LOCALES, formatDate, formatAge } from '../lib/format'
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
  /** Confirmed consultations per day, last fortnight, oldest first. */
  fortnight: ReturnType<typeof dailyCounts>
  /** This week against the four before it, per reporting indicator. */
  signals: ReturnType<typeof indicatorSignals>
}

/**
 * What the facility has seen lately, from the records already on the phone.
 *
 * Two weeks of daily bars, then each reporting indicator with this week's
 * count against the previous four. A marked row is a week that stands out
 * against its own recent past by the plainest rule in routine surveillance;
 * the wording underneath says, in as many words, that it is a prompt to look
 * and not an alert. See src/lib/surveillance.ts for the rule and its limits.
 */
function FacilityOverview({ data }: { data: Overview }) {
  const { t, lang } = useI18n()
  const total = data.fortnight.reduce((n, d) => n + d.count, 0)
  if (total === 0) return null
  const rows = data.signals.filter((s) => s.thisWeek > 0 || s.baseline.some((n) => n > 0))
  const excess = rows.filter((s) => s.excess)

  return (
    <section>
      <SectionTitle>{t.facilityOverview}</SectionTitle>
      <Card className="flex flex-col gap-4">
        <div>
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <span className="text-[0.6875rem] font-semibold tracking-[0.06em] text-ink-3 uppercase">{t.last14Days}</span>
            <span className="numeric text-sm font-semibold text-ink">
              {total} <span className="font-normal text-ink-3">{t.encounters.toLowerCase()}</span>
            </span>
          </div>
          <BarStrip
            values={data.fortnight.map((d) => d.count)}
            className="text-brand-600"
            label={`${t.last14Days}: ${data.fortnight.map((d) => d.count).join(', ')}`}
          />
        </div>

        {rows.length > 0 && (
          <ul className="flex flex-col divide-y divide-line/70">
            {rows.map((s) => {
              const scale = Math.max(1, s.thisWeek, ...s.baseline)
              return (
                <li key={s.indicator} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">{indicatorLabel(s.indicator, lang)}</span>
                    {s.excess && (
                      <span className="mt-0.5 inline-flex items-center gap-1 text-xs font-semibold text-warn-700">
                        <TrendingUp size={13} />
                        {t.aboveBaseline}
                      </span>
                    )}
                  </span>
                  {/* Four baseline weeks then this week, oldest first, so the
                      eye reads left to right into the present. */}
                  <span className="flex h-7 items-end gap-0.5" aria-hidden>
                    {[...s.baseline].reverse().map((n, i) => (
                      <span
                        key={i}
                        className="w-1.5 rounded-sm bg-ink-4/40"
                        style={{ height: `${Math.max(8, (n / scale) * 100)}%` }}
                      />
                    ))}
                    <span
                      className={cx('w-2 rounded-sm', s.excess ? 'bg-warn-500' : 'bg-brand-600')}
                      style={{ height: `${Math.max(8, (s.thisWeek / scale) * 100)}%` }}
                    />
                  </span>
                  <span
                    className={cx(
                      'numeric w-9 text-right text-lg leading-none font-semibold',
                      s.excess ? 'text-warn-700' : 'text-ink',
                    )}
                  >
                    {s.thisWeek}
                  </span>
                </li>
              )
            })}
          </ul>
        )}

        <p className="text-xs leading-relaxed text-ink-4">{excess.length === 0 ? t.noSignal : t.baselineHint}</p>
      </Card>
    </section>
  )
}

/**
 * One number and what it counts.
 *
 * Label above value: the eye lands on the digit, and it should already know
 * what the digit means rather than having to travel back up.
 */
function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="px-4 py-4 sm:px-6">
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

    // `searchPatients` with an empty query, rather than a Dexie `.filter()`
    // chain: a predicate on a collection makes Dexie read through a cursor,
    // and an encrypted table cannot be. It also pages by index instead of
    // decrypting the whole register to show five names.
    const patients = await searchPatients('', 5)
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
      fortnight: dailyCounts(encounters),
      signals: indicatorSignals(encounters),
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
      <div className="flex flex-col gap-6 pb-4">
        <section className="workspace-hero">
          <div className="p-5 sm:p-7">
            <p className="studio-section-label">{t.studio.workspace}</p>
            <h2 className="mt-3 max-w-xl text-2xl font-medium tracking-[-0.035em] sm:text-[2rem]">{t.studio.homeTitle}</h2>
            <p className="mt-2 text-sm text-ink-3">{t.studio.homeHint}</p>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
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
          </div>
          <div className="workspace-metrics">
            <Metric label={t.consultationsToday} value={data?.todayCount ?? 0} />
            <Metric label={t.thisMonth} value={data?.monthCount ?? 0} />
            <Metric label={t.patients} value={total} />
          </div>
        </section>

        {data === undefined ? (
          <SkeletonRows count={4} />
        ) : (
          <div className="workspace-columns">
            <div className="flex min-w-0 flex-col gap-6">
            {data.drafts.length > 0 && (
              <section>
                <SectionTitle>{t.draftsPending}</SectionTitle>
                <div className="grid gap-2.5">
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
                      const age = formatAge(patient, t)
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
                                {[age, lastVisit ? Date.now() - lastVisit < DAY ? t.today : `${t.lastSeen} ${formatDate(lastVisit, lang)}` : t.never].filter(Boolean).join(' · ')}
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
            </section>
            </div>
            <div className="flex min-w-0 flex-col gap-6">
              <FacilityOverview data={data} />
              <Link to="/studio" className="group flex items-center gap-4 rounded-card border border-brand-200 bg-brand-50 p-5">
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-surface text-brand-700"><FlaskConical size={22} /></span>
                <div className="min-w-0 flex-1"><p className="text-sm font-semibold text-brand-800">{t.studio.title}</p><p className="mt-1 text-xs leading-relaxed text-brand-700">{t.studio.homeLink}</p></div>
                <ArrowUpRight size={18} className="text-brand-600" />
              </Link>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  )
}
