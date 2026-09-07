import { useEffect, useState } from 'react'
import { CheckCircle2, KeyRound, ShieldAlert, ShieldCheck, UserPlus, UserX } from 'lucide-react'
import { Button, Card, Field, Input, SectionTitle, Select, cx } from './ui'
import { useI18n } from '../i18n'
import { useSession } from '../lib/session'
import {
  activeClinicians,
  checkPinPolicy,
  disableClinician,
  setPin as setAccountPin,
  getIdleTimeoutMs,
  setIdleTimeoutMs,
} from '../lib/identity'
import { recordAudit, verifyAuditChain, recentAudit, type ChainVerification } from '../lib/audit'
import { formatDateTime } from '../lib/format'
import type { AuditEntry, Clinician, Role } from '../db/schema'
import { enrolClinician } from '../lib/unlock'
import { wrappedAccountIds } from '../lib/vault'

/**
 * Staff accounts, the automatic lock, and the audit trail.
 *
 * All three are administrator-only, and the gate is a render check rather than
 * a hidden menu item: a clinician who reaches this screen sees why they cannot
 * use it, which is more useful than a screen that silently lacks a section they
 * were told to look for.
 */
export function StaffPanel() {
  const { t } = useI18n()
  const { may } = useSession()

  if (!may('manage.staff')) {
    return (
      <section>
        <SectionTitle>{t.staff}</SectionTitle>
        <Card>
          <p className="flex items-center gap-2 text-sm text-ink-3">
            <ShieldAlert size={18} />
            {t.adminOnly}
          </p>
        </Card>
      </section>
    )
  }

  return (
    <>
      <StaffList />
      <IdleTimeoutSetting />
      <AuditPanel />
    </>
  )
}

function StaffList() {
  const { t, lang } = useI18n()
  const { clinician: me } = useSession()
  const [staff, setStaff] = useState<Clinician[]>([])
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [role, setRole] = useState<Role>('clinician')
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [keyHolders, setKeyHolders] = useState<Set<string>>(new Set())
  const [resetting, setResetting] = useState<string | null>(null)
  const [newPin, setNewPin] = useState('')

  /*
   * Which accounts can actually open the records.
   *
   * An account without a copy of the data key signs in and then reads nothing.
   * That state is invisible from the account list — the person appears fully
   * set up — and the only person who can fix it is somebody who already holds
   * the key. So it is shown here, where the fix is: setting their PIN passes
   * the key along.
   */
  const refresh = async () => {
    const [rows, keyed] = await Promise.all([activeClinicians(), wrappedAccountIds()])
    setStaff(rows)
    setKeyHolders(new Set(keyed))
  }
  useEffect(() => {
    void refresh()
  }, [])

  async function add() {
    setError(null)
    const policy = checkPinPolicy(pin)
    if (!policy.ok) return setError(t.pinPolicy[policy.reason!])
    if (!name.trim()) return setError(t.nameRequired)

    // `enrolClinician` rather than `createClinician`: an account without a
    // wrapped copy of the data key signs in and then cannot read a single
    // record. The two have to be created together.
    const id = await enrolClinician({ name, role, pin })
    await recordAudit({
      action: 'account.create',
      subjectType: 'account',
      subjectId: id,
      detail: role,
    })
    setName('')
    setPin('')
    setAdding(false)
    await refresh()
  }

  /**
   * Set somebody else's PIN.
   *
   * The recovery path for a forgotten PIN, and the only way an account that
   * has no copy of the data key ever gets one — `setPin` rewraps the key under
   * the new PIN, which it can do because the administrator doing it is signed
   * in and therefore holds it. There is deliberately no path that does this
   * without somebody who can already read the records being present.
   */
  async function resetPin(target: Clinician) {
    setError(null)
    const policy = checkPinPolicy(newPin)
    if (!policy.ok) return setError(t.pinPolicy[policy.reason!])

    await setAccountPin(target.id, newPin)
    await recordAudit({
      action: 'account.pin',
      subjectType: 'account',
      subjectId: target.id,
    })
    setNewPin('')
    setResetting(null)
    await refresh()
  }

  async function disable(target: Clinician) {
    if (!confirm(t.disableAccountConfirm)) return
    await disableClinician(target.id)
    await recordAudit({ action: 'account.disable', subjectType: 'account', subjectId: target.id })
    await refresh()
  }

  // The last administrator cannot be disabled: a facility that locks itself out
  // of its own settings has no way back in short of clearing the app's data,
  // which would take the records with it.
  const admins = staff.filter((c) => c.role === 'admin').length

  return (
    <section>
      <SectionTitle
        action={
          <Button variant="ghost" icon={<UserPlus size={18} />} onClick={() => setAdding((v) => !v)}>
            {t.addStaff}
          </Button>
        }
      >
        {t.staff}
      </SectionTitle>

      <Card className="flex flex-col gap-2">
        {staff.map((c) => {
          const lastAdmin = c.role === 'admin' && admins === 1
          return (
            <div key={c.id} className="rounded-field bg-white/50 p-2.5">
             <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-semibold text-ink">
                  {c.name}
                  {c.id === me?.id && <span className="ml-1.5 text-xs text-ink-4">({t.you})</span>}
                </p>
                <p className="text-xs text-ink-3">
                  {c.role === 'admin' ? t.roleAdmin : t.roleClinician}
                  {c.lastSignInAt && ` · ${formatDateTime(c.lastSignInAt, lang)}`}
                </p>
                {!keyHolders.has(c.id) && (
                  <p className="mt-1 flex items-start gap-1 text-xs font-medium text-warn-700">
                    <KeyRound size={13} className="mt-0.5 shrink-0" />
                    {t.staffNoKey}
                  </p>
                )}
              </div>
              <span className="flex shrink-0 items-center">
                <Button
                  variant="ghost"
                  icon={<KeyRound size={18} />}
                  onClick={() => {
                    setNewPin('')
                    setError(null)
                    setResetting((current) => (current === c.id ? null : c.id))
                  }}
                >
                  {/* Named with the account, because the submit button inside
                      the form this opens carries the same words. */}
                  <span className="sr-only">{t.setPinFor.replace('{name}', c.name)}</span>
                </Button>
                <Button
                  variant="ghost"
                  icon={<UserX size={18} />}
                  disabled={c.id === me?.id || lastAdmin}
                  title={lastAdmin ? t.lastAdmin : undefined}
                  onClick={() => disable(c)}
                >
                  <span className="sr-only">{t.disableAccount}</span>
                </Button>
              </span>
             </div>

              {resetting === c.id && (
                <div className="mt-2 flex flex-col gap-2 border-t border-line pt-2">
                  <Field label={t.setPinFor.replace('{name}', c.name)} hint={t.pinHint}>
                    <Input
                      type="password"
                      inputMode="numeric"
                      autoFocus
                      value={newPin}
                      onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
                    />
                  </Field>
                  {error && <p className="text-sm font-medium text-danger-700">{error}</p>}
                  <Button full onClick={() => resetPin(c)}>
                    {t.setPin}
                  </Button>
                </div>
              )}
            </div>
          )
        })}

        {adding && (
          <div className="flex flex-col gap-2 rounded-field bg-brand-50/60 p-3">
            <Field label={t.yourName}>
              <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </Field>
            <Field label={t.role}>
              <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
                <option value="clinician">{t.roleClinician}</option>
                <option value="admin">{t.roleAdmin}</option>
              </Select>
            </Field>
            <Field label={t.choosePin} hint={t.pinHint}>
              <Input
                type="password"
                inputMode="numeric"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              />
            </Field>
            {error && <p className="text-sm font-medium text-danger-700">{error}</p>}
            <Button full onClick={add}>
              {t.createAccount}
            </Button>
          </div>
        )}
      </Card>
    </section>
  )
}

