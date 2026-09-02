import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { Clinician, Role } from '../db/schema'
import { recordAudit, setCurrentActor } from './audit'
import { can, getIdleTimeoutMs, type Permission } from './identity'

/**
 * Who is signed in on this device, and for how much longer.
 *
 * The session is kept in memory only. Persisting it would mean a phone picked
 * up off a desk is already signed in as whoever used it last, which is the
 * exact situation the lock exists to prevent, and it would attribute their
 * actions to that person in the audit trail.
 *
 * Timing out is not a security theatre detail here. A consultation room phone
 * gets put down mid-task constantly, and the audit trail is only meaningful if
 * the name on it is the person who was actually holding the device.
 */
export interface SessionState {
  clinician: Clinician | null
  role: Role | undefined
  /** True once the app has finished working out whether anyone is signed in. */
  ready: boolean
  signIn: (clinician: Clinician) => Promise<void>
  signOut: (reason?: 'manual' | 'timeout') => Promise<void>
  /** Permission check for the signed-in account. */
  may: (permission: Permission) => boolean
}

const SessionContext = createContext<SessionState | null>(null)

/**
 * Events that count as "somebody is still using this".
 *
 * Deliberately not `mousemove`: a phone in a pocket generates spurious motion
 * events, and a timeout that never fires is the same as no timeout.
 */
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'visibilitychange'] as const

export function SessionProvider({ children }: { children: ReactNode }) {
  const [clinician, setClinician] = useState<Clinician | null>(null)
  const [ready, setReady] = useState(false)
  const [idleTimeoutMs, setIdleTimeout] = useState<number | null>(null)
  const lastActivity = useRef(Date.now())

  useEffect(() => {
    getIdleTimeoutMs().then((ms) => {
      setIdleTimeout(ms)
      setReady(true)
    })
  }, [])

  const signIn = useCallback(async (next: Clinician) => {
    lastActivity.current = Date.now()
    setClinician(next)
    // Set before the audit call, so every write from here on is attributed
    // without any repository call site having to know about it.
    setCurrentActor(next.id)
    await recordAudit({
      actorId: next.id,
      action: 'signin',
      subjectType: 'account',
      subjectId: next.id,
    })
  }, [])

  const signOut = useCallback(
    async (reason: 'manual' | 'timeout' = 'manual') => {
      const current = clinician
      setClinician(null)
      setCurrentActor(undefined)
      if (current) {
        await recordAudit({
          actorId: current.id,
          action: 'signout',
          subjectType: 'account',
          subjectId: current.id,
          detail: reason,
        })
      }
    },
    [clinician],
  )

  /**
   * Idle timeout.
   *
   * A single interval rather than a timer reset on every keystroke: resetting a
   * timeout on each event is a lot of work on a slow phone for a check that is
   * fine to be a few seconds late.
   */
  useEffect(() => {
    if (!clinician || !idleTimeoutMs) return

    const touch = () => {
      // Returning to a backgrounded tab is not activity. Counting it would
      // reset the clock exactly when the phone was left unattended.
      if (document.visibilityState === 'visible') lastActivity.current = Date.now()
    }
    for (const event of ACTIVITY_EVENTS) window.addEventListener(event, touch, { passive: true })

    const interval = setInterval(() => {
      if (Date.now() - lastActivity.current >= idleTimeoutMs) void signOut('timeout')
    }, 15_000)

    return () => {
      for (const event of ACTIVITY_EVENTS) window.removeEventListener(event, touch)
      clearInterval(interval)
    }
  }, [clinician, idleTimeoutMs, signOut])

  const value = useMemo<SessionState>(
    () => ({
      clinician,
      role: clinician?.role,
      ready,
      signIn,
      signOut,
      may: (permission) => can(clinician?.role, permission),
    }),
    [clinician, ready, signIn, signOut],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionState {
  const context = useContext(SessionContext)
  if (!context) throw new Error('useSession must be used inside a SessionProvider')
  return context
}

/**
 * The signed-in account's id, for attributing a write in the audit trail.
 *
 * Returns undefined rather than throwing outside a session, because the audit
 * helpers accept an optional actor and an unattributed entry is better than a
 * crash in the middle of saving a consultation.
 */
export function useActorId(): string | undefined {
  return useContext(SessionContext)?.clinician?.id
}
