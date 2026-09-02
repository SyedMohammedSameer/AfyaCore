import { useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import { AlertTriangle, Camera, Check, Trash2 } from 'lucide-react'
import { AppShell } from '../components/AppShell'
import { ActionBar, Button, Card, Field, SectionTitle, Spinner, TextArea } from '../components/ui'
import { DictationPanel } from '../components/DictationPanel'
import { VitalsGrid, ProvenanceChip } from '../components/VitalsGrid'
import { PrescriptionEditor } from '../components/PrescriptionEditor'
import { AttachmentCard } from '../components/AttachmentCard'
import { db } from '../db/db'
import { addAttachment, deleteEncounter, patchEncounter, removeAttachment } from '../db/repo'
import { compressImage } from '../lib/image'
import { extractClinical, type ExtractionResult } from '../lib/clinicalExtract'
import { useClinicalLocale } from '../lib/facility'
import { mergeExtraction } from '../lib/mergeExtraction'
import { useI18n } from '../i18n'

export function EncounterCapture() {
  const { patientId, encounterId } = useParams()
  const { t } = useI18n()
  // Extraction follows the deployment's country, not the interface
  // language: see src/lib/facility.ts.
  const clinicalLocale = useClinicalLocale()
  const navigate = useNavigate()
  const fileInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  const encounter = useLiveQuery(
    () => (encounterId ? db.encounters.get(encounterId) : undefined),
    [encounterId],
  )
  const patient = useLiveQuery(() => (patientId ? db.patients.get(patientId) : undefined), [patientId])
  const attachments = useLiveQuery(
    () => (encounterId ? db.attachments.where('encounterId').equals(encounterId).toArray() : []),
    [encounterId],
  )

  if (!encounterId || !patientId) return null
  if (encounter === undefined || patient === undefined) {
    return (
      <AppShell title={t.newEncounter} showBack>
        <Spinner />
      </AppShell>
    )
  }
  if (encounter === null) {
    return (
      <AppShell title={t.newEncounter} showBack>
        <Card>{t.noResults}</Card>
      </AppShell>
    )
  }

  // A final encounter reaches this screen only via "Correct" on the review
  // screen. Amending never demotes it back to a draft: it was confirmed by a
  // human, and a correction is still a confirmed record.
  const isDraft = encounter.status === 'draft'

  /** Dictation → structured fields. Never overwrites typed input. */
  async function applyDictation(result: ExtractionResult, transcript: string) {
    if (!encounter) return
    const { patch } = mergeExtraction(encounter, result, transcript, 'voice')
    await patchEncounter(encounterId!, patch)
  }

  /**
   * Photo OCR → structured fields, through exactly the same extractor and the
   * same merge rules as dictation. The OCR engine's own confidence scales the
   * rule confidence down, so text read off a blurry register page lands in the
   * review screen flagged "À vérifier" rather than looking authoritative.
   */
  async function applyOcrText(text: string, ocrConfidence: number) {
    if (!encounter) return
    const { patch } = mergeExtraction(
      encounter,
      extractClinical(text, clinicalLocale),
      text,
      'photo',
      Math.max(0.4, Math.min(1, ocrConfidence)),
    )
    await patchEncounter(encounterId!, patch)
  }

  async function onPickPhoto(file: File | undefined) {
    if (!file) return
    setBusy(true)
    try {
      const { blob, width, height } = await compressImage(file)
      await addAttachment(encounterId!, blob, width, height)
    } finally {
      setBusy(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  /**
   * A draft is discarded on one tap: nothing has been confirmed, and asking
   * "are you sure" about abandoning a half-typed form trains people to dismiss
   * prompts. A *confirmed* consultation is a different act and says so first.
   */
  async function discard() {
    if (!isDraft && !window.confirm(t.deleteRecordConfirm)) return
    await deleteEncounter(encounterId!)
    navigate(`/patient/${patientId}`, { replace: true })
  }

  const prov = encounter.provenance

  return (
    <AppShell
      title={`${patient?.familyName ?? ''} ${patient?.givenName ?? ''}`.trim() || t.newEncounter}
      subtitle={isDraft ? t.newEncounter : t.amend}
      showBack
    >
      <div className="flex flex-col gap-5 pb-4">
        {/* Editing something already confirmed is a different act from filling
            in a draft, and the screen should not look identical while doing it. */}
        {!isDraft && (
          <Card variant="plain" className="flex gap-3 bg-warn-50 text-sm text-warn-700 ring-1 ring-warn-200">
            <AlertTriangle size={18} className="mt-0.5 shrink-0" />
            <p>{t.amendNotice}</p>
          </Card>
        )}

        <DictationPanel onApply={applyDictation} />

        <section>
          <SectionTitle>{t.vitals}</SectionTitle>
          <VitalsGrid
            vitals={encounter.vitals}
            provenance={prov}
            onChange={(key, value) =>
              patchEncounter(encounterId, {
                vitals: { [key]: value },
                provenance: { [`vitals.${key}`]: { source: 'manual' } },
              })
            }
          />
        </section>

        <section className="flex flex-col gap-4">
          <SectionTitle>{t.notes}</SectionTitle>

          <Field label={t.chiefComplaint}>
            <div className="mb-1 flex">
              <ProvenanceChip provenance={prov.chiefComplaint} />
            </div>
            <TextArea
              value={encounter.chiefComplaint ?? ''}
              onChange={(e) =>
                patchEncounter(encounterId, {
                  chiefComplaint: e.target.value,
                  provenance: { chiefComplaint: { source: 'manual' } },
                })
              }
              className="min-h-16"
            />
          </Field>

          <Field label={t.diagnosis}>
            <div className="mb-1 flex">
              <ProvenanceChip provenance={prov.diagnosis} />
            </div>
            <TextArea
              value={encounter.diagnosis ?? ''}
              onChange={(e) =>
                patchEncounter(encounterId, {
                  diagnosis: e.target.value,
                  provenance: { diagnosis: { source: 'manual' } },
                })
              }
              className="min-h-16"
            />
          </Field>

          <Field label={t.notes}>
            <TextArea
              value={encounter.notes ?? ''}
              onChange={(e) =>
                patchEncounter(encounterId, {
                  notes: e.target.value,
                  provenance: { notes: { source: 'manual' } },
                })
              }
            />
          </Field>
        </section>

        <PrescriptionEditor
          prescriptions={encounter.prescriptions}
          provenance={prov}
          onChange={(next) => patchEncounter(encounterId, { prescriptions: next })}
        />

        <section>
          <SectionTitle>{t.attachments}</SectionTitle>
          <div className="flex flex-col gap-3">
            {attachments?.map((a) => (
              <AttachmentCard
                key={a.id}
                attachment={a}
                onRemove={() => removeAttachment(encounterId, a.id)}
                onApplyText={applyOcrText}
              />
            ))}
            <button
              onClick={() => fileInput.current?.click()}
              disabled={busy}
              className="tap-safe flex items-center justify-center gap-2 rounded-field border-2 border-dashed border-line-strong py-4 text-ink-3 active:bg-sunken disabled:opacity-50"
            >
              <Camera size={22} />
              <span className="font-semibold">{t.addPhoto}</span>
            </button>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => onPickPhoto(e.target.files?.[0])}
          />
        </section>
      </div>

      <ActionBar>
        <Button variant="secondary" icon={<Trash2 size={18} />} onClick={discard}>
          {isDraft ? t.delete : t.deleteRecord}
        </Button>
        <Button
          full
          icon={<Check size={20} />}
          onClick={() => navigate(`/patient/${patientId}/encounter/${encounterId}/review`)}
        >
          {isDraft ? t.review : t.saveCorrection}
        </Button>
      </ActionBar>
    </AppShell>
  )
}
