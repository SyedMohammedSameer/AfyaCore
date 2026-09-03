import { useState } from 'react'
import { useParams } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import { Moon, Printer, ShieldAlert, Sun, Sunrise, Volume2 } from 'lucide-react'
import { AppShell } from '../components/AppShell'
import { ActionBar, Button, Card, SkeletonRows, cx } from '../components/ui'
import { db } from '../db/db'
import { prescriptionInstruction, totalDoses } from '../lib/format'
import { speak, type RecogniserLang } from '../lib/speech'
import { useI18n } from '../i18n'
import { patientPack, type PatientLang } from '../i18n/patient'
import type { Prescription } from '../db/schema'

/**
 * When to take a dose, as pictures.
 *
 * The single most useful thing on this sheet for a patient who cannot read.
 * Literacy in rural Madagascar is far from universal, and "3 fois par jour" is
 * meaningless to someone who cannot read it, three filled icons for sunrise,
 * midday and night are not. The icons are shown *alongside* the words, never
 * instead of them, so the sheet still works for a reader and for a family
 * member helping later.
 */
function DosingClock({ frequencyPerDay }: { frequencyPerDay?: number }) {
  if (!frequencyPerDay) return null

  // Standard dispensing patterns. Above three doses a day the icon metaphor
  // stops being honest, so the number is shown plainly instead.
  const slots: { icon: typeof Sun; on: boolean }[] =
    frequencyPerDay === 1
      ? [
          { icon: Sunrise, on: true },
          { icon: Sun, on: false },
          { icon: Moon, on: false },
        ]
      : frequencyPerDay === 2
        ? [
            { icon: Sunrise, on: true },
            { icon: Sun, on: false },
            { icon: Moon, on: true },
          ]
        : frequencyPerDay === 3
          ? [
              { icon: Sunrise, on: true },
              { icon: Sun, on: true },
              { icon: Moon, on: true },
            ]
          : []

  if (slots.length === 0) {
    return (
      <span className="numeric inline-flex items-center gap-1.5 rounded-xl bg-brand-50 px-3 py-2 text-lg font-extrabold text-brand-800">
        {frequencyPerDay}×
      </span>
    )
  }

  return (
    <div className="flex gap-1.5" aria-hidden>
      {slots.map(({ icon: Icon, on }, i) => (
        <span
          key={i}
          className={cx(
            'grid size-11 place-items-center rounded-xl ring-1',
            on ? 'bg-brand-600 text-white ring-brand-700' : 'bg-sunken text-ink-4 ring-line',
          )}
        >
          <Icon size={22} strokeWidth={2.2} />
        </span>
      ))}
    </div>
  )
}

function PrescriptionRow({ p, index, lang }: { p: Prescription; index: number; lang: PatientLang }) {
  const total = totalDoses(p)
  // The drug name is already the card heading, so the detail line drops it.
  const detail = prescriptionInstruction({ ...p, drug: '' }, lang).replace(/^,\s*/, '')

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <span className="numeric grid size-9 shrink-0 place-items-center rounded-xl bg-brand-100 text-lg font-extrabold text-brand-800">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          {/* Large type: read at arm's length, often by someone with limited literacy. */}
          <p className="text-xl leading-tight font-extrabold break-words text-ink">{p.drug}</p>
          {p.dose && <p className="numeric text-lg font-semibold text-brand-800">{p.dose}</p>}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <DosingClock frequencyPerDay={p.frequencyPerDay} />
        {total !== undefined && (
          <span className="numeric rounded-xl bg-sunken px-3 py-2 text-base font-bold text-ink-2">
            {total} ×
          </span>
        )}
      </div>

      {detail && <p className="text-base leading-snug text-ink-2">{detail}</p>}
    </Card>
  )
}

/**
 * Patient instruction sheet.
 *
 * The one screen a patient actually looks at, so it is rendered in *their*
 * language rather than the clinician's. Madagascar's records are French but most
 * patients are not French speakers, closing that gap is the clearest everyday
 * win the app offers, and it needs no model to deliver.
 */
export function Instructions() {
  const { encounterId, patientId } = useParams()
  const { t } = useI18n()
  const [spoken, setSpoken] = useState<'idle' | 'ok' | 'unavailable'>('idle')

  const encounter = useLiveQuery(
    () => (encounterId ? db.encounters.get(encounterId) : undefined),
    [encounterId],
  )
  const patient = useLiveQuery(() => (patientId ? db.patients.get(patientId) : undefined), [patientId])

  if (encounter === undefined || patient === undefined) {
    return (
      <AppShell title={t.instructions} showBack>
        <SkeletonRows count={2} />
      </AppShell>
    )
  }
  if (!encounter || !patient) {
    return (
      <AppShell title={t.instructions} showBack>
        <Card>{t.noResults}</Card>
      </AppShell>
    )
  }

  // The patient's language, not the interface language.
  const lang = patient.preferredLang
  const pack = patientPack(lang)
  const fullText = encounter.prescriptions.map((p) => prescriptionInstruction(p, lang)).join('. ')

  function readAloud() {
    if (!fullText) return
    // No voice for most of these languages, which is reported rather than
    // failing silently: the sheet is the deliverable, speech is a bonus.
    const voice = pack.speechLang as RecogniserLang | null
    setSpoken(voice && speak(fullText, voice) ? 'ok' : 'unavailable')
  }

  return (
    <AppShell title={t.instructions} subtitle={`${patient.familyName} ${patient.givenName}`} showBack>
      <div className="flex flex-col gap-3 pb-4">
        <div className="rounded-card bg-brand-gradient px-4 py-4 text-white shadow-lift">
          <p className="text-sm font-semibold text-white/70">{pack.instructionsFor}</p>
          <p className="text-2xl leading-tight font-extrabold">
            {patient.familyName} {patient.givenName}
          </p>
          {encounter.diagnosis && <p className="mt-1 text-lg text-white/85">{encounter.diagnosis}</p>}
        </div>

        {encounter.prescriptions.length === 0 ? (
          <Card>
            <p className="text-ink-3">{pack.noPrescriptions}</p>
          </Card>
        ) : (
          <ol className="flex flex-col gap-3">
            {encounter.prescriptions.map((p, i) => (
              <li key={p.id}>
                <PrescriptionRow p={p} index={i} lang={lang} />
              </li>
            ))}
          </ol>
        )}

        {spoken === 'unavailable' && (
          <p className="rounded-field bg-warn-50 p-3 text-sm text-warn-700 print:hidden">{t.noVoiceAvailable}</p>
        )}

        {!pack.reviewed && (
          /* Shown to the clinician handing the sheet over, and printed with it.
             A translation nobody has checked is a safety claim nobody has
             checked, and the person who can catch it is the one in the room. */
          <p className="flex items-start gap-2 rounded-field bg-warn-50 p-2.5 text-xs leading-relaxed text-warn-700">
            <ShieldAlert size={16} className="mt-0.5 shrink-0" />
            {t.unreviewedTranslation.replace('{lang}', pack.name)}
          </p>
        )}

        <p className="px-1 text-xs text-ink-4 print:hidden">{t.dataNotice}</p>
      </div>

      <ActionBar>
        <Button variant="secondary" full icon={<Volume2 size={20} />} onClick={readAloud} disabled={!fullText}>
          {t.speakAloud}
        </Button>
        <Button full icon={<Printer size={20} />} onClick={() => window.print()}>
          {t.print}
        </Button>
      </ActionBar>
    </AppShell>
  )
}
