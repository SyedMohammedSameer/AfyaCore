import { Link, useNavigate, useParams } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import { CalendarPlus, ClipboardList, FileText, Languages, MapPin, Merge, Pencil, Phone, Trash2 } from 'lucide-react'
import { AppShell } from '../components/AppShell'
import { ActionBar, Avatar, Badge, Button, Card, EmptyState, MoreMenu, SectionTitle, SkeletonRows, cx, riseStyle } from '../components/ui'
import { db } from '../db/db'
import { createDraftEncounter, deletePatient, patientAge, patientEncounters } from '../db/repo'
import { formatDate, formatVital, hasAnyVital, VITAL_ORDER } from '../lib/format'
import { vitalSeverity } from '../db/schema'
import { LANG_LABELS, useI18n } from '../i18n'
import type { Encounter } from '../db/schema'

/**
 * One visit on the patient's timeline.
 *
 * Rendered as a timeline rather than a stack of cards because the clinical
 * question is almost always "what changed since last time", and a vertical rail
 * with dated nodes answers that at a glance in a way a card list does not.
 */
function TimelineEntry({
  encounter,
  patientId,
  isLast,
  index,
}: {
  encounter: Encounter
  patientId: string
  isLast: boolean
  index: number
}) {
  const { t, lang } = useI18n()
  const vitals = encounter.vitals
  const draft = encounter.status === 'draft'

  // The most severe vital in the visit decides the node colour, so a bad day is
  // visible while scrolling without reading a single number.
  const worst = VITAL_ORDER.reduce<'normal' | 'watch' | 'urgent'>((acc, k) => {
    const v = vitals[k]
    if (v === undefined) return acc
    const s = vitalSeverity(k, v)
    if (s === 'urgent' || acc === 'urgent') return 'urgent'
    return s === 'watch' ? 'watch' : acc
  }, 'normal')

  const dot =
    draft ? 'bg-warn-500' : worst === 'urgent' ? 'bg-danger-500' : worst === 'watch' ? 'bg-warn-500' : 'bg-brand-600'

  return (
    <li className="animate-rise relative flex gap-3 pb-3" style={riseStyle(index)}>
      <div className="flex flex-col items-center pt-4">
        <span className={cx('size-2.5 shrink-0 rounded-full ring-4 ring-slate-50', dot)} />
        {!isLast && <span className="mt-1 w-px flex-1 bg-line" />}
      </div>

      <Link
        to={
          draft
            ? `/patient/${patientId}/encounter/${encounter.id}`
            : `/patient/${patientId}/encounter/${encounter.id}/review`
        }
        className="press press-active surface-card group min-w-0 flex-1 rounded-card p-3.5 hover:-translate-y-0.5 hover:shadow-float"
      >
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-xs font-bold tracking-wide text-ink-4 uppercase">
            {formatDate(encounter.occurredAt, lang)}
          </span>
          {draft && <Badge tone="watch">{t.draft}</Badge>}
        </div>

        <p className="leading-snug font-bold text-ink">
          {encounter.diagnosis || encounter.chiefComplaint || t.notes}
        </p>

        {hasAnyVital(vitals) && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {VITAL_ORDER.filter((k) => vitals[k] !== undefined).map((k) => {
              const value = vitals[k]!
              const severity = vitalSeverity(k, value)
              return (
                <span
                  key={k}
                  className={cx(
                    'numeric rounded-md px-1.5 py-0.5 text-xs font-semibold',
                    severity === 'urgent'
                      ? 'bg-danger-50 text-danger-700'
                      : severity === 'watch'
                        ? 'bg-warn-50 text-warn-700'
                        : 'bg-sunken text-ink-2',
                  )}
                >
                  {formatVital(k, value)}
                </span>
              )
            })}
          </div>
        )}

        {encounter.prescriptions.length > 0 && (
          <p className="mt-2 truncate text-sm text-ink-3">
            {encounter.prescriptions.map((p) => p.drug).join(' · ')}
          </p>
        )}
      </Link>
    </li>
  )
}

