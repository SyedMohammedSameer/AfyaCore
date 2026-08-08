import { useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import { Merge, Search } from 'lucide-react'
import { AppShell } from '../components/AppShell'
import { Avatar, Card, EmptyState, Input, SectionTitle, SkeletonRows, riseStyle } from '../components/ui'
import { db } from '../db/db'
import { mergePatients, patientAge, searchPatients } from '../db/repo'
import { useI18n } from '../i18n'

/**
 * Fold a duplicate registration into this patient's record.
 *
 * The same person on two cards is routine on a paper roster, and the harm is
 * not the extra row, it is a clinical history split in half. So the screen is
 * framed around the record you are keeping: you are standing on the surviving
 * patient and choosing which duplicate to absorb, never the other way round.
 * That leaves no doubt about which name survives, which is the one thing
 * everybody gets wrong about merge dialogs.
 */
export function MergePatient() {
  const { patientId } = useParams()
  const { t } = useI18n()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)

  const keep = useLiveQuery(() => (patientId ? db.patients.get(patientId) : undefined), [patientId])

  // Everything except the record being kept: merging a patient into themselves
  // is the one move that must not be reachable.
  const candidates = useLiveQuery(
    async () => (await searchPatients(query, 40)).filter((p) => p.id !== patientId),
    [query, patientId],
  )

  if (!patientId || keep === null) {
    return (
      <AppShell title={t.mergeDuplicate} showBack>
        <EmptyState title={t.noResults} />
      </AppShell>
    )
  }

  async function merge(duplicateId: string, duplicateName: string) {
    if (!patientId || !keep) return
    const kept = `${keep.familyName} ${keep.givenName}`.trim()
    if (!window.confirm(`${t.mergeConfirm}\n\n${duplicateName}\n→ ${kept}`)) return

    setBusy(true)
    try {
      await mergePatients(patientId, duplicateId)
      // No confirmation dialog on the way out: the profile we land on shows the
      // consultation count, which is the thing the merge was for and better
      // evidence that it worked than a number in a box someone has to dismiss.
      navigate(`/patient/${patientId}`, { replace: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <AppShell
      title={t.mergeDuplicate}
      subtitle={keep ? `${keep.familyName} ${keep.givenName}`.trim() : undefined}
      showBack
    >
      <div className="flex flex-col gap-4 pb-6">
        <Card className="flex gap-3 text-sm text-slate-600">
          <Merge size={18} className="mt-0.5 shrink-0 text-brand-600" />
          <p>{t.mergeHint}</p>
        </Card>

        <div className="relative">
          <Search size={19} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-slate-400" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.searchPlaceholder}
            className="pl-11"
            autoComplete="off"
          />
        </div>

        <section>
          <SectionTitle>{t.mergeInto}</SectionTitle>
          {candidates === undefined ? (
            <SkeletonRows count={3} />
          ) : candidates.length === 0 ? (
            <EmptyState title={t.noOtherPatients} />
          ) : (
            <ul className="flex flex-col gap-2">
              {candidates.map((p, index) => {
                const age = patientAge(p)
                const name = `${p.familyName} ${p.givenName}`.trim()
                return (
                  <li key={p.id} className="animate-rise" style={riseStyle(index)}>
                    <button
                      disabled={busy}
                      onClick={() => merge(p.id, name)}
                      className="press press-active glass-panel flex w-full items-center gap-3 rounded-card p-3 text-left disabled:opacity-50"
                    >
                      <Avatar familyName={p.familyName} givenName={p.givenName} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-extrabold text-slate-900">{name}</span>
                        <span className="mt-0.5 block truncate text-sm text-slate-500">
                          {[
                            age !== undefined ? `${age} ${t.years}` : null,
                            p.registerNo ? `${t.registerNo} ${p.registerNo}` : null,
                            p.address,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </span>
                      <Merge size={18} className="shrink-0 text-slate-300" />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  )
}
