import { useEffect, useState } from 'react'
import { Delete, Lock, ShieldPlus, UserRound } from 'lucide-react'
import { Button, Card, Field, Input, Select, cx } from './ui'
import { LanguageMenu } from './LanguageMenu'
import { useI18n } from '../i18n'
import { useSession } from '../lib/session'
import {
  activeClinicians,
  checkPinPolicy,
  createClinician,
  lockoutState,
  needsFirstAccount,
  signIn as attemptSignIn,
  type LockoutState,
} from '../lib/identity'
import { recordAudit } from '../lib/audit'
import { db } from '../db/db'
import type { Clinician } from '../db/schema'

/**
 * The gate in front of the whole app.
 *
 * Two states, because a facility's very first phone has nobody to sign in as:
 * first-run creates the facility administrator, and everything after that is a
 * PIN entry. There is no way past either one, which is the point: an audit
 * trail that says "someone at this facility" is not an audit trail.
 *
 * A numeric keypad rather than the system keyboard. Staff enter this many times
 * a day on a phone they may be holding in one hand with gloves on, and a
 * 48px-target keypad is both faster and far more reliable than a text field
 * that may open a predictive keyboard over the top of it.
 */
export function LockScreen() {
  const { t } = useI18n()
  const [firstRun, setFirstRun] = useState<boolean | null>(null)

  useEffect(() => {
    needsFirstAccount().then(setFirstRun)
  }, [])

  if (firstRun === null) return null

  return (
    <div data-lock className="min-h-dvh bg-brand-gradient px-4 py-8">
      <div className="mx-auto flex min-h-[80dvh] max-w-sm flex-col justify-center gap-5">
        <div className="text-center text-white">
          <div className="mx-auto mb-3 flex size-14 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25">
            {firstRun ? <ShieldPlus size={28} /> : <Lock size={26} />}
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{t.appName}</h1>
          <p className="mt-1 text-sm text-white/75">
            {firstRun ? t.firstRunSubtitle : t.lockSubtitle}
          </p>
        </div>

        {firstRun ? (
          <FirstAccountForm onCreated={() => setFirstRun(false)} />
        ) : (
          <SignInForm />
        )}

        <div className="flex justify-center">
          <LanguageMenu onDark />
        </div>
      </div>
    </div>
  )
}

/**
 * First run: create the facility administrator.
 *
 * Forced to `admin`, with no role picker. The first account has to be able to
 * enrol the device and add colleagues, and offering a choice here only creates
 * the state where a facility has locked itself out of its own settings.
 */
function FirstAccountForm({ onCreated }: { onCreated: () => void }) {
  const { t } = useI18n()
  const { signIn } = useSession()
  const [name, setName] = useState('')
  const [pin, setPin] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function create() {
    setError(null)
    const policy = checkPinPolicy(pin)
    if (!policy.ok) return setError(t.pinPolicy[policy.reason!])
    if (pin !== confirm) return setError(t.pinMismatch)
    if (!name.trim()) return setError(t.nameRequired)

    setBusy(true)
    try {
      const id = await createClinician({ name, role: 'admin', pin })
      await recordAudit({
        actorId: id,
        action: 'account.create',
        subjectType: 'account',
        subjectId: id,
        detail: 'admin (first run)',
      })
      const clinician = await db.clinicians.get(id)
      if (clinician) await signIn(clinician)
      onCreated()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <p className="text-sm text-slate-600">{t.firstRunHint}</p>

      <Field label={t.yourName}>
        <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </Field>

      <Field label={t.choosePin} hint={t.pinHint}>
        <Input
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
        />
      </Field>

      <Field label={t.confirmPin}>
        <Input
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ''))}
        />
      </Field>

      {error && (
        <p className="rounded-field bg-danger-50 p-2.5 text-sm font-medium text-danger-700">
          {error}
        </p>
      )}

      <Button full onClick={create} disabled={busy}>
        {t.createAccount}
      </Button>
    </Card>
  )
}

