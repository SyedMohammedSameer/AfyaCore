import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'
import { MoreVertical } from 'lucide-react'
import { avatarColour, initials as makeInitials } from '../lib/avatar'

/**
 * UI primitives.
 *
 * Hand-rolled rather than pulled from a component library: the app needs about
 * a dozen controls, and a component library would cost more bundle than the
 * entire application currently weighs. Every interactive element clears a 48px
 * touch target.
 */

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

// ---------------------------------------------------------------- Button ---

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'onDark'
type ButtonSize = 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: ReactNode
  full?: boolean
}

/*
 * A solid fill, a hairline, and nothing else.
 *
 * The primary button used a gradient and a lifted shadow, which reads as a
 * marketing call to action. Here the primary action is "save this
 * consultation", and a flat brand fill with a darker active state is both
 * calmer and easier to hit correctly on a screen with a cracked digitiser.
 */
const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary:
    'bg-brand-600 text-white shadow-xs hover:bg-brand-700 active:bg-brand-800 ' +
    'disabled:bg-line-strong disabled:text-white disabled:shadow-none',
  secondary:
    'bg-surface text-ink border border-line shadow-xs hover:bg-sunken active:bg-line/60 ' +
    'disabled:text-ink-4 disabled:shadow-none',
  ghost: 'bg-transparent text-ink-2 hover:bg-line/50 active:bg-line disabled:text-ink-4',
  danger:
    'bg-danger-600 text-white shadow-xs hover:bg-danger-700 active:bg-danger-700 disabled:bg-line-strong',
  onDark: 'bg-white/12 text-white ring-1 ring-white/25 hover:bg-white/20',
}

const BUTTON_SIZES: Record<ButtonSize, string> = {
  md: 'px-4 py-2.5 text-[0.9375rem] gap-2',
  lg: 'px-5 py-3.5 text-base gap-2.5',
}

export function Button({ variant = 'primary', size = 'md', icon, full, className, children, ...rest }: ButtonProps) {
  return (
    <button
      className={cx(
        'tap-safe press press-active inline-flex items-center justify-center rounded-field',
        'font-semibold tracking-[-0.006em] select-none',
        BUTTON_STYLES[variant],
        BUTTON_SIZES[size],
        full && 'w-full',
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  )
}

// ------------------------------------------------------------------ Card ---

/**
 * The default surface: opaque white, one hairline, a shadow you have to look
 * for. `plain` opts out of the border and fill entirely, for a card that brings
 * its own background — a tinted callout, or the dark instruction sheet.
 *
 * Kept as a variant rather than something a caller can override with a `bg-*`
 * class, because `surface-card` sets `background` and would silently win.
 */
export function Card({
  children,
  className,
  as: As = 'div',
  variant = 'default',
}: {
  children: ReactNode
  className?: string
  as?: 'div' | 'section' | 'li'
  variant?: 'default' | 'plain'
}) {
  return (
    <As className={cx(variant === 'default' && 'surface-card', 'rounded-card p-4', className)}>
      {children}
    </As>
  )
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2.5 flex items-baseline justify-between gap-3">
      {/* The dot went. A coloured marker on every section header spends
          semantic colour on decoration, which is exactly what makes a real
          warning stop registering. */}
      <h2 className="text-[0.6875rem] font-semibold tracking-[0.09em] text-ink-3 uppercase">
        {children}
      </h2>
      {action}
    </div>
  )
}

// ---------------------------------------------------------------- Fields ---

interface FieldProps {
  label: string
  hint?: string
  error?: string
  required?: boolean
  adornment?: ReactNode
  children: ReactNode
}

export function Field({ label, hint, error, required, adornment, children }: FieldProps) {
  return (
    <label className="block">
      <span className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[0.8125rem] font-semibold text-ink-2">
          {label}
          {required && <span className="ml-0.5 text-danger-600">*</span>}
        </span>
        {adornment}
      </span>
      {children}
      {error ? (
        <span className="mt-1.5 block text-[0.8125rem] font-medium text-danger-700">{error}</span>
      ) : hint ? (
        <span className="mt-1.5 block text-[0.8125rem] text-ink-3">{hint}</span>
      ) : null}
    </label>
  )
}

/*
 * White fill, hairline border, and a focus ring that is unmissable.
 *
 * The old control was translucent over a gradient, so its edge moved with
 * whatever sat behind it. A form field has to look like a slot you can put
 * something into, in daylight, at a glance.
 */
const CONTROL_BASE =
  'w-full rounded-field border border-line-strong bg-surface px-3.5 py-2.5 text-ink ' +
  'shadow-xs placeholder:text-ink-4 transition-[box-shadow,border-color] ' +
  'focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 focus:outline-none ' +
  'disabled:bg-sunken disabled:text-ink-3'

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(CONTROL_BASE, 'tap-safe', className)} {...rest} />
}

