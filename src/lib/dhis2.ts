/**
 * DHIS2 aggregate reporting.
 *
 * What a facility owes the district each month is not patient records, it is
 * counts: how many consultations, how many malaria cases, split by age and sex.
 * Producing that automatically from records already captured removes the single
 * most tedious piece of monthly paperwork, which is often the reason a digital
 * tool gets adopted at all.
 *
 * ⚠️ IMPORTANT: DHIS2 identifies every data element and org unit by an
 * instance-specific 11-character UID. We do not have the NGO's instance, so the
 * mapping below ships with placeholders. The JSON produced is structurally a
 * valid `dataValueSet` and will import cleanly *once the real UIDs are filled
 * in*, see `DHIS2_MAPPING` and README. Exporting with placeholders is
 * deliberately marked in the payload so nobody mistakes it for a live feed.
 */
import type { Encounter, LangCode, Patient } from '../db/schema'
import { patientAge } from '../db/repo'

/** WHO/IMCI-aligned age bands, which is how these reports are conventionally cut. */
export type AgeBand = '<1' | '1-4' | '5-14' | '15-49' | '50+' | 'unknown'

export function ageBand(age: number | undefined): AgeBand {
  if (age === undefined) return 'unknown'
  if (age < 1) return '<1'
  if (age < 5) return '1-4'
  if (age < 15) return '5-14'
  if (age < 50) return '15-49'
  return '50+'
}

/**
 * Indicator classification from the free-text French diagnosis.
 *
 * Keyword matching, ordered most-specific first. This is deliberately crude and
 * auditable rather than clever: a wrong count in a national malaria figure is a
 * real harm, so anything unmatched falls to `other` and is visible as such
 * instead of being forced into a bucket.
 */
export const INDICATORS = [
  { key: 'malaria', label: 'Paludisme', patterns: [/palud/i, /\bpalu\b/i, /malaria/i] },
  { key: 'ari', label: 'Infection respiratoire aiguë', patterns: [/pneumon/i, /bronch/i, /infection respiratoire/i, /\bira\b/i] },
  { key: 'diarrhoea', label: 'Diarrhée', patterns: [/diarrh/i, /gastro/i, /cholera/i, /choléra/i] },
  { key: 'malnutrition', label: 'Malnutrition', patterns: [/malnutrition/i, /kwashiorkor/i, /marasme/i] },
  { key: 'tuberculosis', label: 'Tuberculose', patterns: [/tubercul/i, /\btb\b/i] },
  { key: 'hypertension', label: 'Hypertension', patterns: [/hypertension/i, /\bhta\b/i] },
  { key: 'other', label: 'Autre', patterns: [] },
] as const

export type IndicatorKey = (typeof INDICATORS)[number]['key']

/**
 * Total consultations is counted alongside the diagnosis indicators but is not
 * one of them, every encounter contributes to it, and to exactly one
 * indicator. Keeping it a distinct type stops the two being confused.
 */
export type CountKey = IndicatorKey | 'consultations'

/**
 * Indicator names for the *interface*, which follows the staff's chosen
 * language. `INDICATORS[].label` above is deliberately left alone: it is what
 * lands in the exported CSV, and that file goes to a district office in
 * Madagascar, where the reporting vocabulary is French regardless of what the
 * phone is set to. Report contents must not shift with a UI preference.
 *
 * ⚠️ The Malagasy terms here share the caveat on i18n/strings.ts, they have not
 * been reviewed by a native speaker.
 */
const INDICATOR_LABELS: Record<LangCode, Record<CountKey, string>> = {
  fr: {
    consultations: 'Consultations',
    malaria: 'Paludisme',
    ari: 'Infection respiratoire aiguë',
    diarrhoea: 'Diarrhée',
    malnutrition: 'Malnutrition',
    tuberculosis: 'Tuberculose',
    hypertension: 'Hypertension',
    other: 'Autre',
  },
  en: {
    consultations: 'Consultations',
    malaria: 'Malaria',
    ari: 'Acute respiratory infection',
    diarrhoea: 'Diarrhoea',
    malnutrition: 'Malnutrition',
    tuberculosis: 'Tuberculosis',
    hypertension: 'Hypertension',
    other: 'Other',
  },
  mg: {
    consultations: 'Fitsaboana',
    malaria: 'Tazomoka',
    ari: 'Aretin’ny fofonaina',
    diarrhoea: 'Fivalanana',
    malnutrition: 'Tsy fahampian-tsakafo',
    tuberculosis: 'Raboka',
    hypertension: 'Tosidra avo',
    other: 'Hafa',
  },
}

/** Display name for an indicator in the interface language. */
export function indicatorLabel(key: string, lang: LangCode): string {
  const table = INDICATOR_LABELS[lang]
  return (table as Record<string, string>)[key] ?? key
}

export function classifyDiagnosis(diagnosis: string | undefined): IndicatorKey {
  if (!diagnosis) return 'other'
  for (const indicator of INDICATORS) {
    if (indicator.patterns.some((p) => p.test(diagnosis))) return indicator.key
  }
  return 'other'
}

/**
 * Placeholder DHIS2 metadata.
 *
 * Replace every `REPLACE_*` value with the real UID from the target instance
 * (Maintenance app → Data element → the 11-char UID in the URL). Until then,
 * exports carry `_placeholderMapping: true`.
 */
