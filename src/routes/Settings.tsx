import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { CheckCircle2, Download, FileJson, Info, ScanText, ShieldCheck, Sparkles, Table, Trash2 } from 'lucide-react'
import { AppShell } from '../components/AppShell'
import { Button, Card, Field, SectionTitle, Select } from '../components/ui'
import { db } from '../db/db'
import { clearAllData, seedDemoData } from '../db/seed'
import { liveEncounterCount, liveEncounters, livePatientCount, livePatients } from '../db/repo'
import { formatBytes } from '../lib/format'
import { toFhirBundle } from '../lib/fhir'
import { aggregateMonth, toAggregateCsv, toDhis2DataValueSet, indicatorLabel } from '../lib/dhis2'
import { isOcrReady, preloadOcr } from '../lib/ocr'
import { isModelAvailable, loadBackend } from '../lib/openmed'
import { recordAudit } from '../lib/audit'
import { PrivacySelector } from '../components/PrivacySelector'
import { SyncPanel } from '../components/SyncPanel'
import { StaffPanel } from '../components/StaffPanel'
import { CountryPanel } from '../components/CountryPanel'
import { RetentionPanel } from '../components/RetentionPanel'
import { getFacilityCountry } from '../lib/facility'
import { useSession } from '../lib/session'
import { deidentify, type DeidentLevel } from '../lib/deidentify'
import type { NerBackend } from '../lib/openmed'
import { LANG_LABELS, useI18n } from '../i18n'
import type { LangCode } from '../db/schema'