function SignInForm() {
  const { t } = useI18n()
  const { signIn } = useSession()
  const [staff, setStaff] = useState<Clinician[]>([])
  const [selected, setSelected] = useState('')
  const [pin, setPin] = useState('')
  const [lockout, setLockout] = useState<LockoutState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    activeClinicians().then((rows) => {
      setStaff(rows)
      setSelected((current) => current || (rows[0]?.id ?? ''))
    })
    lockoutState().then(setLockout)
  }, [])

  // The countdown has to move on its own, or a locked-out user sees a frozen
  // number and assumes the app has hung.
  useEffect(() => {
    if (!lockout?.lockedUntil) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [lockout?.lockedUntil])

  const lockedFor = lockout?.lockedUntil ? Math.max(0, lockout.lockedUntil - now) : 0
  const locked = lockedFor > 0

  async function submit() {
    if (!selected || pin.length < 4 || locked) return
    setBusy(true)
    setError(null)
    try {
      const result = await attemptSignIn(selected, pin)
      setLockout(result.lockout)
      if (result.ok && result.clinician) {
        await signIn(result.clinician)
        return
      }
      setPin('')
      // Logged with the account that was *attempted*, which is what makes a
      // pattern of failures against one person's account visible at all.
      await recordAudit({
        actorId: selected,
        action: 'signin.failed',
        subjectType: 'account',
        subjectId: selected,
      })
      setError(
        result.lockout.lockedUntil
          ? t.pinLockedOut
          : `${t.pinWrong} ${result.lockout.attemptsRemaining} ${t.attemptsRemaining}`,
      )
    } finally {
      setBusy(false)
    }
  }

  const press = (digit: string) => setPin((p) => (p.length >= 12 ? p : p + digit))

  return (
    <Card className="flex flex-col gap-3">
      {staff.length > 1 && (
        <Field label={t.signInAs}>
          <Select value={selected} onChange={(e) => setSelected(e.target.value)}>
            {staff.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
      )}

      {staff.length === 1 && (
        <p className="flex items-center justify-center gap-2 text-base font-semibold text-slate-700">
          <UserRound size={18} />
          {staff[0]!.name}
        </p>
      )}

      {/* Dots rather than the digits: this is entered in a room with a queue in
          it, and a PIN readable over a shoulder is not one. */}
      <div className="flex justify-center gap-2.5 py-2" aria-label={t.pin}>
        {Array.from({ length: Math.max(4, pin.length) }, (_, i) => (
          <span
            key={i}
            className={cx(
              'size-3.5 rounded-full transition-colors',
              i < pin.length ? 'bg-brand-600' : 'bg-slate-200',
            )}
          />
        ))}
      </div>

      {locked ? (
        <p className="rounded-field bg-danger-50 p-3 text-center text-sm font-medium text-danger-700">
          {t.pinLockedOut} {Math.ceil(lockedFor / 1000)}s
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
              <Keypad key={d} onClick={() => press(d)}>
                {d}
              </Keypad>
            ))}
            <Keypad onClick={() => setPin('')} aria-label={t.clear}>
              ✕
            </Keypad>
            <Keypad onClick={() => press('0')}>0</Keypad>
            <Keypad onClick={() => setPin((p) => p.slice(0, -1))} aria-label={t.backspace}>
              <Delete size={20} />
            </Keypad>
          </div>

          {error && (
            <p className="rounded-field bg-danger-50 p-2.5 text-center text-sm font-medium text-danger-700">
              {error}
            </p>
          )}

          <Button full onClick={submit} disabled={busy || pin.length < 4 || !selected}>
            {t.unlock}
          </Button>
        </>
      )}
    </Card>
  )
}

function Keypad({
  children,
  ...rest
}: { children: React.ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className="tap-safe press press-active flex h-14 items-center justify-center rounded-field bg-white/70 text-xl font-semibold text-slate-800 ring-1 ring-slate-200/70 hover:bg-white active:bg-slate-50"
      {...rest}
    >
      {children}
    </button>
  )
}
