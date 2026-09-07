import { Link } from 'react-router'
import { ArrowRight, UserSearch } from 'lucide-react'
import { Card, cx } from './ui'
import { useI18n } from '../i18n'
import type { DuplicateMatch, DuplicateReason } from '../lib/duplicates'
import { formatAge } from '../lib/format'

/**
 * "This might already be in the register."
 *
 * Three rules, all of them about not being believed too much.
 *
 * It **suggests and never blocks**. The save button beneath it stays live. A
 * clinician with a queue outside cannot be made to argue with a dialog, and a
 * warning that stops work is one that gets clicked past without reading by the
 * second morning.
 *
 * It **always says why**. "Possible duplicate" alone is an accusation nobody
 * can check; "same phone, same age, name spelled slightly differently" is a
 * fact the person standing with the patient can confirm in one question.
 *
 * It **opens the record rather than merging**. If this is the same person the
 * right move is to look at their history and add the consultation there, not
 * to have the app join two records on a guess.
 */
const REASON_KEYS = {
  'same-register-no': 'duplicateSameRegisterNo',
  'same-phone': 'duplicateSamePhone',
  'same-name': 'duplicateSameName',
  'similar-name': 'duplicateSimilarName',
  'swapped-name': 'duplicateSwappedName',
  'same-age': 'duplicateSameAge',
  'same-village': 'duplicateSameVillage',
} as const satisfies Record<DuplicateReason, string>

export function DuplicateWarning({ matches }: { matches: DuplicateMatch[] }) {
  const { t } = useI18n()
  if (matches.length === 0) return null

  return (
    <Card
      className="flex flex-col gap-3 border-warn-200 bg-warn-50/70"
      aria-live="polite"
      data-duplicate-warning
    >
      <p className="flex items-center gap-2 text-sm font-semibold text-warn-700">
        <UserSearch size={18} className="shrink-0" />
        {t.duplicateHeading}
      </p>

      <ul className="flex flex-col gap-2">
        {matches.map((match) => {
          const age = formatAge(match.patient, t)
          return (
            <li key={match.patient.id}>
              {/*
                One left-aligned stack, not a row.

                This was a text block beside a right-hand "Open this record"
                label, and the label was centred against three lines of
                wrapping text, so it floated in the middle of the card with
                nothing to align to while the reason wrapped around it. Reading
                order here is name, then age, then why it matched, then what to
                do about it, and each of those is a full-width line.
              */}
              <Link
                to={`/patient/${match.patient.id}`}
                className="surface-card press block rounded-field p-3"
              >
                <p className="truncate text-base font-semibold text-ink">
                  <span className="font-extrabold">{match.patient.familyName}</span>{' '}
                  {match.patient.givenName}
                </p>
                <p className="mt-0.5 text-sm text-ink-3">
                  {[
                    age,
                    match.patient.registerNo ? `${t.registerNo} ${match.patient.registerNo}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                {/* The evidence, not a verdict. */}
                <p
                  className={cx(
                    'mt-1.5 text-[0.8125rem] leading-snug font-medium',
                    match.confidence === 'likely' ? 'text-warn-700' : 'text-ink-3',
                  )}
                >
                  {match.confidence === 'likely' ? t.duplicateLikely : t.duplicatePossible}
                  {': '}
                  {match.reasons.map((reason) => t[REASON_KEYS[reason]]).join(', ')}
                </p>
                <p className="mt-2 flex items-center gap-1 text-sm font-semibold text-brand-700">
                  {t.duplicateOpen}
                  <ArrowRight size={15} className="shrink-0" />
                </p>
              </Link>
            </li>
          )
        })}
      </ul>

      {/* Not a button. Nothing is blocked, so there is nothing to dismiss —
          this only tells the reader that carrying on is a legitimate answer. */}
      <p className="text-sm text-ink-3">{t.duplicateDismiss}</p>
    </Card>
  )
}
