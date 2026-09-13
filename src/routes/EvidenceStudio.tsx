import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowDown, ArrowRight, Check, ChevronDown, Cpu, Download, FlaskConical, Play, RotateCcw, ShieldCheck, Square, Waves, Wifi, WifiOff } from 'lucide-react'
import { AppShell, useOnline } from '../components/AppShell'
import { Button, Card, Field, Select, TextArea, cx } from '../components/ui'
import { TranscriptHighlights } from '../components/TranscriptHighlights'
import { installedPack, LocalWhisperRecogniser, type Pack } from '../lib/asr'
import { extractClinical } from '../lib/clinicalExtract'
import { CLINICAL_LOCALES } from '../lib/clinicalLocales'
import { compareEvidence, evidenceCases, evidenceSummary, sampleUrl, wordErrorRate, type EvidenceLocale, type EvidenceRow } from '../lib/evidence'
import { provenanceLabel, vitalLabel } from '../lib/format'
import type { VitalKey } from '../db/schema'
import { useI18n, type Strings } from '../i18n'
import sampleManifest from '../../public/samples/studio-manifest.json'

interface Run {
  mode: 'local-audio' | 'text-rules'
  transcript: string
  elapsedMs: number
  at: string
  onlineAtStart: boolean
  onlineAtEnd: boolean
  pack: Pack | null
}

function labelFor(key: string, t: Strings): string {
  if (key.startsWith('vitals.')) return vitalLabel(key.slice(7) as VitalKey, t)
  if (!key.startsWith('rx.')) return provenanceLabel(key, t)
  const [, index, attribute] = key.split('.')
  const labels: Record<string, string> = { drug: t.drug, dose: t.dose, frequencyPerDay: t.frequency, durationDays: t.duration }
  return `${t.prescriptions} ${Number(index) + 1} · ${labels[attribute] ?? attribute}`
}

function EvidenceField({ row }: { row: EvidenceRow }) {
  const { t } = useI18n()
  const s = t.studio
  return (
    <details className="studio-field group">
      <summary className="grid cursor-pointer grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 px-4 py-3 sm:grid-cols-[1.2fr_1fr_1fr_8rem] sm:px-5">
        <span className="flex items-center gap-2 text-sm font-medium"><ChevronDown size={13} className="shrink-0 text-ink-3 transition-transform group-open:rotate-180" />{labelFor(row.key, t)}</span>
        <span className="col-start-1 ml-5 text-sm text-ink-3 sm:col-auto sm:ml-0"><span className="sm:hidden">{s.expected}: </span>{row.expected ?? '—'}</span>
        <span className={cx('col-start-1 ml-5 text-sm font-semibold sm:col-auto sm:ml-0', row.status === 'match' ? 'text-ink' : 'text-warn-700')}><span className="font-normal sm:hidden">{s.actual}: </span>{row.actual ?? '—'}</span>
        <span className="col-start-2 row-start-1 flex flex-wrap items-center justify-end gap-1 sm:col-auto sm:row-auto">
          {/* The app's own flag, beside the verdict, so the two can be read
              against each other: did it know it was unsure about the ones it
              got wrong? See UNCERTAIN_BELOW in db/schema.ts. */}
          {row.flagged && (
            <span title={`${s.confidence} ${row.confidence?.toFixed(2)}`} className="inline-flex items-center gap-1 rounded-md bg-warn-50 px-2 py-1 text-xs font-medium text-warn-700">
              <AlertTriangle size={11} />{t.checkThis}
            </span>
          )}
          <span className={cx('inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium', row.status === 'match' ? 'bg-brand-50 text-brand-700' : 'bg-warn-50 text-warn-700')}>
            {row.status === 'match' && <Check size={12} />}{s[row.status]}
          </span>
        </span>
      </summary>
      <div className="border-t border-line bg-sunken px-5 py-3 text-sm"><p className="mb-1 text-xs font-semibold text-ink-3">{s.source}</p><p className="whitespace-pre-wrap break-words">{row.source || '—'}</p></div>
    </details>
  )
}

