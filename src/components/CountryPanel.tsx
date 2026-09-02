import { useEffect, useState } from 'react'
import { Globe, ShieldAlert } from 'lucide-react'
import { Button, Card, Field, SectionTitle, Select } from './ui'
import { useI18n } from '../i18n'
import { useSession } from '../lib/session'
import { COUNTRY_PROFILES, countryCodes } from '../lib/countries'
import { getFacilityCountry, setFacilityCountry, useCountryProfile } from '../lib/facility'
import { recordAudit } from '../lib/audit'

/**
 * Where this facility is, and what that implies.
 *
 * Changing it is administrator-only, because it moves the clinical language the
 * extractor parses. A clinician who switched it mid-shift would find their
 * dictation silently parsed by the wrong pack, and the symptom would be missing
 * fields rather than an error.
 *
 * The data-protection block is shown rather than filed away in a document. The
 * facility administrator is the person who has to answer to the regulator named
 * in it, and the honest reading of "we have not had this checked by a lawyer"
 * belongs in front of them rather than in a footnote.
 */
export function CountryPanel() {
  const { t } = useI18n()
  const { may } = useSession()
  const profile = useCountryProfile()
  const [selected, setSelected] = useState(profile.code)

  useEffect(() => {
    getFacilityCountry().then(setSelected)
  }, [])

  const editable = may('manage.device')

  async function save() {
    await setFacilityCountry(selected)
    // Its own action: changing the country moves the clinical language the
    // extractor parses, which is a configuration change a reviewer needs to be
    // able to find when they are working out why a month of notes parsed badly.
    await recordAudit({
      action: 'facility.configure',
      subjectType: 'device',
      detail: `country=${selected}`,
    })
  }

  const law = profile.law

  return (
    <section>
      <SectionTitle>{t.country}</SectionTitle>
      <Card className="flex flex-col gap-3">
        <p className="text-sm text-slate-600">{t.countryHint}</p>

        <Field label={t.country}>
          <Select
            value={selected}
            disabled={!editable}
            onChange={(e) => setSelected(e.target.value)}
          >
            {countryCodes().map((code) => (
              <option key={code} value={code}>
                {COUNTRY_PROFILES[code]!.name}
              </option>
            ))}
          </Select>
        </Field>

        {editable && selected !== profile.code && (
          <Button full icon={<Globe size={18} />} onClick={save}>
            {t.save}
          </Button>
        )}
        {!editable && <p className="text-sm text-slate-500">{t.adminOnly}</p>}

        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 rounded-field bg-white/50 p-3 text-sm">
          <dt className="text-slate-500">{t.clinicalLanguage}</dt>
          <dd className="font-medium text-slate-800">{profile.clinicalLang.toUpperCase()}</dd>

          <dt className="text-slate-500">{t.facilityType}</dt>
          <dd className="font-medium text-slate-800">{profile.facilityTerm}</dd>

          <dt className="text-slate-500">{t.reportingSystem}</dt>
          <dd className="font-medium text-slate-800">{profile.hmis}</dd>

          <dt className="text-slate-500">{t.dataProtectionLaw}</dt>
          <dd className="font-medium text-slate-800">{law.law}</dd>

          <dt className="text-slate-500">{t.regulator}</dt>
          <dd className="font-medium text-slate-800">{law.regulator}</dd>

          <dt className="text-slate-500">{t.breachWindow}</dt>
          <dd className="font-medium text-slate-800">
            {/* "Unconfirmed" rather than a plausible-looking default. A wrong
                number here gets followed; a missing one gets asked about. */}
            {law.breachNotificationHours ? `${law.breachNotificationHours} h` : t.unconfirmed}
          </dd>

          <dt className="text-slate-500">{t.retention}</dt>
          <dd className="font-medium text-slate-800">
            {law.retentionYears ? `${law.retentionYears} ${t.years}` : t.unconfirmed}
          </dd>
        </dl>

        {!law.counselReviewed && (
          <p className="flex items-start gap-2 rounded-field bg-warn-50 p-2.5 text-xs leading-relaxed text-warn-700">
            <ShieldAlert size={16} className="mt-0.5 shrink-0" />
            {t.notLegalAdvice}
          </p>
        )}
      </Card>
    </section>
  )
}
