import { useCallback, useEffect, useRef, useState } from 'react'
import { Mic, Square, WandSparkles, WifiOff } from 'lucide-react'
import { Button, Card, cx } from './ui'
import { useOnline } from './AppShell'
import { recogniser } from '../lib/speech'
import { extractClinical, type ExtractionResult } from '../lib/clinicalExtract'
import { useClinicalLocale } from '../lib/facility'
import { useI18n } from '../i18n'

interface DictationPanelProps {
  onApply: (result: ExtractionResult, transcript: string) => void
}

/**
 * Voice capture.
 *
 * Two rules govern this component:
 *  1. It never writes to the record directly. It proposes an extraction, the
 *     clinician applies it, and the review screen is still ahead of them.
 *  2. It is always optional. When the mic is unavailable or offline, the panel
 *     says so plainly and the manual form below is untouched, it does not
 *     block, nag, or degrade the rest of the screen.
 */
export function DictationPanel({ onApply }: DictationPanelProps) {
  const { t } = useI18n()
  // Recogniser and extractor must agree, or the transcript parses as noise.
  // Follows the deployment's country, not the interface language: see
  // src/lib/facility.ts.
  const locale = useClinicalLocale()
  const online = useOnline()
  const [listening, setListening] = useState(false)
  const [error, setError] = useState('')
  const [finalText, setFinalText] = useState('')
  const [interim, setInterim] = useState('')

  // Interim results arrive continuously; keeping the committed text in a ref
  // avoids a stale closure inside the recogniser callback.
  const finalRef = useRef('')

  const stop = useCallback(() => {
    recogniser.stop()
    setListening(false)
    setInterim('')
  }, [])

  // A recogniser left running when the user navigates away holds the mic open
  // and drains the battery.
  useEffect(() => () => recogniser.stop(), [])

  function start() {
    setError('')
    setListening(true)
    recogniser.start(
      locale.speechLang,
      ({ transcript, isFinal }) => {
        if (isFinal) {
          finalRef.current = `${finalRef.current} ${transcript}`.trim()
          setFinalText(finalRef.current)
          setInterim('')
        } else {
          setInterim(transcript)
        }
      },
      (e) => {
        setError(e === 'not-allowed' ? 'microphone' : e)
        setListening(false)
      },
    )
  }

  function apply() {
    const text = finalRef.current.trim()
    if (!text) return
    onApply(extractClinical(text, locale), text)
  }

  function reset() {
    finalRef.current = ''
    setFinalText('')
    setInterim('')
  }

  if (!recogniser.available) {
    return <Card className="bg-sunken text-sm text-ink-2">{t.micUnavailable}</Card>
  }

  const hasText = finalText.trim().length > 0
  const blocked = !online && recogniser.requiresNetwork

  return (
    <Card
      className={cx(
        'relative flex flex-col gap-4 overflow-hidden transition-colors',
        listening && 'bg-brand-50/90 ring-2 ring-brand-300',
      )}
    >
      <div className="pointer-events-none absolute -top-14 -right-12 size-32 rounded-full bg-brand-100/80 blur-2xl" />
      {blocked && (
        <p className="flex items-start gap-2 rounded-field bg-warn-50 p-2.5 text-sm text-warn-700">
          <WifiOff size={18} className="mt-0.5 shrink-0" />
          {t.micNeedsNetwork}
        </p>
      )}

      <div className="relative flex items-center gap-4">
        <button
          onClick={listening ? stop : start}
          disabled={blocked}
          aria-label={listening ? t.stopDictation : t.dictate}
          aria-pressed={listening}
          className={cx(
            'press press-active relative grid size-16 shrink-0 place-items-center rounded-[1.35rem] text-white shadow-lift ring-1 ring-white/25',
            'disabled:bg-line disabled:text-ink-4 disabled:shadow-none',
            listening ? 'bg-danger-600' : 'bg-brand-gradient active:brightness-95',
          )}
        >
          {listening && (
            <span className="absolute inset-0 animate-pulse-ring rounded-2xl bg-danger-500/40" aria-hidden />
          )}
          {listening ? <Square size={24} fill="currentColor" /> : <Mic size={28} />}
        </button>

        <div className="min-w-0 flex-1">
          <p className="text-lg leading-tight font-extrabold tracking-[-0.03em] text-ink">
            {listening ? t.listening : t.dictate}
          </p>
          <p className="mt-0.5 text-sm leading-snug text-ink-3">{t.dictationHint}</p>
        </div>
      </div>

      {error && (
        <p className="rounded-field bg-danger-50 p-2.5 text-sm font-medium text-danger-700">
          {error === 'microphone' ? t.micUnavailable : error}
        </p>
      )}

      {(hasText || interim) && (
        <div className="surface-card rounded-field p-3.5">
          <p className="mb-1 text-[0.6875rem] font-bold tracking-wider text-ink-4 uppercase">
            {t.transcript}
          </p>
          <p className="text-base leading-relaxed text-ink">
            {finalText}
            {interim && <span className="text-ink-4"> {interim}</span>}
          </p>
        </div>
      )}

      {hasText && (
        <div className="flex gap-2">
          <Button variant="secondary" onClick={reset}>
            {t.cancel}
          </Button>
          <Button full icon={<WandSparkles size={20} />} onClick={apply}>
            {t.applyExtraction}
          </Button>
        </div>
      )}
    </Card>
  )
}
