import { useEffect, useState } from 'react'
import { CloudUpload, KeyRound, RefreshCw, ShieldCheck, Unlink } from 'lucide-react'
import { Button, Card, Field, Input, SectionTitle, cx } from './ui'
import { useOnline } from './AppShell'
import {
  enrolDevice,
  getLastResult,
  getSyncSettings,
  isEnrolled,
  runSync,
  setSyncSettings,
  unenrolDevice,
  type SyncOutcome,
  type SyncSettings,
} from '../lib/sync'
import { formatDateTime } from '../lib/format'
import { useI18n } from '../i18n'

const BLANK: SyncSettings = { serverUrl: '', facilityId: '', token: '', deviceId: '' }

/**
 * Sync configuration, device enrolment and manual trigger.
 *
 * The manual button matters more than it looks. Auto-sync fires on regaining
 * connectivity, but staff often know something the device does not: that they
 * are about to walk out of coverage for a day. Giving them an explicit "do it
 * now" is the difference between trusting the app and not.
 *
 * Enrolment replaced a typed facility id. Typing one was the entire access
 * control story, which meant there was none; now a phone is joined to a
 * facility once, with a code an administrator reads out, and the facility it
 * belongs to is a fact about its token rather than a claim it makes.
 */
export function SyncPanel() {
  const { t, lang } = useI18n()
  const online = useOnline()
  const [settings, setSettings] = useState<SyncSettings>(BLANK)
  const [serverUrl, setServerUrl] = useState('')
  const [code, setCode] = useState('')
  const [deviceName, setDeviceName] = useState('')
  const [busy, setBusy] = useState(false)
  const [enrolError, setEnrolError] = useState<string | null>(null)
  const [result, setResult] = useState<SyncOutcome | null>(null)

  async function refresh() {
    const next = await getSyncSettings()
    setSettings(next)
    setServerUrl(next.serverUrl)
  }

  useEffect(() => {
    void refresh()
    getLastResult().then(setResult)
  }, [])

  const enrolled = isEnrolled(settings)

  async function enrol() {
    setBusy(true)
    setEnrolError(null)
    try {
      await setSyncSettings({ serverUrl })
      const outcome = await enrolDevice(
        code,
        // A recognisable label is what makes `device:revoke` usable: an
        // administrator revoking a lost phone has to be able to tell which row
        // is the lost phone.
        deviceName.trim() || 'Unnamed device',
      )
      if (outcome.ok) {
        setCode('')
        await refresh()
      } else {
        setEnrolError(outcome.error ?? 'network')
      }
    } finally {
      setBusy(false)
    }
  }

  async function syncNow() {
    setBusy(true)
    try {
      setResult(await runSync())
    } finally {
      setBusy(false)
    }
  }

  async function unenrol() {
    if (!confirm(t.unenrolConfirm)) return
    await unenrolDevice()
    setResult(null)
    await refresh()
  }

  return (
    <section>
      <SectionTitle>{t.sync}</SectionTitle>
      <Card className="flex flex-col gap-3">
        <p className="text-sm text-ink-2">{t.syncHint}</p>

        <Field label={t.serverUrl}>
          <Input
            type="url"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="https://sync.example.org"
            value={serverUrl}
            disabled={enrolled}
            onChange={(e) => setServerUrl(e.target.value)}
            onBlur={() => setSyncSettings({ serverUrl })}
          />
        </Field>

        {enrolled ? (
          <>
            <div className="flex items-start gap-2 rounded-field bg-ok-50 p-2.5 text-sm text-ok-700">
              <ShieldCheck size={18} className="mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold">{t.deviceEnrolled}</p>
                <p className="mt-0.5 break-all opacity-80">
                  {settings.facilityId} · {settings.deviceId}
                </p>
              </div>
            </div>

            <Button
              full
              icon={
                busy ? <RefreshCw size={20} className="animate-spin" /> : <CloudUpload size={20} />
              }
              onClick={syncNow}
              disabled={busy || !online}
            >
              {busy ? t.syncing : t.syncNow}
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm text-ink-2">{t.enrolHint}</p>

            <Field label={t.enrolCode}>
              <Input
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                placeholder="ABCD-2345"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </Field>

            <Field label={t.deviceName}>
              <Input
                placeholder={t.deviceNamePlaceholder}
                value={deviceName}
                onChange={(e) => setDeviceName(e.target.value)}
              />
            </Field>

            <Button
              full
              icon={busy ? <RefreshCw size={20} className="animate-spin" /> : <KeyRound size={20} />}
              onClick={enrol}
              disabled={busy || !online || !serverUrl.trim() || !code.trim()}
            >
              {busy ? t.enrolling : t.enrolDevice}
            </Button>

            {enrolError && (
              <p className="rounded-field bg-danger-50 p-2.5 text-sm font-medium text-danger-700">
                {enrolError === 'invalid_code'
                  ? t.enrolInvalidCode
                  : enrolError === 'rate_limited'
                    ? t.enrolRateLimited
                    : `${t.enrolFailed}: ${enrolError}`}
              </p>
            )}

            {!serverUrl.trim() && <p className="text-sm text-ink-3">{t.syncNotConfigured}</p>}
          </>
        )}

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
                {/* A revoked token is not a network problem, and telling staff
                    to check their signal would send them chasing the wrong
                    thing entirely. */}
                {result.error === 'unauthorised' ? t.syncUnauthorised : `${t.syncFailed}: ${result.error}`}
              </p>
            )}
          </div>
        )}

        {!result && enrolled && <p className="text-sm text-ink-4">{t.syncNever}</p>}

        {enrolled && (
          <Button variant="ghost" icon={<Unlink size={18} />} onClick={unenrol}>
            {t.unenrol}
          </Button>
        )}
      </Card>
    </section>
  )
}