export function TextArea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(CONTROL_BASE, 'min-h-20 resize-y leading-relaxed', className)} {...rest} />
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(CONTROL_BASE, 'tap-safe appearance-none', className)} {...rest}>
      {children}
    </select>
  )
}

// ----------------------------------------------------------------- Badge ---

type Tone = 'neutral' | 'brand' | 'urgent' | 'watch' | 'ok' | 'accent'

const TONE_STYLES: Record<Tone, string> = {
  neutral: 'bg-sunken text-ink-2 ring-line',
  brand: 'bg-brand-50 text-brand-800 ring-brand-200',
  urgent: 'bg-danger-50 text-danger-700 ring-danger-200',
  watch: 'bg-warn-50 text-warn-700 ring-warn-200',
  ok: 'bg-ok-50 text-ok-700 ring-ok-200',
  accent: 'bg-info-50 text-info-700 ring-info-200',
}

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.75rem] font-semibold ring-1',
        TONE_STYLES[tone],
      )}
    >
      {children}
    </span>
  )
}

// ---------------------------------------------------------------- Avatar ---

export function Avatar({
  familyName,
  givenName,
  size = 'md',
}: {
  familyName: string
  givenName?: string
  size?: 'sm' | 'md' | 'lg'
}) {
  const { bg, fg } = avatarColour(`${familyName}${givenName ?? ''}`)
  const dims = size === 'lg' ? 'size-14 text-lg' : size === 'sm' ? 'size-9 text-xs' : 'size-11 text-sm'
  return (
    <span
      aria-hidden
      className={cx('grid shrink-0 place-items-center rounded-xl font-semibold', dims, bg, fg)}
    >
      {makeInitials(familyName, givenName)}
    </span>
  )
}

// -------------------------------------------------------------- StatTile ---

export function StatTile({
  label,
  value,
  tone = 'neutral',
  icon,
  onClick,
}: {
  label: string
  value: ReactNode
  tone?: Tone
  icon?: ReactNode
  onClick?: () => void
}) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      onClick={onClick}
      className={cx(
        'surface-card flex flex-col gap-1.5 rounded-card px-3.5 py-3 text-left',
        tone !== 'neutral' && TONE_STYLES[tone],
        onClick && 'press press-active hover:border-line-strong',
      )}
    >
      {/* Label above value, not below: the eye lands on the number and needs
          to already know what it is looking at. */}
      <span className="flex items-center gap-1.5 text-[0.6875rem] font-semibold tracking-[0.06em] text-ink-3 uppercase">
        {icon}
        <span className="truncate">{label}</span>
      </span>
      <span className="numeric text-[1.75rem] leading-none font-semibold tracking-[-0.03em] text-ink">
        {value}
      </span>
    </Tag>
  )
}

// -------------------------------------------------------------- Feedback ---

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon?: ReactNode
  title: string
  hint?: string
  action?: ReactNode
}) {
  return (
    <div className="surface-card animate-rise flex flex-col items-center gap-3 rounded-card px-6 py-14 text-center">
      {icon && (
        <span className="grid size-16 place-items-center rounded-3xl bg-brand-50 text-brand-600 ring-1 ring-brand-100">{icon}</span>
      )}
      <p className="text-base font-semibold text-ink">{title}</p>
      {hint && <p className="max-w-xs text-sm leading-relaxed text-ink-3">{hint}</p>}
      {action}
    </div>
  )
}

/** Skeletons rather than spinners: the layout does not jump when data lands. */
export function SkeletonRows({ count = 4 }: { count?: number }) {
  return (
    <ul className="flex flex-col gap-2" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="surface-card flex items-center gap-3 rounded-card p-3.5">
          <span className="skeleton size-12 rounded-2xl" />
          <span className="flex-1 space-y-2">
            <span className="skeleton block h-3.5 w-2/5 rounded-full" />
            <span className="skeleton block h-3 w-3/5 rounded-full" />
          </span>
        </li>
      ))}
    </ul>
  )
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-10 text-ink-3" role="status">
      <span className="size-5 animate-spin rounded-full border-2 border-line border-t-brand-600" />
      {label && <span className="text-sm">{label}</span>}
    </div>
  )
}