export interface Dhis2Mapping {
  orgUnit: string
  dataSet: string
  /** dataElement UID per indicator. */
  dataElements: Record<CountKey, string>
  /** categoryOptionCombo UID per age band + sex cell. */
  categoryOptionCombos: Record<string, string>
}

export const DHIS2_MAPPING: Dhis2Mapping = {
  orgUnit: 'REPLACE_ORG_UNIT_UID',
  dataSet: 'REPLACE_DATASET_UID',
  dataElements: {
    consultations: 'REPLACE_DE_CONSULTATIONS',
    malaria: 'REPLACE_DE_MALARIA',
    ari: 'REPLACE_DE_ARI',
    diarrhoea: 'REPLACE_DE_DIARRHOEA',
    malnutrition: 'REPLACE_DE_MALNUTRITION',
    tuberculosis: 'REPLACE_DE_TB',
    hypertension: 'REPLACE_DE_HTN',
    other: 'REPLACE_DE_OTHER',
  },
  categoryOptionCombos: {},
}

export interface AggregateCell {
  indicator: CountKey
  ageBand: AgeBand
  sex: Patient['sex']
  count: number
}

export interface Dhis2Export {
  dataSet: string
  period: string
  orgUnit: string
  completeDate: string
  dataValues: { dataElement: string; categoryOptionCombo: string; value: string }[]
  /** Present whenever the mapping still contains placeholders. */
  _placeholderMapping?: true
  /** Human-readable mirror of the same numbers, so the export is checkable by eye. */
  _readable: { indicator: string; ageBand: AgeBand; sex: string; count: number }[]
}

/** DHIS2 monthly period format: YYYYMM. */
export function dhis2Period(date: Date): string {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}`
}

/**
 * Aggregate finalised encounters in a month into indicator counts.
 *
 * Drafts are excluded, an unconfirmed consultation must never reach a national
 * statistic.
 */
export function aggregateMonth(
  patients: Patient[],
  encounters: Encounter[],
  month: Date,
): AggregateCell[] {
  const byId = new Map(patients.map((p) => [p.id, p]))
  const start = new Date(month.getFullYear(), month.getMonth(), 1).getTime()
  const end = new Date(month.getFullYear(), month.getMonth() + 1, 1).getTime()

  const cells = new Map<string, AggregateCell>()
  const bump = (indicator: CountKey, band: AgeBand, sex: Patient['sex']) => {
    const key = `${indicator}|${band}|${sex}`
    const existing = cells.get(key)
    if (existing) existing.count++
    else cells.set(key, { indicator, ageBand: band, sex, count: 1 })
  }

  for (const e of encounters) {
    if (e.status !== 'final') continue
    if (e.occurredAt < start || e.occurredAt >= end) continue

    const patient = byId.get(e.patientId)
    // Age is taken at the time of the encounter, not today, a report run in
    // December must not age a child out of the under-5 band retroactively.
    const band = ageBand(patient ? patientAge(patient, e.occurredAt) : undefined)
    const sex = patient?.sex ?? 'unknown'

    bump('consultations', band, sex)
    bump(classifyDiagnosis(e.diagnosis), band, sex)
  }

  return [...cells.values()].sort(
    (a, b) => a.indicator.localeCompare(b.indicator) || a.ageBand.localeCompare(b.ageBand),
  )
}

const SEX_LABEL: Record<Patient['sex'], string> = { female: 'F', male: 'M', unknown: '?' }

export function toDhis2DataValueSet(
  patients: Patient[],
  encounters: Encounter[],
  month: Date,
  mapping: Dhis2Mapping = DHIS2_MAPPING,
): Dhis2Export {
  const cells = aggregateMonth(patients, encounters, month)
  const usesPlaceholders =
    mapping.orgUnit.startsWith('REPLACE_') ||
    Object.values(mapping.dataElements).some((v) => v.startsWith('REPLACE_'))

  const dataValues = cells.map((c) => ({
    dataElement: mapping.dataElements[c.indicator] ?? `REPLACE_DE_${c.indicator.toUpperCase()}`,
    categoryOptionCombo:
      mapping.categoryOptionCombos[`${c.ageBand}|${c.sex}`] ??
      `REPLACE_COC_${c.ageBand}_${SEX_LABEL[c.sex]}`,
    value: String(c.count),
  }))

  const labels = new Map(INDICATORS.map((i) => [i.key as string, i.label]))

  return {
    dataSet: mapping.dataSet,
    period: dhis2Period(month),
    orgUnit: mapping.orgUnit,
    completeDate: new Date().toISOString().slice(0, 10),
    dataValues,
    ...(usesPlaceholders ? { _placeholderMapping: true as const } : {}),
    _readable: cells.map((c) => ({
      indicator: labels.get(c.indicator) ?? 'Consultations',
      ageBand: c.ageBand,
      sex: SEX_LABEL[c.sex],
      count: c.count,
    })),
  }
}

/** CSV of the same aggregate, for facilities that still submit on paper. */
export function toAggregateCsv(patients: Patient[], encounters: Encounter[], month: Date): string {
  const cells = aggregateMonth(patients, encounters, month)
  const labels = new Map(INDICATORS.map((i) => [i.key as string, i.label]))
  const rows = [
    ['periode', 'indicateur', 'tranche_age', 'sexe', 'nombre'],
    ...cells.map((c) => [
      dhis2Period(month),
      labels.get(c.indicator) ?? 'Consultations',
      c.ageBand,
      SEX_LABEL[c.sex],
      String(c.count),
    ]),
  ]
  return rows.map((r) => r.join(',')).join('\n')
}
