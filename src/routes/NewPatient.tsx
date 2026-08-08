import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import { AppShell } from '../components/AppShell'
import { ActionBar, Button, Card, Field, Input, Select, SkeletonRows } from '../components/ui'
import { db } from '../db/db'
import { createPatient, updatePatient } from '../db/repo'
import { useI18n } from '../i18n'
import { LANG_LABELS } from '../i18n'
import type { LangCode, Sex } from '../db/schema'

/**
 * Patient registration, and the same form in edit mode.
 *
 * Only the family name is mandatory. Every other field, including date of
 * birth, is optional by design: a large share of patients arrive without
 * documentation and know only roughly how old they are, and a form that refuses
 * to record them is a form staff will abandon for paper.
 *
 * Registration and correction share one component on purpose. A name mistyped
 * on a busy morning is the single most likely thing anyone will need to fix,
 * and a separate edit screen would drift out of step with this one field by
 * field until the two disagreed about what a patient is.
 */
export function NewPatient() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const { patientId } = useParams()
  const editing = patientId !== undefined

  const existing = useLiveQuery(
    () => (patientId ? db.patients.get(patientId) : undefined),
    [patientId],
  )

  const [familyName, setFamilyName] = useState('')
  const [givenName, setGivenName] = useState('')
  const [sex, setSex] = useState<Sex>('unknown')
  const [birthDate, setBirthDate] = useState('')
  const [approximateAge, setApproximateAge] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [registerNo, setRegisterNo] = useState('')
  const [preferredLang, setPreferredLang] = useState<LangCode>('mg')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)

  // Fill the form once, on first arrival of the record. `useLiveQuery` re-fires
  // on every write to the table, and re-seeding on each of those would discard
  // whatever the clinician had typed since.
  useEffect(() => {
    if (!editing || loaded || !existing) return
    setFamilyName(existing.familyName)
    setGivenName(existing.givenName)
    setSex(existing.sex)
    setBirthDate(existing.birthDate ?? '')
    setApproximateAge(existing.approximateAge === undefined ? '' : String(existing.approximateAge))
    setPhone(existing.phone ?? '')
    setAddress(existing.address ?? '')
    setRegisterNo(existing.registerNo ?? '')
    setPreferredLang(existing.preferredLang)
    setLoaded(true)
  }, [editing, loaded, existing])

  async function save() {
    if (!familyName.trim()) {
      setError(t.required)
      return
    }
    setSaving(true)
    try {
      const ageNum = Number.parseInt(approximateAge, 10)
      const fields = {
        familyName: familyName.trim(),
        givenName: givenName.trim(),
        sex,
        birthDate: birthDate || undefined,
        birthDatePrecision: birthDate ? ('day' as const) : undefined,
        approximateAge: Number.isFinite(ageNum) && ageNum > 0 ? ageNum : undefined,
        phone: phone.trim() || undefined,
        address: address.trim() || undefined,
        registerNo: registerNo.trim() || undefined,
        preferredLang,
      }

      if (editing && patientId) {
        await updatePatient(patientId, fields)
        navigate(`/patient/${patientId}`, { replace: true })
      } else {
        const id = await createPatient(fields)
        navigate(`/patient/${id}`, { replace: true })
      }
    } catch (e) {
      setError(String(e))
      setSaving(false)
    }
  }

  if (editing && existing === undefined) {
    return (
      <AppShell title={t.editPatient} showBack>
        <SkeletonRows count={3} />
      </AppShell>
    )
  }

  return (
    <AppShell title={editing ? t.editPatient : t.newPatient} showBack>
      <div className="flex max-w-3xl flex-col gap-4 pb-4">
        <Card className="relative overflow-hidden p-5 sm:p-6">
          <div className="pointer-events-none absolute -top-16 -right-12 size-40 rounded-full bg-brand-100/80 blur-2xl" />
          <div className="relative grid gap-4 sm:grid-cols-2">
            <Field label={t.familyName} required error={error && !familyName.trim() ? error : undefined}>
            <Input
              value={familyName}
              onChange={(e) => setFamilyName(e.target.value)}
              autoComplete="family-name"
              autoCapitalize="words"
              enterKeyHint="next"
            />
            </Field>

            <Field label={t.givenName}>
            <Input
              value={givenName}
              onChange={(e) => setGivenName(e.target.value)}
              autoComplete="given-name"
              autoCapitalize="words"
            />
            </Field>

            <Field label={t.sex}>
            <Select value={sex} onChange={(e) => setSex(e.target.value as Sex)}>
              <option value="unknown">{t.unknown}</option>
              <option value="female">{t.female}</option>
              <option value="male">{t.male}</option>
            </Select>
            </Field>
          </div>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="flex flex-col gap-4 p-5 sm:p-6">
            <Field label={t.birthDate} hint={t.birthDateHint}>
            <Input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
            </Field>

            <Field label={t.approximateAge}>
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              max={130}
              value={approximateAge}
              onChange={(e) => setApproximateAge(e.target.value)}
              disabled={birthDate !== ''}
            />
            </Field>
          </Card>

          <Card className="flex flex-col gap-4 p-5 sm:p-6">
            <Field label={t.registerNo}>
            <Input value={registerNo} onChange={(e) => setRegisterNo(e.target.value)} inputMode="numeric" />
            </Field>

            <Field label={t.phone}>
            <Input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </Field>

            <Field label={t.address}>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} autoCapitalize="words" />
            </Field>

            <Field label={t.preferredLang} hint={t.preferredLangHint}>
            <Select value={preferredLang} onChange={(e) => setPreferredLang(e.target.value as LangCode)}>
              {(Object.keys(LANG_LABELS) as LangCode[]).map((code) => (
                <option key={code} value={code}>
                  {LANG_LABELS[code]}
                </option>
              ))}
            </Select>
            </Field>
          </Card>
        </div>
      </div>

      <ActionBar>
        <Button variant="secondary" full onClick={() => navigate(-1)}>
          {t.cancel}
        </Button>
        <Button full onClick={save} disabled={saving}>
          {editing ? t.savePatient : t.save}
        </Button>
      </ActionBar>
    </AppShell>
  )
}
