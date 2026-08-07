import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'
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

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary:
    'bg-brand-gradient text-white shadow-lift ring-1 ring-white/20 hover:shadow-float active:brightness-95 disabled:bg-slate-300 disabled:shadow-none',
  secondary:
    'glass-subtle text-slate-800 hover:bg-white/80 hover:shadow-lift disabled:text-slate-400 disabled:shadow-none',
  ghost: 'bg-transparent text-slate-600 hover:bg-white/55 active:bg-white/75 disabled:text-slate-400',
  danger: 'bg-danger-600 text-white shadow-lift ring-1 ring-white/20 hover:bg-danger-700 disabled:bg-slate-300',
  onDark: 'bg-white/13 text-white ring-1 ring-white/28 hover:bg-white/21 backdrop-blur-md',
}

const BUTTON_SIZES: Record<ButtonSize, string> = {
  md: 'px-4 py-3 text-base gap-2',
  lg: 'px-5 py-4 text-lg gap-2.5',
}

export function Button({ variant = 'primary', size = 'md', icon, full, className, children, ...rest }: ButtonProps) {
  return (
    <button
      className={cx(
        'tap-safe press press-active inline-flex items-center justify-center rounded-field',
        'font-semibold tracking-[-0.01em] select-none',
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

export function Card({
  children,
  className,
  as: As = 'div',
}: {
  children: ReactNode
  className?: string
  as?: 'div' | 'section' | 'li'
}) {
  return (
    <As className={cx('glass-panel rounded-card p-4', className)}>
      {children}
    </As>
  )
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2.5 flex items-center justify-between gap-2">
      <h2 className="flex items-center gap-2 text-[0.7rem] font-extrabold tracking-[0.14em] text-slate-500 uppercase">
        <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
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
        <span className="text-sm font-semibold text-slate-700">
          {label}
          {required && <span className="ml-0.5 text-danger-600">*</span>}
        </span>
        {adornment}
      </span>
      {children}
      {error ? (
        <span className="mt-1.5 block text-sm font-medium text-danger-600">{error}</span>
      ) : hint ? (
        <span className="mt-1.5 block text-sm text-slate-500">{hint}</span>
      ) : null}
    </label>
  )
}

const CONTROL_BASE =
  'w-full rounded-field border border-white/75 bg-white/65 px-3.5 py-3 text-slate-900 ' +
  'shadow-[inset_0_1px_0_rgb(255_255_255_/_0.82),0_6px_18px_rgb(15_23_42_/_0.04)] ' +
  'placeholder:text-slate-400 transition-[box-shadow,border-color,background-color] focus:border-brand-300 focus:bg-white/85 focus:ring-2 focus:ring-brand-500/25'

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
  neutral: 'bg-slate-100/75 text-slate-600 ring-slate-200/80',
  brand: 'bg-brand-50/90 text-brand-800 ring-brand-200/80',
  urgent: 'bg-danger-50/90 text-danger-700 ring-danger-200/80',
  watch: 'bg-warn-50/90 text-warn-700 ring-warn-200/80',
  ok: 'bg-ok-50/90 text-ok-700 ring-ok-200/80',
  accent: 'bg-accent-50/90 text-accent-700 ring-accent-100',
}

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 backdrop-blur-sm',
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
  const dims = size === 'lg' ? 'size-16 text-xl' : size === 'sm' ? 'size-9 text-xs' : 'size-12 text-sm'
  return (
    <span
      aria-hidden
      className={cx('grid shrink-0 place-items-center rounded-2xl font-bold shadow-sm ring-2 ring-white/80', dims, bg, fg)}
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
        'glass-subtle flex flex-col gap-0.5 rounded-card px-3 py-3 text-left',
        TONE_STYLES[tone],
        onClick && 'press press-active',
      )}
    >
      <span className="flex items-center gap-1.5 text-xs font-semibold opacity-80">
        {icon}
        <span className="truncate">{label}</span>
      </span>
      <span className="numeric text-2xl leading-none font-extrabold tracking-tight">{value}</span>
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
    <div className="glass-subtle animate-rise flex flex-col items-center gap-3 rounded-[2rem] px-6 py-14 text-center">
      {icon && (
        <span className="grid size-16 place-items-center rounded-3xl bg-brand-50 text-brand-600 ring-1 ring-brand-100">{icon}</span>
      )}
      <p className="text-lg font-bold text-slate-800">{title}</p>
      {hint && <p className="max-w-xs text-sm leading-relaxed text-slate-500">{hint}</p>}
      {action}
    </div>
  )
}

/** Skeletons rather than spinners: the layout does not jump when data lands. */
export function SkeletonRows({ count = 4 }: { count?: number }) {
  return (
    <ul className="flex flex-col gap-2" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="glass-subtle flex items-center gap-3 rounded-card p-3.5">
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
    <div className="flex items-center justify-center gap-3 py-10 text-slate-500" role="status">
      <span className="size-5 animate-spin rounded-full border-2 border-slate-200 border-t-brand-600" />
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
    <div className="glass-panel sticky bottom-0 z-20 -mx-3 mt-auto rounded-t-[1.5rem] border-x-0 border-b-0 px-3 pt-3 pb-safe">
      <div className="mx-auto flex max-w-5xl gap-2.5">{children}</div>
    </div>
  )
}

/** Staggered list entrance. Capped so a long roster does not crawl in. */
export function riseStyle(index: number) {
  return { animationDelay: `${Math.min(index, 8) * 32}ms` }
}
