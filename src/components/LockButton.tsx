import { Lock } from 'lucide-react'
import { cx } from './ui'
import { useI18n } from '../i18n'
import { useSession } from '../lib/session'

/**
 * Hand the phone back to the lock screen.
 *
 * Shows the signed-in initial rather than a generic icon, because the mistake
 * this prevents is not "forgetting to lock" but "not noticing you are recording
 * a consultation under a colleague's name". Seeing whose session is open is the
 * part that actually keeps the audit trail honest.
 */
export function LockButton({ onDark = false }: { onDark?: boolean }) {
  const { t } = useI18n()
  const { clinician, signOut } = useSession()
  if (!clinician) return null

  const initial = clinician.name.trim().charAt(0).toUpperCase() || '?'

  return (
    <button
      onClick={() => void signOut('manual')}
      title={`${clinician.name} — ${t.signOut}`}
      aria-label={`${clinician.name}, ${t.signOut}`}
      className={cx(
        'tap-safe press press-active inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5',
        'text-sm font-semibold ring-1 transition-colors',
        onDark
          ? 'bg-white/13 text-white ring-white/25 hover:bg-white/20'
          : 'bg-sunken/85 text-ink-2 ring-line/80 hover:bg-line/80',
      )}
    >
      <span
        className={cx(
          'flex size-5 items-center justify-center rounded-full text-[11px] font-bold',
          onDark ? 'bg-white/20' : 'bg-brand-600 text-white',
        )}
      >
        {initial}
      </span>
      <Lock size={14} />
    </button>
  )
}