// ------------------------------------------------------------- ActionBar ---

/**
 * Sticky bottom action bar. Primary actions live here because the bottom of the
 * screen is the only region reliably reachable one-handed on a large phone.
 */
export function ActionBar({ children }: { children: ReactNode }) {
  return (
    // `mt-auto` inside the shell's flex column pins the bar to the bottom of the
    // viewport when the page is short; `sticky` keeps it there once it scrolls.
    // Without both, a short screen strands the bar halfway down with dead space
    // beneath it.
    <div className="sticky bottom-0 z-20 -mx-3 mt-auto border-t border-line bg-surface px-3 pt-3 pb-safe">
      <div className="mx-auto flex max-w-5xl gap-2.5">{children}</div>
    </div>
  )
}

// ------------------------------------------------------------- MoreMenu ---

export interface MenuItem {
  label: string
  icon?: ReactNode
  onSelect: () => void
  /** Renders in red. Use for anything that destroys a record. */
  danger?: boolean
}

/**
 * Overflow menu for actions that belong to the record on screen.
 *
 * Portalled to `document.body` rather than rendered where it sits. The app's
 * cards use `backdrop-filter`, which puts each one in its own composited
 * stacking context, and a menu nested inside the header then paints *through*
 * the cards below it no matter what z-index it is given. Escaping to the body
 * and positioning against the trigger's measured rect is the only placement
 * that is not at the mercy of an ancestor.
 *
 * A full-screen backdrop closes it, rather than a document click listener: on a
 * touch screen the first tap must dismiss the menu without also activating
 * whatever sits underneath, and a real element in the way is the only reliable
 * way to get that.
 */
export function MoreMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const trigger = useRef<HTMLButtonElement>(null)
  const [at, setAt] = useState<{ top: number; right: number } | null>(null)

  // Measured on open, and dropped on scroll or resize: a fixed menu cannot
  // follow its trigger, so the honest options are to reposition or to close,
  // and closing is what someone scrolling the page underneath expects anyway.
  useEffect(() => {
    if (!at) return
    const close = () => setAt(null)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [at])

  if (items.length === 0) return null

  function toggle() {
    if (at) return setAt(null)
    const rect = trigger.current?.getBoundingClientRect()
    if (rect) setAt({ top: rect.bottom + 6, right: window.innerWidth - rect.right })
  }

  return (
    <>
      <button
        ref={trigger}
        onClick={toggle}
        aria-label={label}
        aria-expanded={at !== null}
        aria-haspopup="menu"
        className="tap-safe press press-active grid shrink-0 place-items-center rounded-field text-ink-2 hover:bg-line/60"
      >
        <MoreVertical size={20} />
      </button>

      {at !== null &&
        createPortal(
          <>
            <button
              aria-hidden
              tabIndex={-1}
              onClick={() => setAt(null)}
              className="fixed inset-0 z-[60] cursor-default bg-transparent"
            />
            {/* Opaque, not `surface-card`. A translucent surface is fine for a
                panel sitting in the page flow, but a menu floats over arbitrary
                content and has to stay readable against whatever is under it. */}
            <div
              role="menu"
              style={{ top: at.top, right: at.right }}
              className="animate-rise fixed z-[61] flex w-60 flex-col gap-0.5 rounded-card bg-surface p-1.5 shadow-float ring-1 ring-line"
            >
              {items.map((item) => (
                <button
                  key={item.label}
                  role="menuitem"
                  onClick={() => {
                    setAt(null)
                    item.onSelect()
                  }}
                  className={cx(
                    'press press-active flex items-center gap-2.5 rounded-2xl px-3 py-3 text-left text-sm font-semibold',
                    item.danger
                      ? 'text-danger-700 hover:bg-danger-50'
                      : 'text-ink-2 hover:bg-sunken',
                  )}
                >
                  <span className="grid size-5 shrink-0 place-items-center">{item.icon}</span>
                  {item.label}
                </button>
              ))}
            </div>
          </>,
          document.body,
        )}
    </>
  )
}

/** Staggered list entrance. Capped so a long roster does not crawl in. */
export function riseStyle(index: number) {
  return { animationDelay: `${Math.min(index, 8) * 32}ms` }
}
