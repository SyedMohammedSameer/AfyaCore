import { useNavigate, useParams, Link } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import { AlertTriangle, Check, Languages, Pencil, Trash2 } from 'lucide-react'
import { AppShell } from '../components/AppShell'
import { ActionBar, Badge, Button, Card, MoreMenu, SectionTitle, Spinner } from '../components/ui'
import { ProvenanceChip } from '../components/VitalsGrid'
import { db } from '../db/db'
import { deleteEncounter, finaliseEncounter } from '../db/repo'
import {
  formatDateTime,
  formatVital,
  prescriptionInstruction,
  provenanceLabel,
  truncate,
  VITAL_ORDER,
  vitalLabel,
} from '../lib/format'
import { vitalSeverity } from '../db/schema'
import { useI18n } from '../i18n'

/**
 * Review and confirm.
 *
 * The one screen that stands between any captured data, dictated, photographed
 * or typed, and the permanent record. Fields the machine produced with low
 * confidence are surfaced at the top rather than left for the clinician to
 * find, because a review step nobody reads is not a safeguard.
 */
export function Review() {
  const { patientId, encounterId } = useParams()
  const { t, lang } = useI18n()
  const navigate = useNavigate()

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

  const uncertain = Object.entries(encounter.provenance).filter(
    ([, p]) => p.source !== 'manual' && (p.confidence ?? 1) < 0.8,
  )

  const filledVitals = VITAL_ORDER.filter((k) => encounter.vitals[k] !== undefined)

  async function confirm() {
    await finaliseEncounter(encounterId!)
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

  return (
    <AppShell
      title={isDraft ? t.review : t.encounters}
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
        <p className="text-sm text-slate-500">{formatDateTime(encounter.occurredAt, lang)}</p>

        {isDraft && uncertain.length > 0 && (
          <Card variant="plain" className="bg-warn-50 ring-1 ring-warn-200">
            <p className="flex items-start gap-2 font-semibold text-warn-700">
              <AlertTriangle size={20} className="mt-0.5 shrink-0" />
              {t.reviewHint}
            </p>
            <ul className="mt-2 ml-7 list-disc text-sm text-warn-700">
              {uncertain.map(([key, p]) => (
                <li key={key}>
                  <span className="font-medium">{provenanceLabel(key, t)}</span>
                  {p.rawText && <span className="text-warn-700/80">, « {truncate(p.rawText)} »</span>}
                </li>
              ))}
            </ul>
          </Card>
        )}

        {(encounter.chiefComplaint || encounter.diagnosis) && (
          <section className="flex flex-col gap-3">
            {encounter.chiefComplaint && (
              <Card>
                <div className="mb-1 flex items-center gap-2">
                  <SectionTitle>{t.chiefComplaint}</SectionTitle>
                  <ProvenanceChip provenance={encounter.provenance.chiefComplaint} />
                </div>
                <p className="text-slate-900">{encounter.chiefComplaint}</p>
              </Card>
            )}
            {encounter.diagnosis && (
              <Card>
                <div className="mb-1 flex items-center gap-2">
                  <SectionTitle>{t.diagnosis}</SectionTitle>
                  <ProvenanceChip provenance={encounter.provenance.diagnosis} />
                </div>
                <p className="text-lg font-semibold text-slate-900">{encounter.diagnosis}</p>
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
                      <dt className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs font-semibold text-slate-500">
                        <span>{vitalLabel(k, t)}</span>
                        <ProvenanceChip provenance={encounter.provenance[`vitals.${k}`]} />
                      </dt>
                      <dd
                        className={`text-lg font-bold ${
                          severity === 'urgent'
                            ? 'text-danger-600'
                            : severity === 'watch'
                              ? 'text-warn-700'
                              : 'text-slate-900'
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
                      <p className="font-semibold text-slate-900">{prescriptionInstruction(p, lang)}</p>
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
              <p className="whitespace-pre-wrap text-slate-700">{encounter.notes}</p>
            </Card>
          </section>
        )}
      </div>

      <ActionBar>
        {isDraft ? (
          <>
            <Button
              variant="secondary"
              icon={<Pencil size={18} />}
              onClick={() => navigate(`/patient/${patientId}/encounter/${encounterId}`)}
            >
              {t.edit}
            </Button>
            <Button full icon={<Check size={20} />} onClick={confirm}>
              {t.confirmSave}
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
