import { Eye, EyeOff, ShieldCheck } from 'lucide-react'
import { Card, SectionTitle, cx } from './ui'
import { useI18n } from '../i18n'
import type { DeidentLevel } from '../lib/deidentify'

interface PrivacySelectorProps {
  value: DeidentLevel
  onChange: (level: DeidentLevel) => void
}

/**
 * Export privacy level.
 *
 * Deliberately a set of explicit radio choices with their consequences spelled
 * out, rather than a checkbox labelled "anonymise". The person exporting is
 * usually not the person who will hold the file afterwards, and the difference
 * between "a code that follows this patient across exports" and "no link at
 * all" is the whole decision, it should not be buried in a tooltip.
 *
 * `pseudonymous` is the default rather than `identified`: the common export is
 * a monthly report, which never needs a name.
 */
export function PrivacySelector({ value, onChange }: PrivacySelectorProps) {
  const { t } = useI18n()

  const OPTIONS: { key: DeidentLevel; icon: typeof Eye; label: string; hint: string; tone: string }[] = [
    {
      key: 'identified',
      icon: Eye,
      label: t.levelIdentified,
      hint: t.levelIdentifiedHint,
      tone: 'text-warn-700',
    },
    {
      key: 'pseudonymous',
      icon: ShieldCheck,
      label: t.levelPseudonymous,
      hint: t.levelPseudonymousHint,
      tone: 'text-brand-700',
    },
    {
      key: 'anonymous',
      icon: EyeOff,
      label: t.levelAnonymous,
      hint: t.levelAnonymousHint,
      tone: 'text-brand-700',
    },
  ]

  return (
    <section>
      <SectionTitle>{t.privacy}</SectionTitle>
      <Card className="flex flex-col gap-2">
        <p className="text-sm text-ink-2">{t.privacyHint}</p>

        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">{t.privacy}</legend>
          {OPTIONS.map(({ key, icon: Icon, label, hint, tone }) => {
            const selected = value === key
            return (
              <label
                key={key}
                className={cx(
                  'press flex cursor-pointer gap-3 rounded-field p-3 ring-1 transition-colors',
                  selected ? 'bg-brand-50 ring-2 ring-brand-500' : 'bg-white ring-line',
                )}
              >
                <input
                  type="radio"
                  name="deident-level"
                  value={key}
                  checked={selected}
                  onChange={() => onChange(key)}
                  className="sr-only"
                />
                <Icon size={20} className={cx('mt-0.5 shrink-0', selected ? tone : 'text-ink-4')} />
                <span className="min-w-0">
                  <span className="block font-bold text-ink">{label}</span>
                  <span className="mt-0.5 block text-sm leading-snug text-ink-2">{hint}</span>
                </span>
              </label>
            )
          })}
        </fieldset>

        {value !== 'identified' && (
          <p className="rounded-field bg-sunken p-2.5 text-xs leading-relaxed text-ink-3">
            {t.attachmentsExcluded}
          </p>
        )}
      </Card>
    </section>
  )
}