function download(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

const today = () => new Date().toISOString().slice(0, 10)

/**
 * A per-device salt, generated once and kept locally.
 *
 * It never leaves the device, which is what makes a pseudonym irreversible to
 * anyone holding only the export: without the salt, a code cannot be walked
 * back to a patient even by re-hashing a guessed roster.
 */
async function facilitySalt(): Promise<string> {
  const existing = await db.settings.get('deident.salt')
  if (typeof existing?.value === 'string') return existing.value
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  const salt = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  await db.settings.put({ key: 'deident.salt', value: salt })
  return salt
}

export function Settings() {
  const { t, lang, setLang } = useI18n()
  const { may } = useSession()
  const [quota, setQuota] = useState<{ usage: number; quota: number } | null>(null)
  const [ocrState, setOcrState] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    isOcrReady() ? 'ready' : 'idle',
  )
  const [ocrProgress, setOcrProgress] = useState(0)
  const [level, setLevel] = useState<DeidentLevel>('pseudonymous')
  const [lastExport, setLastExport] = useState<string>('')

  const patientCount = useLiveQuery(() => livePatientCount(), [], 0)
  const encounterCount = useLiveQuery(() => liveEncounterCount(), [], 0)
  const attachmentCount = useLiveQuery(() => db.attachments.count(), [], 0)

  // Live preview of what the monthly report will contain, so nobody has to
  // export a file to find out whether the numbers look right.
  const monthlySummary = useLiveQuery(async () => {
    const [patients, encounters] = await Promise.all([livePatients(), liveEncounters()])
    return aggregateMonth(patients, encounters, new Date())
  }, [])

  useEffect(() => {
    db.settings.get('deident.level').then((row) => {
      const v = row?.value
      // A clinician who somehow holds a stored 'identified' preference is put
      // back on the safe level rather than shown a control that will throw.
      if (v === 'identified' && !may('export.identified')) return
      if (v === 'identified' || v === 'pseudonymous' || v === 'anonymous') setLevel(v)
    })
  }, [])

  function changeLevel(next: DeidentLevel) {
    setLevel(next)
    setLastExport('')
    db.settings.put({ key: 'deident.level', value: next })
  }

  /**
   * Every record-level export goes through here, so no export path can bypass
   * the chosen privacy level. Aggregate reports are exempt by construction:
   * they contain counts, never records.
   */
  /**
   * The neural de-identification backend, or null.
   *
   * Resolved once per export rather than held in state: it is only ever needed
   * at the moment an export runs, and loading a 67 MB graph to render a
   * settings screen would be absurd.
   */
  async function neuralBackend(): Promise<NerBackend | undefined> {
    if (level === 'identified') return undefined
    return (await loadBackend()) ?? undefined
  }

  const [piiState, setPiiState] = useState<'absent' | 'checking' | 'ready'>('checking')

  useEffect(() => {
    isModelAvailable().then((ready) => setPiiState(ready ? 'ready' : 'absent'))
  }, [])

  async function prepareRecords() {
    const [patients, encounters] = await Promise.all([livePatients(), liveEncounters()])
    const result = await deidentify(patients, encounters, {
      level,
      salt: await facilitySalt(),
      country: await getFacilityCountry(),
      nerBackend: await neuralBackend(),
    })
    if (level !== 'identified') {
      const neural = result.manifest.neuralRedactions
      const excluded = result.manifest.excludedForConsent
      setLastExport(
        // Consent first: a facility looking at this line most needs to know
        // who is missing from the file, not how many words were blacked out.
        (excluded > 0 ? `${excluded} ${t.excludedForConsent} · ` : '') +
          `${result.manifest.freeTextRedactions} ${t.redactionSummary}` +
          // Reported separately rather than summed: the two passes answer
          // different questions, and a facility deciding whether the 67 MB was
          // worth downloading needs to see what it actually bought.
          (neural !== undefined ? ` · ${neural} ${t.neuralRedactionSummary}` : ''),
      )
    } else {
      setLastExport('')
    }
    // Exports are the disclosure event, so they are the one thing the audit
    // trail must never miss.
    await recordAudit({
      action: 'export',
      subjectType: 'export',
      detail:
        `level=${level} patients=${result.patients.length} ` +
        `encounters=${result.encounters.length} excludedForConsent=${result.manifest.excludedForConsent}`,
    })
    return result
  }

  useEffect(() => {
    navigator.storage?.estimate?.().then((e) => {
      if (e.usage !== undefined && e.quota !== undefined) setQuota({ usage: e.usage, quota: e.quota })
    })
  }, [])

  /** Raw local dump. Attachments excluded to keep the file transferable. */
  async function exportJson() {
    const { patients, encounters, manifest } = await prepareRecords()
    download(
      JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          schemaVersion: 1,
          note: 'Attachments excluded. Field names follow FHIR R4 naming where possible.',
          // Travels with the file so a recipient knows what was stripped, and
          // an identified export is never mistaken for a safe one.
          deidentification: manifest,
          patients,
          encounters,
        },
        null,
        2,
      ),
      `afyacore-export-${level}-${today()}.json`,
      'application/json',
    )
  }

  async function exportFhir() {
    const { patients, encounters } = await prepareRecords()
    download(
      JSON.stringify(toFhirBundle(patients, encounters), null, 2),
      `afyacore-fhir-${level}-${today()}.json`,
      'application/fhir+json',
    )
  }

  async function exportDhis2() {
    const [patients, encounters] = await Promise.all([livePatients(), liveEncounters()])
    download(
      JSON.stringify(toDhis2DataValueSet(patients, encounters, new Date()), null, 2),
      `afyacore-dhis2-${today()}.json`,
      'application/json',
    )
  }

  async function exportCsv() {
    const [patients, encounters] = await Promise.all([livePatients(), liveEncounters()])
    download(toAggregateCsv(patients, encounters, new Date()), `afyacore-rapport-${today()}.csv`, 'text/csv')
  }

  async function downloadOcr() {
    setOcrState('loading')
    setOcrProgress(0)
    try {
      await preloadOcr((_stage, p) => setOcrProgress(p))
      setOcrState('ready')
    } catch {
      setOcrState('error')
    }
  }

  return (
    <AppShell title={t.settings} tabs>
      <div className="flex flex-col gap-5 pb-24">
        <section>
          <SectionTitle>{t.language}</SectionTitle>
          <Card>
            <Field label={t.language}>
              <Select value={lang} onChange={(e) => setLang(e.target.value as LangCode)}>
                {(Object.keys(LANG_LABELS) as LangCode[]).map((code) => (
                  <option key={code} value={code}>
                    {LANG_LABELS[code]}
                  </option>
                ))}
              </Select>
            </Field>
          </Card>
        </section>

        <section>
          <SectionTitle>{t.storage}</SectionTitle>
          <Card className="flex flex-col gap-2 text-sm text-ink-2">
            <div className="flex justify-between">
              <span>{t.patients}</span>
              <span className="font-semibold">{patientCount}</span>
            </div>
            <div className="flex justify-between">
              <span>{t.encounters}</span>
              <span className="font-semibold">{encounterCount}</span>
            </div>
            <div className="flex justify-between">
              <span>{t.attachments}</span>
              <span className="font-semibold">{attachmentCount}</span>
            </div>
            {quota && (
              <>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-line">
                  <div
                    className="h-full rounded-full bg-brand-600"
                    style={{ width: `${Math.min(100, (quota.usage / quota.quota) * 100)}%` }}
                  />
                </div>
                <p className="text-xs text-ink-3">
                  {formatBytes(quota.usage)} / {formatBytes(quota.quota)}
                </p>
              </>
            )}
          </Card>
        </section>

        <section>
          <SectionTitle>{t.ocrPack}</SectionTitle>
          <Card className="flex flex-col gap-3">
            <p className="text-sm text-ink-2">{t.ocrPackHint}</p>
            {ocrState === 'ready' ? (
              <p className="flex items-center gap-2 font-semibold text-ok-700">
                <CheckCircle2 size={20} />
                {t.ocrPackReady}
              </p>
            ) : ocrState === 'loading' ? (
              <div>
                <div className="h-2 overflow-hidden rounded-full bg-line">
                  <div
                    className="h-full rounded-full bg-brand-600 transition-[width]"
                    style={{ width: `${Math.round(ocrProgress * 100)}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-ink-3">{Math.round(ocrProgress * 100)}%</p>
              </div>
            ) : (
              <Button variant="secondary" full icon={<ScanText size={20} />} onClick={downloadOcr}>
                {t.downloadOcrPack}
              </Button>
            )}
            {ocrState === 'error' && <p className="text-sm text-danger-700">{t.ocrFailed}</p>}
          </Card>
        </section>

        <section>
          <SectionTitle>{t.piiPack}</SectionTitle>
          <Card className="flex flex-col gap-3">
            <p className="text-sm text-ink-2">{t.piiPackHint}</p>
            {piiState === 'ready' ? (
              <p className="flex items-center gap-2 font-semibold text-ok-700">
                <CheckCircle2 size={20} />
                {t.piiPackReady}
              </p>
            ) : piiState === 'checking' ? (
              <p className="text-sm text-ink-4">…</p>
            ) : (
              // No download button: the model is placed on the server by the
              // deployer (`npm run vendor:openmed`), not fetched by a phone
              // from the Hub. A facility on a filtered connection cannot reach
              // huggingface.co, which is the whole reason it is self-hosted.
              <p className="text-sm text-ink-3">{t.piiPackAbsent}</p>
            )}
          </Card>
        </section>

        <section>
          <SectionTitle>{t.reporting}</SectionTitle>
          <Card className="flex flex-col gap-3">
            <p className="text-sm text-ink-2">{t.reportingHint}</p>
            {monthlySummary && monthlySummary.length > 0 ? (
              <ul className="flex flex-col gap-1 text-sm">
                {monthlySummary.slice(0, 8).map((c, i) => (
                  <li key={i} className="flex justify-between gap-2">
                    <span className="truncate text-ink-2">
                      {indicatorLabel(c.indicator, lang)} · {c.ageBand}
                    </span>
                    <span className="font-semibold text-ink">{c.count}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-4">{t.noReportData}</p>
            )}
            <Button variant="secondary" full icon={<Table size={20} />} onClick={exportCsv}>
              {t.exportCsv}
            </Button>
            <Button variant="secondary" full icon={<FileJson size={20} />} onClick={exportDhis2}>
              {t.exportDhis2}
            </Button>
          </Card>
        </section>

        <CountryPanel />

        <RetentionPanel />

        <SyncPanel />

        <StaffPanel />

        <PrivacySelector value={level} onChange={changeLevel} />

        <section className="flex flex-col gap-2">
          <SectionTitle>{t.exportData}</SectionTitle>
          <Button variant="secondary" full icon={<FileJson size={20} />} onClick={exportFhir}>
            {t.exportFhir}
          </Button>
          <Button variant="secondary" full icon={<Download size={20} />} onClick={exportJson}>
            {t.exportData}
          </Button>
          {lastExport && (
            <p className="rounded-field bg-ok-50 p-2.5 text-sm font-medium text-ok-700">{lastExport}</p>
          )}
        </section>

        {/* Demo controls. Present so the app can be shown end-to-end without a
            live facility; destructive actions confirm first. */}
        <section className="flex flex-col gap-2">
          <SectionTitle>{t.demo}</SectionTitle>
          <Button variant="secondary" full icon={<Sparkles size={20} />} onClick={() => seedDemoData()}>
            {t.loadDemo}
          </Button>
          <Button
            variant="ghost"
            full
            icon={<Trash2 size={18} />}
            onClick={() => {
              if (window.confirm(t.clearDataConfirm)) clearAllData()
            }}
          >
            {t.clearData}
          </Button>
        </section>

        <Card variant="plain" className="flex gap-3 bg-brand-50 text-sm text-brand-900 ring-1 ring-brand-200">
          <ShieldCheck size={20} className="mt-0.5 shrink-0" />
          <p>{t.dataNotice}</p>
        </Card>

        <Card className="flex gap-3 text-xs text-ink-3">
          <Info size={16} className="mt-0.5 shrink-0" />
          <p>{t.prototypeNotice}</p>
        </Card>
      </div>
    </AppShell>
  )
}
