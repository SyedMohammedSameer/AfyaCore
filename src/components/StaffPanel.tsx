import { useEffect, useState } from 'react'
import { CheckCircle2, ShieldAlert, ShieldCheck, UserPlus, UserX } from 'lucide-react'
import { Button, Card, Field, Input, SectionTitle, Select, cx } from './ui'
import { useI18n } from '../i18n'
import { useSession } from '../lib/session'
import {
  activeClinicians,
  checkPinPolicy,
  createClinician,
  disableClinician,
  getIdleTimeoutMs,
  setIdleTimeoutMs,
} from '../lib/identity'
import { recordAudit, verifyAuditChain, recentAudit, type ChainVerification } from '../lib/audit'
import { formatDateTime } from '../lib/format'
import type { AuditEntry, Clinician, Role } from '../db/schema'

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
          <p className="flex items-center gap-2 text-sm text-slate-500">
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

  const refresh = () => activeClinicians().then(setStaff)
  useEffect(() => {
    void refresh()
  }, [])

  async function add() {
    setError(null)
    const policy = checkPinPolicy(pin)
    if (!policy.ok) return setError(t.pinPolicy[policy.reason!])
    if (!name.trim()) return setError(t.nameRequired)

    const id = await createClinician({ name, role, pin })
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
            <div
              key={c.id}
              className="flex items-center justify-between gap-2 rounded-field bg-white/50 p-2.5"
            >
              <div className="min-w-0">
                <p className="truncate font-semibold text-slate-800">
                  {c.name}
                  {c.id === me?.id && <span className="ml-1.5 text-xs text-slate-400">({t.you})</span>}
                </p>
                <p className="text-xs text-slate-500">
                  {c.role === 'admin' ? t.roleAdmin : t.roleClinician}
                  {c.lastSignInAt && ` · ${formatDateTime(c.lastSignInAt, lang)}`}
                </p>
              </div>
              <Button
                variant="ghost"
                icon={<UserX size={18} />}
                disabled={c.id === me?.id || lastAdmin}
                title={lastAdmin ? t.lastAdmin : undefined}
                onClick={() => disable(c)}
              >
                <span className="sr-only">{t.disableAccount}</span>
              </Button>
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
              <span className="numeric shrink-0 tabular-nums text-slate-400">
                {formatDateTime(e.at, lang)}
              </span>
              <span className="font-medium text-slate-700">{e.action}</span>
              {e.detail && <span className="truncate text-slate-400">{e.detail}</span>}
            </li>
          ))}
        </ul>
      </Card>
    </section>
  )
}
