import { useState } from 'react'
import { useNavigate, useParams, useSearchParams, Link } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import { AlertTriangle, Check, CheckCircle2, Languages, Pencil, RotateCcw, Trash2 } from 'lucide-react'
import { AppShell } from '../components/AppShell'
import { ActionBar, Badge, Button, Card, MoreMenu, SectionTitle, Spinner, cx } from '../components/ui'
import { ProvenanceChip } from '../components/VitalsGrid'
import { db } from '../db/db'
import { deleteEncounter, finaliseEncounter, reviewEncounterField } from '../db/repo'
import { fieldSignature, isReviewed, isStale, machineFields, reviewProgress } from '../lib/fieldReview'
import {
  formatDateTime,
  formatVital,
  prescriptionInstruction,
  provenanceLabel,
  VITAL_ORDER,
  vitalLabel,
} from '../lib/format'
import { UNCERTAIN_BELOW, vitalSeverity, type Encounter, type LangCode, type VitalKey } from '../db/schema'
import { useI18n, type Strings } from '../i18n'

/** The value behind a machine-entered field, formatted for a reviewer. */
function displayValue(encounter: Encounter, key: string, lang: LangCode): string {
  if (key.startsWith('vitals.')) {
    const vital = key.slice('vitals.'.length) as VitalKey
    const value = encounter.vitals[vital]
    return value === undefined ? '' : formatVital(vital, value)
  }
  if (key.startsWith('prescription.')) {
    const p = encounter.prescriptions.find((p) => p.id === key.slice('prescription.'.length))
    return p ? prescriptionInstruction(p, lang) : ''
  }
  if (key === 'chiefComplaint' || key === 'diagnosis' || key === 'notes') return encounter[key] ?? ''
  return ''
}

/**
 * One machine-entered value, and the tick that approves it.
 *
 * The raw phrase the value was read from sits directly under it, because the
 * question the reviewer is answering is "does 38.5 match what was said", and
 * that is unanswerable without seeing what was said. The tick is bound to the
 * exact value on screen: if the value changes afterwards, the tick comes off
 * and the row says why.
 */