/** Minutes, because "900000 ms" is not a number anyone should have to read. */
const TIMEOUT_CHOICES = [2, 5, 15, 30, 60]

function IdleTimeoutSetting() {
  const { t } = useI18n()
  const [minutes, setMinutes] = useState(15)

  useEffect(() => {
    getIdleTimeoutMs().then((ms) => setMinutes(Math.round(ms / 60_000)))
  }, [])

  async function change(next: number) {
    setMinutes(next)
    await setIdleTimeoutMs(next * 60_000)
  }

  return (
    <section>
      <SectionTitle>{t.idleTimeout}</SectionTitle>
      <Card>
        <Field label={t.idleTimeout} hint={t.idleTimeoutHint}>
          <Select value={minutes} onChange={(e) => change(Number(e.target.value))}>
            {TIMEOUT_CHOICES.map((m) => (
              <option key={m} value={m}>
                {m} min
              </option>
            ))}
          </Select>
        </Field>
      </Card>
    </section>
  )
}

function AuditPanel() {
  const { t, lang } = useI18n()
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [check, setCheck] = useState<ChainVerification | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    recentAudit(50).then(setEntries)
  }, [])

  async function verify() {
    setBusy(true)
    try {
      setCheck(await verifyAuditChain())
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <SectionTitle>{t.auditTrail}</SectionTitle>
      <Card className="flex flex-col gap-3">
        <Button variant="secondary" icon={<ShieldCheck size={18} />} onClick={verify} disabled={busy}>
          {t.auditVerify}
        </Button>

        {check && (
          <p
            className={cx(
              'flex items-start gap-2 rounded-field p-2.5 text-sm',
              check.ok ? 'bg-ok-50 text-ok-700' : 'bg-danger-50 text-danger-700',
            )}
          >
            {check.ok ? (
              <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
            ) : (
              <ShieldAlert size={18} className="mt-0.5 shrink-0" />
            )}
            <span>
              {check.ok ? (
                <>
                  <span className="font-semibold">{t.auditIntact}</span>
                  {` · ${check.entries} ${t.auditEntries}`}
                  {/* Said out loud once a trim has happened, because "verified"
                      would otherwise imply "back to the beginning". */}
                  {check.from > 1 && ` (${t.auditVerifiedFrom} ${check.from})`}
                </>
              ) : (
                <span className="font-semibold">
                  {t.auditBroken} {check.brokenAt} ({check.reason})
                </span>
              )}
            </span>
          </p>
        )}

        <ul className="flex flex-col gap-1 text-xs">
          {entries.map((e) => (
            <li key={e.id} className="flex gap-2 rounded bg-white/50 px-2 py-1.5">
              <span className="numeric shrink-0 tabular-nums text-ink-4">
                {formatDateTime(e.at, lang)}
              </span>
              <span className="font-medium text-ink-2">{e.action}</span>
              {e.detail && <span className="truncate text-ink-4">{e.detail}</span>}
            </li>
          ))}
        </ul>
      </Card>
    </section>
  )
}
