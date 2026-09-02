import { useState } from 'react'
import { ScanText, Trash2, WandSparkles } from 'lucide-react'
import { Button, Card } from './ui'
import { useObjectUrl } from '../lib/image'
import { formatBytes } from '../lib/format'
import { recogniseImage, type OcrResult } from '../lib/ocr'
import { db } from '../db/db'
import { useI18n } from '../i18n'
import type { Attachment } from '../db/schema'

interface AttachmentCardProps {
  attachment: Attachment
  onRemove: () => void
  onApplyText: (text: string, confidence: number) => void
}

/**
 * A photographed record, with optional text extraction.
 *
 * OCR is opt-in per photo rather than automatic: it costs ~12 MB on first use
 * and several seconds of CPU on a mid-range phone, and plenty of photos (a
 * wound, a lab slip kept for reference) contain no text worth reading. Making
 * it a deliberate tap keeps the common case fast.
 */
export function AttachmentCard({ attachment, onRemove, onApplyText }: AttachmentCardProps) {
  const { t } = useI18n()
  const url = useObjectUrl(attachment.blob)
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>(
    attachment.extractedText ? 'done' : 'idle',
  )
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<OcrResult | null>(
    attachment.extractedText ? { text: attachment.extractedText, confidence: 1, lowConfidenceWords: [] } : null,
  )
  const [error, setError] = useState('')

  async function runOcr() {
    setState('running')
    setProgress(0)
    setError('')
    try {
      const ocr = await recogniseImage(attachment.blob, (_stage, p) => setProgress(p))
      setResult(ocr)
      setState('done')
      // Persist so the expensive work is not repeated, and so the text is
      // available to a later export even if it is never applied to a field.
      await db.attachments.update(attachment.id, { extractedText: ocr.text })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setState('error')
    }
  }

  function apply() {
    if (!result?.text) return
    onApplyText(result.text, result.confidence)
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex gap-3">
        {url && (
          <img
            src={url}
            alt=""
            className="size-24 shrink-0 rounded-field object-cover ring-1 ring-line-strong"
            loading="lazy"
          />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <span className="text-xs text-ink-3">
            {attachment.width}×{attachment.height} · {formatBytes(attachment.byteSize)}
          </span>

          {state === 'idle' && (
            <Button variant="secondary" icon={<ScanText size={18} />} onClick={runOcr}>
              {t.readText}
            </Button>
          )}

          {state === 'running' && (
            <div>
              <div className="h-2 overflow-hidden rounded-full bg-line">
                <div
                  className="h-full rounded-full bg-brand-600 transition-[width]"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-ink-3">{t.readingText}</p>
            </div>
          )}
        </div>

        <button
          onClick={onRemove}
          aria-label={t.delete}
          className="tap-safe grid shrink-0 place-items-center self-start rounded-full text-ink-4 active:bg-danger-50 active:text-danger-600"
        >
          <Trash2 size={20} />
        </button>
      </div>

      {state === 'error' && (
        <p className="rounded-field bg-danger-50 p-2.5 text-sm text-danger-700">
          {t.ocrFailed} {error}
        </p>
      )}

      {state === 'done' && result && (
        <div className="flex flex-col gap-2">
          <div className="rounded-field bg-sunken p-3 ring-1 ring-line">
            <p className="mb-1 text-xs font-bold tracking-wide text-ink-3 uppercase">
              {t.transcript}
              {result.confidence > 0 && (
                <span className="ml-2 font-medium text-ink-4 normal-case">
                  {Math.round(result.confidence * 100)}%
                </span>
              )}
            </p>
            <p className="text-sm leading-relaxed whitespace-pre-wrap text-ink">
              {result.text || t.nothingExtracted}
            </p>
          </div>

          {result.lowConfidenceWords.length > 0 && (
            <p className="text-xs text-warn-700">
              {t.checkThis}: {result.lowConfidenceWords.slice(0, 8).join(', ')}
            </p>
          )}

          {result.text && (
            <Button variant="secondary" full icon={<WandSparkles size={18} />} onClick={apply}>
              {t.applyExtraction}
            </Button>
          )}
        </div>
      )}
    </Card>
  )
}