function MachineFieldRow({
  encounter,
  fieldKey,
  lang,
  t,
  onTick,
}: {
  encounter: Encounter
  fieldKey: string
  lang: LangCode
  t: Strings
  onTick: (key: string) => void
}) {
  const provenance = encounter.provenance[fieldKey]
  const reviewed = isReviewed(encounter, fieldKey)
  const stale = isStale(encounter, fieldKey)
  const uncertain = (provenance?.confidence ?? 1) < UNCERTAIN_BELOW
  const value = displayValue(encounter, fieldKey, lang)
  const isNote = fieldKey === 'notes'

  return (
    <li
      className={cx(
        'flex items-start gap-3 px-4 py-3.5 transition-colors',
        reviewed ? 'bg-ok-50/40' : stale ? 'bg-warn-50/60' : uncertain ? 'bg-warn-50/40' : '',
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-xs font-semibold tracking-wide text-ink-3 uppercase">
            {provenanceLabel(fieldKey, t)}
          </span>
          <ProvenanceChip provenance={provenance} />
        </div>
        <p
          className={cx(
            'mt-1 text-ink',
            isNote ? 'text-sm whitespace-pre-wrap break-words text-ink-2' : 'numeric text-lg font-semibold',
          )}
        >
          {value}
        </p>
        {provenance?.rawText && !isNote && (
          <p className="mt-1 text-sm whitespace-pre-wrap break-words text-ink-3 italic">« {provenance.rawText} »</p>
        )}
        {stale && (
          <p className="mt-1.5 flex items-start gap-1.5 text-xs font-semibold text-warn-700">
            <RotateCcw size={13} className="mt-0.5 shrink-0" />
            {t.reviewChanged}
          </p>
        )}
      </div>

      {reviewed ? (
        <span className="inline-flex shrink-0 items-center gap-1.5 self-center rounded-full bg-ok-100 px-3 py-2 text-sm font-semibold text-ok-700 ring-1 ring-ok-200">
          <CheckCircle2 size={16} />
          {t.tickedField}
        </span>
      ) : (
        <Button
          variant="secondary"
          icon={<Check size={16} />}
          onClick={() => onTick(fieldKey)}
          className="shrink-0 self-center"
        >
          {t.tickField}
        </Button>
      )}
    </li>
  )
}

/**
 * Review and confirm.
 *
 * The one screen that stands between any captured data, dictated, photographed
 * or typed, and the permanent record. Every value the machine produced is
 * listed and has to be ticked individually before the record can be confirmed.
 * A review step nobody reads is not a safeguard, and a single "confirm" button
 * over a page of numbers is a review step nobody reads by the fortieth patient.
 */
export function Review() {
  const { patientId, encounterId } = useParams()
  const [search] = useSearchParams()
  const { t, lang } = useI18n()
  const navigate = useNavigate()
  const [notice, setNotice] = useState<string | null>(null)

  const encounter = useLiveQuery(
    () => (encounterId ? db.encounters.get(encounterId) : undefined),
    [encounterId],
  )
  const patient = useLiveQuery(() => (patientId ? db.patients.get(patientId) : undefined), [patientId])

  if (!encounterId || !patientId) return null
  if (encounter === undefined || patient === undefined) {
    return (
      <AppShell title={t.review} showBack>
        <Spinner />
      </AppShell>
    )
  }
  if (encounter === null || patient === null) {
    return (
      <AppShell title={t.review} showBack>
        <Card>{t.noResults}</Card>
      </AppShell>
    )
  }

  const isDraft = encounter.status === 'draft'
  // A confirmed record reached through "Correct" is being amended: the save
  // goes through the same gate as a first confirmation, and is audited as an
  // amendment rather than as a confirmation.
  const amending = !isDraft && search.get('amend') === '1'
  const progress = reviewProgress(encounter)
  const ready = progress.pending.length === 0

  // Uncertain values first: they are the ones most worth a second look, and a
  // list that buries them under confident ones is a list that gets skimmed.
  // Order is otherwise the order the values arrived in, and it does not change
  // when a row is ticked, so nothing jumps under the reviewer's thumb.
  const fields = machineFields(encounter).sort((a, b) => {
    const ca = encounter.provenance[a]?.confidence ?? 1
    const cb = encounter.provenance[b]?.confidence ?? 1
    return Number(cb < UNCERTAIN_BELOW) - Number(ca < UNCERTAIN_BELOW)
  })

  const filledVitals = VITAL_ORDER.filter((k) => encounter.vitals[k] !== undefined)

  async function tick(key: string) {
    setNotice(null)
    try {
      await reviewEncounterField(encounterId!, key, fieldSignature(encounter!, key))
    } catch (err) {
      // The row re-renders from the live query either way; this only names
      // the reason when a tick did not land.
      const message = (err as Error).message
      setNotice(message === 'review-field-changed' ? t.reviewChanged : message)
    }
  }

  async function confirm() {
    setNotice(null)
    try {
      await finaliseEncounter(encounterId!)
    } catch (err) {
      setNotice((err as Error).message === 'review-required' ? t.reviewRequired : (err as Error).message)
      return
    }
    navigate(`/patient/${patientId}/encounter/${encounterId}/instructions`, { replace: true })
  }

  /**
   * Deleting a *confirmed* consultation is not the same act as discarding a
   * draft, so it does not get the draft's one-tap treatment. The record has
   * already been counted in this month's aggregate, and may already have been
   * submitted, which is what the prompt says out loud before anything happens.
   */
  async function removeEncounter() {
    if (!window.confirm(t.deleteRecordConfirm)) return
    await deleteEncounter(encounterId!)
    navigate(`/patient/${patientId}`, { replace: true })
  }

  const showChecklist = fields.length > 0 && (isDraft || amending || !ready)

  return (
    <AppShell
      title={isDraft ? t.review : amending ? t.amend : t.encounters}
      subtitle={`${patient.familyName} ${patient.givenName}`}
      showBack
      actions={
        isDraft ? undefined : (
          <MoreMenu
            label={t.manage}
            items={[
              {
                label: t.amend,
                icon: <Pencil size={16} />,
                onSelect: () => navigate(`/patient/${patientId}/encounter/${encounterId}`),
              },
              {
                label: t.deleteRecord,
                icon: <Trash2 size={16} />,
                danger: true,
                onSelect: () => void removeEncounter(),
              },
            ]}
          />
        )
      }
    >
      <div className="flex flex-col gap-5 pb-4">
        <p className="text-sm text-ink-3">{formatDateTime(encounter.occurredAt, lang)}</p>

        {showChecklist && (
          <section>
            <SectionTitle
              action={
                <span
                  className={cx(
                    'numeric text-xs font-semibold',
                    ready ? 'text-ok-700' : 'text-warn-700',
                  )}
                >
                  {progress.done}/{progress.total} {t.checkedCount}
                </span>
              }
            >
              {t.machineFields}
            </SectionTitle>
            <Card className="overflow-hidden p-0">
              <p className="px-4 pt-3.5 pb-3 text-sm leading-relaxed text-ink-3">{t.machineFieldsHint}</p>
              {/* A thin progress rule rather than a number alone: the eye
                  reads "nearly there" off a bar faster than off 4/5. */}
              <div className="mx-4 mb-1 h-1 overflow-hidden rounded-full bg-line" aria-hidden>
                <div
                  className={cx('h-full rounded-full transition-[width]', ready ? 'bg-ok-500' : 'bg-brand-600')}
                  style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }}
                />
              </div>
              <ul className="divide-y divide-line">
                {fields.map((key) => (
                  <MachineFieldRow
                    key={key}
                    encounter={encounter}
                    fieldKey={key}
                    lang={lang}
                    t={t}
                    onTick={tick}
                  />
                ))}
              </ul>
              <p
                className={cx(
                  'flex items-start gap-2 border-t border-line px-4 py-3 text-sm font-medium',
                  ready ? 'text-ok-700' : 'text-warn-700',
                )}
              >
                {ready ? <CheckCircle2 size={18} className="shrink-0" /> : <AlertTriangle size={18} className="shrink-0" />}
                {ready ? t.allChecked : t.reviewRequired}
              </p>
            </Card>
          </section>
        )}

        {notice && (
          <p className="rounded-field bg-danger-50 p-2.5 text-sm font-medium text-danger-700">{notice}</p>
        )}

        {(encounter.chiefComplaint || encounter.diagnosis) && (
          <section className="flex flex-col gap-3">
            {encounter.chiefComplaint && (
              <Card>
                <div className="mb-1 flex items-center gap-2">
                  <SectionTitle>{t.chiefComplaint}</SectionTitle>
                  <ProvenanceChip provenance={encounter.provenance.chiefComplaint} />
                </div>
                <p className="text-ink">{encounter.chiefComplaint}</p>
              </Card>
            )}
            {encounter.diagnosis && (
              <Card>
                <div className="mb-1 flex items-center gap-2">
                  <SectionTitle>{t.diagnosis}</SectionTitle>
                  <ProvenanceChip provenance={encounter.provenance.diagnosis} />
                </div>
                <p className="text-lg font-semibold text-ink">{encounter.diagnosis}</p>
              </Card>
            )}
          </section>
        )}

        {filledVitals.length > 0 && (
          <section>
            <SectionTitle>{t.vitals}</SectionTitle>
            <Card>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                {filledVitals.map((k) => {
                  const value = encounter.vitals[k]!
                  const severity = vitalSeverity(k, value)
                  return (
                    <div key={k} className="min-w-0">
                      {/* Wraps rather than colliding: "Tension (sys)" plus an
                          "À vérifier" chip does not fit one line on a phone. */}
                      <dt className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs font-semibold text-ink-3">
                        <span>{vitalLabel(k, t)}</span>
                        <ProvenanceChip provenance={encounter.provenance[`vitals.${k}`]} />
                      </dt>
                      <dd
                        className={`text-lg font-bold ${
                          severity === 'urgent'
                            ? 'text-danger-600'
                            : severity === 'watch'
                              ? 'text-warn-700'
                              : 'text-ink'
                        }`}
                      >
                        {formatVital(k, value)}
                        {severity !== 'normal' && (
                          <span className="ml-2 align-middle">
                            <Badge tone={severity === 'urgent' ? 'urgent' : 'watch'}>
                              {severity === 'urgent' ? t.urgent : t.watch}
                            </Badge>
                          </span>
                        )}
                      </dd>
                    </div>
                  )
                })}
              </dl>
            </Card>
          </section>
        )}

        {encounter.prescriptions.length > 0 && (
          <section>
            <SectionTitle>{t.prescriptions}</SectionTitle>
            <Card>
              <ul className="flex flex-col gap-3">
                {encounter.prescriptions.map((p) => (
                  <li key={p.id} className="flex items-start gap-2">
                    <span className="mt-2 size-1.5 shrink-0 rounded-full bg-brand-600" />
                    <div className="min-w-0">
                      {/* The clinician's own language. The patient sheet is the
                          screen that follows the patient's, not this one. */}
                      <p className="font-semibold text-ink">{prescriptionInstruction(p, lang)}</p>
                      <ProvenanceChip provenance={encounter.provenance[`prescription.${p.id}`]} />
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        )}

        {encounter.notes && (
          <section>
            <SectionTitle>{t.notes}</SectionTitle>
            <Card>
              <p className="whitespace-pre-wrap text-ink-2">{encounter.notes}</p>
            </Card>
          </section>
        )}
      </div>

      <ActionBar>
        {isDraft || amending ? (
          <>
            <Button
              variant="secondary"
              icon={<Pencil size={18} />}
              onClick={() => navigate(`/patient/${patientId}/encounter/${encounterId}`)}
            >
              {t.edit}
            </Button>
            <Button full icon={<Check size={20} />} onClick={confirm} disabled={!ready}>
              {isDraft ? t.confirmSave : t.saveCorrection}
            </Button>
          </>
        ) : (
          <Link to={`/patient/${patientId}/encounter/${encounterId}/instructions`} className="w-full">
            <Button full icon={<Languages size={20} />}>
              {t.instructions}
            </Button>
          </Link>
        )}
      </ActionBar>
    </AppShell>
  )
}
