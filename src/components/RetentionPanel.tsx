import { useEffect, useState } from 'react'
import { Trash2, TriangleAlert } from 'lucide-react'
import { Button, Card, Field, SectionTitle, Select } from './ui'
import { useI18n } from '../i18n'
import { useSession } from '../lib/session'
import {
  getRetentionYears,
  purgeExpired,
  retentionStatus,
  setRetentionYears,
  type RetentionStatus,
} from '../lib/retention'

/**
 * How long this facility keeps records, and destroying what is past it.
 *
 * Administrator-only, and deliberately manual. A destructive operation on a
 * timer, on a device that may be showing the wrong date, in a facility whose
 * retention period nobody has confirmed with counsel, is a way to lose a year
 * of consultations at 3am rather than a feature.
 *
 * The count is always shown before the button does anything. An administrator
 * confirming "destroy 1,284 consultations" is making a decision; one
 * confirming "run retention purge" is agreeing to a phrase.
 */
export function RetentionPanel() {
  const { t } = useI18n()
  const { may } = useSession()
  const [status, setStatus] = useState<RetentionStatus | null>(null)
  const [years, setYears] = useState<string>('')
  const [confirming, setConfirming] = useState(false)
  const [done, setDone] = useState<string>('')

  async function refresh() {
    setStatus(await retentionStatus())
    const current = await getRetentionYears()
    setYears(current.years === null ? '' : String(current.years))
  }

  useEffect(() => {
    refresh()
  }, [])

  const editable = may('manage.device')

  async function save(value: string) {
    setYears(value)
    await setRetentionYears(value === '' ? null : Number(value))
    setConfirming(false)
    await refresh()
  }

  async function purge() {
    const result = await purgeExpired()
    setDone(`${result.encounters} · ${result.patients}`)
    setConfirming(false)
    await refresh()
  }

  return (
    <section>
      <SectionTitle>{t.retention}</SectionTitle>
      <Card className="flex flex-col gap-3">
        <p className="text-sm text-ink-2">{t.retentionHint}</p>

        <Field label={t.retentionYears}>
          <Select value={years} disabled={!editable} onChange={(e) => save(e.target.value)}>
            {/* Empty is the default and means "nobody has established one",
                which is the honest state for most of the nine countries. With
                no period set nothing is ever eligible. */}
            <option value="">{t.unconfirmed}</option>
            {[3, 5, 7, 10, 15, 20, 25].map((y) => (
              <option key={y} value={y}>
                {y} {t.years}
              </option>
            ))}
          </Select>
        </Field>

        {status?.years === null && <p className="text-sm text-ink-3">{t.retentionUnset}</p>}

        {status && status.years !== null && (
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 rounded-field bg-sunken p-3 text-sm">
            <dt className="text-ink-3">{t.retentionEligible}</dt>
            <dd className="numeric font-semibold text-ink">{status.eligible}</dd>
            {status.blockedUnsynced > 0 && (
              <>
                {/* Reported separately because it is a backup problem, not a
                    retention one: these records exist on exactly one device. */}
                <dt className="text-warn-700">{t.retentionBlocked}</dt>
                <dd className="numeric font-semibold text-warn-700">{status.blockedUnsynced}</dd>
              </>
            )}
          </dl>
        )}

        {editable && status && status.eligible > 0 && !confirming && (
          <Button variant="danger" full icon={<Trash2 size={18} />} onClick={() => setConfirming(true)}>
            {t.retentionPurge}
          </Button>
        )}

        {confirming && status && (
          <div className="flex flex-col gap-2 rounded-field bg-danger-50 p-3">
            <p className="flex items-start gap-2 text-sm leading-relaxed text-danger-700">
              <TriangleAlert size={16} className="mt-0.5 shrink-0" />
              {t.retentionConfirm.replace('{n}', String(status.eligible))}
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" full onClick={() => setConfirming(false)}>
                {t.cancel}
              </Button>
              <Button variant="danger" full onClick={purge}>
                {t.delete}
              </Button>
            </div>
          </div>
        )}

        {done && <p className="text-sm text-ink-2">{t.retentionDone.replace('{n}', done.split(' · ')[0]!)}</p>}
        {!editable && <p className="text-sm text-ink-3">{t.adminOnly}</p>}

        {/* The device cannot purge the facility's server and must not pretend
            it has. Stated here rather than in a document nobody opens. */}
        <p className="text-xs leading-relaxed text-ink-4">{t.retentionServerNote}</p>
      </Card>
    </section>
  )
}
