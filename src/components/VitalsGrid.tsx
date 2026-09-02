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
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {VITAL_ORDER.map((key) => {
        const range = VITAL_RANGES[key]
        const value = vitals[key]
        const prov = provenance[`vitals.${key}`]
        const Icon = VITAL_ICON[key]
        const filled = value !== undefined
        const severity = filled ? vitalSeverity(key, value) : 'normal'
        const outOfRange = filled && (value < range.min || value > range.max)

        const tile = outOfRange
          ? 'bg-danger-50 ring-2 ring-danger-500'
          : severity === 'urgent'
            ? 'bg-danger-50 ring-2 ring-danger-500'
            : severity === 'watch'
              ? 'bg-warn-50 ring-2 ring-warn-500'
              : filled
                ? 'bg-brand-50 ring-1 ring-brand-200'
                : 'surface-card'

        const valueColour = outOfRange || severity === 'urgent'
          ? 'text-danger-700'
          : severity === 'watch'
            ? 'text-warn-700'
            : 'text-ink'

        return (
          <label
            key={key}
            className={cx('press flex flex-col gap-0.5 rounded-card px-3 py-2.5 transition-colors', tile)}
          >
            <span className="flex items-center gap-1.5 overflow-hidden">
              <Icon size={13} className={cx('shrink-0', filled ? 'text-brand-600' : 'text-ink-4')} />
              <span className="truncate text-[0.75rem] font-semibold text-ink-2">{vitalLabel(key, t)}</span>
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
                  'numeric w-full min-w-0 border-0 bg-transparent p-0 text-[1.375rem] leading-tight font-semibold tracking-[-0.02em]',
                  'focus:ring-0 focus:outline-none placeholder:font-normal placeholder:text-ink-4',
                  valueColour,
                )}
              />
              <span className="shrink-0 text-[0.6875rem] font-semibold text-ink-4">{range.unit}</span>
            </span>

            {/* Rendered only when it has something to say. An always-present
                empty row added 16px of dead space to all eight tiles, which is
                most of a phone screen spent on nothing. */}
            <span
              className={cx(
                'flex flex-wrap items-center gap-1',
                !prov && severity === 'normal' && !outOfRange && 'hidden',
              )}
            >
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