export function PatientProfile() {
  const { patientId } = useParams()
  const { t } = useI18n()
  const navigate = useNavigate()

  const patient = useLiveQuery(() => (patientId ? db.patients.get(patientId) : undefined), [patientId])
  const encounters = useLiveQuery(() => (patientId ? patientEncounters(patientId) : []), [patientId])

  if (patient === undefined) {
    return (
      <AppShell title="…" showBack>
        <SkeletonRows count={3} />
      </AppShell>
    )
  }

  if (patient === null || !patientId) {
    return (
      <AppShell title={t.patients} showBack>
        <EmptyState title={t.noResults} />
      </AppShell>
    )
  }

  const age = patientAge(patient)
  const sexLabel = patient.sex === 'female' ? t.female : patient.sex === 'male' ? t.male : t.unknown

  async function startEncounter() {
    if (!patientId) return
    const id = await createDraftEncounter(patientId)
    navigate(`/patient/${patientId}/encounter/${id}`)
  }

  /**
   * Deleting a patient takes their consultations with them, so the count goes
   * in the prompt. "Delete this patient?" and "delete this patient and the
   * eleven consultations recorded for them" are different decisions, and only
   * the second one is the truth.
   */
  async function removePatient() {
    if (!patientId) return
    const count = encounters?.length ?? 0
    const warning =
      count > 0
        ? `${t.deletePatientConfirm}\n\n${count} ${t.consultationsWillBeDeleted}`
        : t.deletePatientConfirm
    if (!window.confirm(warning)) return
    await deletePatient(patientId)
    navigate('/patients', { replace: true })
  }

  const details = [
    patient.registerNo && { icon: FileText, text: `${t.registerNo} ${patient.registerNo}` },
    patient.address && { icon: MapPin, text: patient.address },
    { icon: Languages, text: LANG_LABELS[patient.preferredLang] },
  ].filter(Boolean) as { icon: typeof FileText; text: string }[]

  return (
    <AppShell
      title={`${patient.familyName} ${patient.givenName}`}
      showBack
      actions={
        <MoreMenu
          label={t.manage}
          items={[
            {
              label: t.editPatient,
              icon: <Pencil size={16} />,
              onSelect: () => navigate(`/patient/${patientId}/edit`),
            },
            {
              label: t.mergeDuplicate,
              icon: <Merge size={16} />,
              onSelect: () => navigate(`/patient/${patientId}/merge`),
            },
            {
              label: t.deletePatient,
              icon: <Trash2 size={16} />,
              danger: true,
              onSelect: () => void removePatient(),
            },
          ]}
        />
      }
    >
      <div className="flex flex-col gap-5 pb-4">
        <Card className="flex items-center gap-4">
          <Avatar familyName={patient.familyName} givenName={patient.givenName} size="lg" />
          <div className="min-w-0 flex-1">
            <p className="text-xl leading-tight font-extrabold tracking-[-0.045em] text-ink">
              {patient.familyName} {patient.givenName}
            </p>
            <p className="numeric mt-0.5 text-sm text-ink-3">
              {[age !== undefined ? `${age} ${t.years}` : null, sexLabel].filter(Boolean).join(' · ')}
            </p>
            {patient.phone && (
              <a
                href={`tel:${patient.phone}`}
                className="numeric mt-2 inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-1 text-sm font-semibold text-brand-800"
              >
                <Phone size={14} />
                {patient.phone}
              </a>
            )}
          </div>
        </Card>

        {details.length > 0 && (
          <Card className="flex flex-col gap-2 py-3 text-sm">
            {details.map(({ icon: Icon, text }, i) => (
              <div key={i} className="flex items-center gap-2.5 text-ink-2">
                <Icon size={16} className="shrink-0 text-ink-4" />
                <span className="truncate">{text}</span>
              </div>
            ))}
          </Card>
        )}

        <section>
          <SectionTitle>
            {t.encounters}
            {encounters && encounters.length > 0 ? ` · ${encounters.length}` : ''}
          </SectionTitle>
          {encounters === undefined ? (
            <SkeletonRows count={2} />
          ) : encounters.length === 0 ? (
            <EmptyState icon={<ClipboardList size={30} />} title={t.noEncounters} />
          ) : (
            <ul className="flex flex-col">
              {encounters.map((e, i) => (
                <TimelineEntry
                  key={e.id}
                  encounter={e}
                  patientId={patientId}
                  isLast={i === encounters.length - 1}
                  index={i}
                />
              ))}
            </ul>
          )}
        </section>
      </div>

      <ActionBar>
        <Button size="lg" full icon={<CalendarPlus size={22} />} onClick={startEncounter}>
          {t.newEncounter}
        </Button>
      </ActionBar>
    </AppShell>
  )
}
