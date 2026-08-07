import { useEffect, useState } from 'react'
import { AlertTriangle, CloudUpload, RefreshCw } from 'lucide-react'
import { Button, Card, Field, Input, SectionTitle, cx } from './ui'
import { useOnline } from './AppShell'
import {
  getLastResult,
  getSyncSettings,
  runSync,
  setSyncSettings,
  type SyncOutcome,
} from '../lib/sync'
import { formatDateTime } from '../lib/format'
import { useI18n } from '../i18n'

/**
 * Sync configuration and manual trigger.
 *
 * The manual button matters more than it looks. Auto-sync fires on regaining
 * connectivity, but staff often know something the device does not: that they
 * are about to walk out of coverage for a day. Giving them an explicit "do it
 * now" is the difference between trusting the app and not.
 */
export function SyncPanel() {
  const { t, lang } = useI18n()
  const online = useOnline()
  const [serverUrl, setServerUrl] = useState('')
  const [facilityId, setFacilityId] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<SyncOutcome | null>(null)

  useEffect(() => {
    getSyncSettings().then((s) => {
      setServerUrl(s.serverUrl)
      setFacilityId(s.facilityId)
    })
    getLastResult().then(setResult)
  }, [])

  async function persist(next: { serverUrl?: string; facilityId?: string }) {
    await setSyncSettings(next)
  }

  async function syncNow() {
    setBusy(true)
    try {
      await persist({ serverUrl, facilityId })
      setResult(await runSync())
    } finally {
      setBusy(false)
    }
  }

  const configured = serverUrl.trim() !== '' && facilityId.trim() !== ''

  return (
    <section>
      <SectionTitle>{t.sync}</SectionTitle>
      <Card className="flex flex-col gap-3">
        <p className="text-sm text-slate-600">{t.syncHint}</p>

        <Field label={t.serverUrl}>
          <Input
            type="url"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="https://sync.example.org"
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            onBlur={() => persist({ serverUrl })}
          />
        </Field>

        <Field label={t.facilityId}>
          <Input
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="csb2-ambohimanga"
            value={facilityId}
            onChange={(e) => setFacilityId(e.target.value)}
            onBlur={() => persist({ facilityId })}
          />
        </Field>

        <Button
          full
          icon={busy ? <RefreshCw size={20} className="animate-spin" /> : <CloudUpload size={20} />}
          onClick={syncNow}
          disabled={busy || !configured || !online}
        >
          {busy ? t.syncing : t.syncNow}
        </Button>

        {!configured && <p className="text-sm text-slate-500">{t.syncNotConfigured}</p>}

        {result && (
          <div
            className={cx(
              'rounded-field p-2.5 text-sm',
              result.ok ? 'bg-ok-50 text-ok-700' : 'bg-danger-50 text-danger-700',
            )}
          >
            {result.ok ? (
              <>
                <p className="numeric font-semibold">
                  {result.pushed} / {result.pulled} {t.syncSummary}
                </p>
                <p className="mt-0.5 opacity-80">
                  {t.lastSync}: {formatDateTime(result.finishedAt, lang)}
                </p>
                {/* Surfaced rather than hidden: a refused record means a local
                    draft was protected from being overwritten, and the person
                    holding the phone is the only one who can resolve it. */}
                {result.refused > 0 && (
                  <p className="mt-1 font-medium">
                    {result.refused} × {t.draft}
                  </p>
                )}
              </>
            ) : (
              <p className="font-semibold">
                {t.syncFailed}: {result.error}
              </p>
            )}
          </div>
        )}

        {!result && <p className="text-sm text-slate-400">{t.syncNever}</p>}

        <p className="flex items-start gap-2 rounded-field bg-warn-50 p-2.5 text-xs leading-relaxed text-warn-700">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          {t.syncNoAuthWarning}
        </p>
      </Card>
    </section>
  )
}
