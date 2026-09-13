import { useMemo } from 'react'
import { cx } from './ui'
import type { ExtractionResult } from '../lib/clinicalExtract'
import { useI18n } from '../i18n'

type Kind = 'vital' | 'prescription' | 'diagnosis' | 'complaint'

interface Span {
  start: number
  end: number
  kind: Kind
}

/*
 * Field types are told apart by hue, and none of the hues is a status colour.
 * Red and amber mean "out of range" everywhere else in this app; a highlighted
 * temperature must not look like a dangerous one.
 */
const KIND_STYLE: Record<Kind, string> = {
  vital: 'bg-brand-100 text-brand-900 decoration-brand-400',
  prescription: 'bg-info-100 text-info-700 decoration-info-200',
  diagnosis: 'bg-[#E7E0F1] text-[#453268] decoration-[#B9A9D6]',
  complaint: 'bg-[#DBE5F1] text-[#24486C] decoration-[#9DB6D3]',
}

/**
 * Find each extracted phrase in the transcript, first unclaimed occurrence.
 *
 * `rawText` is the exact span the extractor matched, so a plain search finds
 * it; the claim set stops two identical phrases ("tension onze sur sept" is
 * the source of both systolic and diastolic) from being marked twice or the
 * second one landing on the first.
 */
function locate(text: string, result: ExtractionResult): Span[] {
  const spans: Span[] = []
  const lower = text.toLowerCase()
  const claim = (raw: string | undefined, kind: Kind) => {
    if (!raw) return
    const needle = raw.toLowerCase()
    let from = 0
    while (from <= lower.length) {
      const at = lower.indexOf(needle, from)
      if (at < 0) return
      const end = at + needle.length
      const overlaps = spans.some((s) => at < s.end && end > s.start)
      if (!overlaps) {
        spans.push({ start: at, end, kind })
        return
      }
      // Same phrase, already marked: the second field it feeds shares the
      // mark rather than getting a duplicate.
      if (spans.some((s) => s.start === at && s.end === end)) return
      from = at + 1
    }
  }
  for (const field of Object.values(result.vitals)) claim(field.rawText, 'vital')
  for (const p of result.prescriptions) claim(p.rawText, 'prescription')
  claim(result.diagnosis?.rawText, 'diagnosis')
  claim(result.chiefComplaint?.rawText, 'complaint')
  return spans.sort((a, b) => a.start - b.start)
}

/**
 * The transcript, with what the extractor claimed marked in place.
 *
 * Shown before "Apply" rather than after: the clinician sees which words are
 * about to become which fields while the sentence is still in their head,
 * and what was left unmarked is visibly headed for the notes rather than
 * silently dropped. This is the one place the rule extractor explains
 * itself, and it costs no model to do so.
 */
export function TranscriptHighlights({
  text,
  interim,
  result,
}: {
  text: string
  interim?: string
  result: ExtractionResult
}) {
  const { t } = useI18n()
  const spans = useMemo(() => locate(text, result), [text, result])

  const counts = {
    vital: Object.keys(result.vitals).length,
    prescription: result.prescriptions.length,
    diagnosis: result.diagnosis ? 1 : 0,
    complaint: result.chiefComplaint ? 1 : 0,
  }
  const legend: { kind: Kind; label: string; count: number }[] = [
    { kind: 'vital', label: t.vitals, count: counts.vital },
    { kind: 'prescription', label: t.prescriptions, count: counts.prescription },
    { kind: 'diagnosis', label: t.diagnosis, count: counts.diagnosis },
    { kind: 'complaint', label: t.chiefComplaint, count: counts.complaint },
  ]

  const pieces: React.ReactNode[] = []
  let cursor = 0
  spans.forEach((span, i) => {
    if (span.start > cursor) pieces.push(text.slice(cursor, span.start))
    pieces.push(
      <mark
        key={i}
        className={cx('rounded-sm px-0.5 underline decoration-2 underline-offset-2', KIND_STYLE[span.kind])}
      >
        {text.slice(span.start, span.end)}
      </mark>,
    )
    cursor = span.end
  })
  if (cursor < text.length) pieces.push(text.slice(cursor))

  return (
    <div className="surface-card rounded-field p-3.5">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="text-[0.6875rem] font-bold tracking-wider text-ink-4 uppercase">
          {spans.length > 0 ? t.extractionPreview : t.transcript}
        </p>
        {spans.length > 0 && (
          <ul className="flex flex-wrap gap-x-3 gap-y-1">
            {legend
              .filter((l) => l.count > 0)
              .map((l) => (
                <li key={l.kind} className="flex items-center gap-1.5 text-[0.6875rem] font-semibold text-ink-3">
                  <span className={cx('size-2.5 rounded-sm', KIND_STYLE[l.kind].split(' ')[0])} aria-hidden />
                  <span className="numeric">{l.count}</span> {l.label.toLowerCase()}
                </li>
              ))}
          </ul>
        )}
      </div>
      <p className="text-base leading-relaxed text-ink">
        {pieces}
        {interim && <span className="text-ink-4"> {interim}</span>}
      </p>
    </div>
  )
}
