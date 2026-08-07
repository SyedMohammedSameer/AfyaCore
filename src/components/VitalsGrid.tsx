import { Activity, Camera, Gauge, Keyboard, Mic, Ruler, Scale, Thermometer, Wind } from 'lucide-react'
import {
  VITAL_RANGES,
  vitalSeverity,
  type CaptureSource,
  type FieldProvenance,
  type Vitals,
  type VitalKey,
} from '../db/schema'
import { VITAL_ORDER, vitalLabel } from '../lib/format'
import { cx } from './ui'
import { useI18n } from '../i18n'

const SOURCE_ICON: Record<CaptureSource, typeof Mic> = {
  voice: Mic,
  photo: Camera,
  manual: Keyboard,
}

const VITAL_ICON: Record<VitalKey, typeof Thermometer> = {
  temperature: Thermometer,
  pulse: Activity,
  systolic: Gauge,
  diastolic: Gauge,
  respiratoryRate: Wind,
  oxygenSaturation: Wind,
  weight: Scale,
  height: Ruler,
}

/**
 * Provenance chip.
 *
 * Every field the clinician did not type themselves is labelled with where it
 * came from. This is the mechanism that makes machine assistance safe: nothing
 * is ever silently attributed to the clinician, and a low-confidence extraction
 * is visibly marked as something to check.
 */
export function ProvenanceChip({ provenance }: { provenance: FieldProvenance | undefined }) {
  const { t } = useI18n()
  if (!provenance || provenance.source === 'manual') return null

  const Icon = SOURCE_ICON[provenance.source]
  const label = provenance.source === 'voice' ? t.sourceVoice : t.sourcePhoto
  const uncertain = (provenance.confidence ?? 1) < 0.8

  return (
    <span
      title={provenance.rawText}
      className={cx(
        'inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[0.6875rem] font-bold',
        uncertain ? 'bg-warn-100 text-warn-700' : 'bg-brand-50 text-brand-700',
      )}
    >
      <Icon size={11} />
      {uncertain ? t.checkThis : label}
    </span>
  )
}

interface VitalsGridProps {
  vitals: Vitals
  provenance: Record<string, FieldProvenance>
  onChange: (key: VitalKey, value: number | undefined) => void
}

/**
 * Vital-sign entry.
 *
 * Previously eight identical boxes, which gave no cue about what mattered and
 * made a filled field indistinguishable from an empty one at a glance. Now each
 * field carries its own icon, a filled field visibly differs from an empty one,
 * and severity paints the whole tile rather than a caption underneath, so a
 * dangerous reading is unmissable while the clinician is still typing.
 */
export function VitalsGrid({ vitals, provenance, onChange }: VitalsGridProps) {
  const { t } = useI18n()

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {VITAL_ORDER.map((key) => {
        const range = VITAL_RANGES[key]
        const value = vitals[key]
        const prov = provenance[`vitals.${key}`]
        const Icon = VITAL_ICON[key]
        const filled = value !== undefined
        const severity = filled ? vitalSeverity(key, value) : 'normal'
        const outOfRange = filled && (value < range.min || value > range.max)

        const tile = outOfRange
          ? 'bg-danger-50/95 ring-danger-400 ring-2'
          : severity === 'urgent'
            ? 'bg-danger-50/95 ring-danger-400 ring-2'
            : severity === 'watch'
              ? 'bg-warn-50/95 ring-warn-300 ring-2'
              : filled
                ? 'bg-brand-50/70 ring-brand-200 ring-1'
                : 'glass-subtle ring-white/80'

        const valueColour = outOfRange || severity === 'urgent'
          ? 'text-danger-700'
          : severity === 'watch'
            ? 'text-warn-700'
            : 'text-slate-900'

        return (
          <label
            key={key}
            className={cx('press flex flex-col rounded-card px-3.5 py-3 shadow-card transition-colors', tile)}
          >
            <span className="mb-1 flex items-center gap-1.5 overflow-hidden">
              <span className={cx('grid size-6 shrink-0 place-items-center rounded-lg', filled ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-400')}>
                <Icon size={13} />
              </span>
              <span className="truncate text-xs font-bold text-slate-600">{vitalLabel(key, t)}</span>
            </span>

            <span className="flex items-baseline gap-1">
              <input
                type="number"
                inputMode="decimal"
                step={range.decimals === 1 ? '0.1' : '1'}
                min={range.min}
                max={range.max}
                value={value ?? ''}
                placeholder="–"
                onChange={(e) => {
                  const raw = e.target.value
                  if (raw === '') {
                    onChange(key, undefined)
                    return
                  }
                  const parsed = Number.parseFloat(raw)
                  onChange(key, Number.isFinite(parsed) ? parsed : undefined)
                }}
                className={cx(
                  'numeric w-full min-w-0 border-0 bg-transparent p-0 text-2xl font-extrabold tracking-tight',
                  'focus:ring-0 focus:outline-none placeholder:font-normal placeholder:text-slate-300',
                  valueColour,
                )}
              />
              <span className="shrink-0 text-xs font-semibold text-slate-400">{range.unit}</span>
            </span>

            <span className="mt-1 flex min-h-4 flex-wrap items-center gap-1">
              <ProvenanceChip provenance={prov} />
              {outOfRange ? (
                <span className="numeric text-[0.6875rem] font-bold text-danger-700">
                  {range.min}–{range.max}
                </span>
              ) : (
                severity !== 'normal' && (
                  <span
                    className={cx(
                      'text-[0.6875rem] font-bold uppercase',
                      severity === 'urgent' ? 'text-danger-700' : 'text-warn-700',
                    )}
                  >
                    {severity === 'urgent' ? t.urgent : t.watch}
                  </span>
                )
              )}
            </span>
          </label>
        )
      })}
    </div>
  )
}