function Measurement({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <div className="min-w-0 px-4 py-4 sm:px-5"><p className="text-xs text-ink-3">{label}</p><p className="numeric mt-2 text-3xl font-semibold tracking-tight text-ink">{value}</p>{detail && <p className="mt-1 text-xs text-ink-3">{detail}</p>}</div>
}

export function EvidenceStudio() {
  const { t, lang } = useI18n()
  const s = t.studio
  const online = useOnline()
  const [locale, setLocale] = useState<EvidenceLocale>(lang === 'en' ? 'en' : 'fr')
  const [caseIndex, setCaseIndex] = useState(0)
  const [pack, setPack] = useState<Pack | null>(null)
  const [probing, setProbing] = useState(true)
  const [run, setRun] = useState<Run | null>(null)
  const [edited, setEdited] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const [issuesOnly, setIssuesOnly] = useState(false)
  const generation = useRef(0)
  const recogniser = useRef<LocalWhisperRecogniser | null>(null)
  const caseData = evidenceCases[locale][caseIndex]!
  const audioCase = caseIndex === 0
  const clinicalLocale = CLINICAL_LOCALES[locale]

  useEffect(() => {
    let mounted = true
    void installedPack().then((found) => { if (mounted) { setPack(found); setProbing(false) } })
    return () => { mounted = false; generation.current++; recogniser.current?.dispose() }
  }, [])

  const extraction = useMemo(() => extractClinical(edited, clinicalLocale), [edited, clinicalLocale])
  const rows = useMemo(() => compareEvidence(caseData.expect, extraction), [caseData, extraction])
  const summary = evidenceSummary(rows)
  const originalRows = run ? compareEvidence(caseData.expect, extractClinical(run.transcript, clinicalLocale)) : []
  const original = evidenceSummary(originalRows)
  const baseline = evidenceSummary(compareEvidence(caseData.expect, extractClinical(caseData.text, clinicalLocale)))
  const wer = run?.mode === 'local-audio' ? wordErrorRate(caseData.text, run.transcript) : null
  const percent = (value: number | null) => value === null ? '—' : new Intl.NumberFormat(lang, { style: 'percent', maximumFractionDigits: 0 }).format(value)
  const changed = run !== null && edited !== run.transcript
  const visibleRows = issuesOnly ? rows.filter((r) => r.status !== 'match') : rows

  function cancel() {
    generation.current++
    recogniser.current?.dispose()
    recogniser.current = null
    setBusy(false)
  }

  function resetCase(nextLocale: EvidenceLocale, nextIndex: number) {
    cancel()
    setLocale(nextLocale); setCaseIndex(nextIndex); setRun(null); setEdited(''); setError(false)
  }

  async function execute() {
    cancel()
    const id = generation.current
    setBusy(true); setError(false); setRun(null); setEdited('')
    const start = performance.now()
    const onlineAtStart = navigator.onLine
    let transcript = caseData.text
    let failed = false
    // A model failure must not strand a conference demo in a loading state.
    let timeout: number | undefined
    const deadline = new Promise<never>((_, reject) => {
      timeout = window.setTimeout(() => reject(new Error('inference-timeout')), 120_000)
    })
    try {
      if (audioCase) {
        if (!pack) throw new Error('no-local-model')
        transcript = ''
        recogniser.current = new LocalWhisperRecogniser(pack)
        await Promise.race([deadline, recogniser.current.transcribeUrl(
          sampleUrl(locale), locale === 'fr' ? 'fr-FR' : 'en-US',
          (result) => {
            if (generation.current === id && result.isFinal) transcript = [transcript, result.transcript].filter(Boolean).join(' ')
          },
          () => {
            if (generation.current !== id) return
            failed = true
            recogniser.current?.dispose()
          }, { play: false })])
      }
      if (failed) throw new Error('inference-failed')
      if (generation.current !== id) return
      setRun({ mode: audioCase ? 'local-audio' : 'text-rules', transcript, elapsedMs: performance.now() - start,
        at: new Date().toISOString(), onlineAtStart, onlineAtEnd: navigator.onLine, pack: audioCase ? pack : null })
      setEdited(transcript)
    } catch {
      if (generation.current === id) setError(true)
    } finally {
      window.clearTimeout(timeout)
      if (generation.current === id) { recogniser.current?.dispose(); recogniser.current = null; setBusy(false) }
    }
  }

  function download() {
    if (!run) return
    const report = {
      schema: 'afyacore-evidence-session/v1', caseId: caseData.id, locale, corpus: 'synthetic-development',
      limitations: s.limit, run,
      model: run.pack ? { pack: run.pack, dtype: 'q8', device: 'wasm' } : null,
      audio: audioCase ? sampleManifest.samples.find((sample) => sample.locale === locale) : null,
      environment: { userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency },
      reference: caseData.text, expected: caseData.expect, rawWordErrorRate: wer,
      original: { summary: original, fields: originalRows },
      reviewed: { transcript: edited, changed, summary, fields: rows },
      referenceOnly: baseline,
      method: 'Exact atomic-field agreement; missing and unexpected attributes included; prescriptions aligned by order. Not clinical accuracy. Browser network indicators do not prove zero network traffic.',
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }))
    const a = document.createElement('a'); a.href = url; a.download = `afyacore-${caseData.id}-${Date.now()}.json`; a.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <AppShell title={s.title} subtitle={s.subtitle} tabs>
      <div className="flex flex-col gap-6 pb-4">
        <section className="studio-hero">
          <div className="max-w-2xl"><p className="studio-eyebrow"><FlaskConical size={13} />{s.tag}</p><h2 className="mt-3 text-3xl font-medium tracking-[-0.04em] sm:text-[2.5rem]">{s.intro}</h2><p className="mt-3 max-w-xl text-sm leading-relaxed text-white/80">{s.description}</p></div>
          <div className="mt-5 flex flex-wrap gap-2 text-xs"><span className="studio-dark-chip"><ShieldCheck size={13} />{s.synthetic}</span><span className="studio-dark-chip">{online ? <Wifi size={13} /> : <WifiOff size={13} />}{online ? s.online : s.offline}</span></div>
        </section>

        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.35fr)]">
          <Card className="flex flex-col gap-5 sm:p-5">
            <h2 className="studio-section-label">{s.input}</h2>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
              <Field label={s.locale}><Select value={locale} onChange={(e) => resetCase(e.target.value as EvidenceLocale, 0)}><option value="fr">Français</option><option value="en">English</option></Select></Field>
              <Field label={s.case}><Select value={caseIndex} onChange={(e) => resetCase(locale, Number(e.target.value))}>{evidenceCases[locale].map((entry, i) => <option key={entry.id} value={i}>{entry.id.replace(/^[a-z]+-\d+-/, '').replaceAll('-', ' ')} · {i === 0 ? s.audio : s.text}</option>)}</Select></Field>
            </div>
            <div className="rounded-field border border-line bg-sunken p-4"><div className="mb-3 flex items-center gap-2 text-xs font-semibold text-brand-700">{audioCase ? <Waves size={16} /> : <FlaskConical size={16} />}{audioCase ? s.audio : s.text}</div>{audioCase && <audio key={locale} controls preload="none" src={sampleUrl(locale)} className="mb-3 w-full" aria-label={s.reference} />}<p className="text-xs leading-relaxed text-ink-3">{audioCase ? s.audioHint : s.textHint}</p></div>
            <details open className="studio-reference"><summary className="cursor-pointer text-xs font-semibold text-ink-3">{s.reference}</summary><p className="mt-3 text-sm leading-7 text-ink-2">{caseData.text}</p></details>
            {audioCase && !pack && !probing && <p role="status" className="text-sm text-warn-700">{s.noModel}</p>}
            <Button full icon={busy ? <Square size={16} /> : <Play size={16} />} disabled={!busy && audioCase && (probing || !pack)} onClick={busy ? cancel : () => void execute()}>{busy ? s.cancel : audioCase ? s.run : s.runText}</Button>
            <p className="flex items-center gap-2 text-xs text-ink-3"><Cpu size={13} />{audioCase ? `${s.model}: ${pack ?? '—'} · WASM` : s.text}</p>
          </Card>

          <div className="flex min-w-0 flex-col gap-4">
            <Card className="min-h-[24rem] sm:p-5" >
              <h2 className="studio-section-label">{s.output}</h2>
              {!run ? <div className="flex min-h-[19rem] flex-col items-center justify-center px-4 text-center" role="status"><span className={cx('mb-5 grid size-16 place-items-center rounded-2xl border border-brand-200 bg-brand-50 text-brand-700', busy && 'animate-pulse')}><Waves size={28} /></span><p className="text-lg font-semibold">{busy ? s.running : error ? s.error : s.idle}</p><p className="mt-2 max-w-xs text-sm leading-relaxed text-ink-3">{s.idleHint}</p></div> : <div className="mt-5 flex flex-col gap-5">
                <div><p className="mb-2 text-xs font-semibold text-ink-3">{run.mode === 'local-audio' ? s.raw : s.reference}</p><TranscriptHighlights text={run.transcript} result={extractClinical(run.transcript, clinicalLocale)} /></div>
                <div className="flex justify-center text-brand-500" aria-hidden><ArrowDown size={18} /></div>
                <Field label={s.edited} hint={s.editHint}><TextArea aria-label={s.edited} value={edited} onChange={(e) => setEdited(e.target.value)} maxLength={6000} className="min-h-36" /></Field>
                {changed && <Button variant="ghost" icon={<RotateCcw size={14} />} onClick={() => setEdited(run.transcript)} className="self-start">{s.reset}</Button>}
              </div>}
            </Card>
            <div className="grid grid-cols-3 divide-x divide-line overflow-hidden rounded-card border border-line bg-surface" aria-live="polite">
              <Measurement label={s.agreement} value={run ? percent(original.agreement) : '—'} detail={s.before} />
              <Measurement label={s.wordError} value={wer ? percent(wer.wer) : '—'} detail={wer ? `${wer.errors} / ${wer.words}` : s.notRun} />
              <Measurement label={s.elapsed} value={run ? `${(run.elapsedMs / 1000).toFixed(1)} s` : '—'} />
            </div>
          </div>
        </div>

        {run && <section className="overflow-hidden rounded-card border border-line bg-surface">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line px-5 py-5"><div><h2 className="studio-section-label">{s.review}</h2><p className="mt-2 text-xs text-ink-3">{s.sourceHint}</p></div><Button variant="secondary" icon={<Download size={15} />} onClick={download}>{s.download}</Button></div>
          <div className="grid grid-cols-1 gap-3 bg-sunken px-5 py-5 sm:grid-cols-3">
            {[{ label: s.before, score: original }, { label: s.after, score: summary }, { label: s.baseline, score: baseline }].map(({ label, score }, i) => <div key={label} className="flex items-center gap-3"><span className="grid size-8 place-items-center rounded-full border border-line bg-surface text-xs font-semibold text-brand-700">{i + 1}</span><div className="min-w-0 flex-1"><p className="text-xs text-ink-3">{label}</p><p className="numeric mt-1 text-xl font-semibold">{score.matched}<span className="text-sm font-normal text-ink-3"> / {score.total}</span></p></div>{i < 2 && <ArrowRight size={16} className="hidden text-ink-4 sm:block" />}</div>)}
          </div>
          {(() => {
            /* How the flag did on this run, in one sentence.
               Computed over rows the extractor produced, because a value it
               never produced has no row and no flag. */
            const produced = rows.filter((r) => r.status !== 'missing')
            const wrongRows = produced.filter((r) => r.status !== 'match')
            if (produced.length === 0) return null
            const caught = wrongRows.filter((r) => r.flagged).length
            const flaggedCount = produced.filter((r) => r.flagged).length
            return (
              <p className="border-y border-line bg-warn-50/40 px-5 py-3 text-xs leading-relaxed text-ink-2">
                <span className="font-semibold">{s.flagLine}</span>{' '}
                {s.flagBody
                  .replace('{caught}', String(caught))
                  .replace('{wrong}', String(wrongRows.length))
                  .replace('{flagged}', String(flaggedCount))
                  .replace('{produced}', String(produced.length))}
              </p>
            )
          })()}
          <div className="flex flex-wrap items-center gap-2 border-y border-line px-5 py-3">{[false, true].map((only) => <button key={String(only)} aria-pressed={issuesOnly === only} onClick={() => setIssuesOnly(only)} className={cx('tap-safe rounded-lg px-3 py-2 text-xs font-semibold', issuesOnly === only ? 'bg-brand-50 text-brand-700' : 'text-ink-3')}>{only ? s.issues : s.all}{only && ` (${summary.wrong + summary.missing + summary.extra})`}</button>)}</div>
          <div className="hidden grid-cols-[1.2fr_1fr_1fr_8rem] gap-4 border-b border-line px-5 py-2 text-[0.65rem] font-semibold tracking-wider text-ink-3 uppercase sm:grid"><span>{s.field}</span><span>{s.expected}</span><span>{s.actual}</span><span className="w-28" /></div>
          {visibleRows.map((row) => <EvidenceField key={row.key} row={row} />)}
          {visibleRows.length === 0 && <p className="p-5 text-sm text-ink-3">{rows.length === 0 ? s.empty : s.noIssues}</p>}
        </section>}
        <footer className="rounded-card border border-line p-5 text-xs leading-relaxed text-ink-3"><p>{s.limit}</p><details className="mt-3"><summary className="cursor-pointer font-semibold text-ink-2">{s.method}</summary><p className="mt-2">{s.methodText}</p></details></footer>
      </div>
    </AppShell>
  )
}
