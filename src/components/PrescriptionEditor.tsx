import { Pill, Plus, Trash2 } from 'lucide-react'
import { Button, Card, Input, SectionTitle } from './ui'
import { ProvenanceChip } from './VitalsGrid'
import { clinicalLocaleFor } from '../lib/clinicalLocales'
import { totalDoses } from '../lib/format'
import { newId } from '../lib/id'
import { useI18n } from '../i18n'
import type { FieldProvenance, Prescription } from '../db/schema'

interface PrescriptionEditorProps {
  prescriptions: Prescription[]
  provenance: Record<string, FieldProvenance>
  onChange: (next: Prescription[]) => void
}

export function PrescriptionEditor({ prescriptions, provenance, onChange }: PrescriptionEditorProps) {
  const { t, lang } = useI18n()
  const formulary = clinicalLocaleFor(lang).formulary

  function update(id: string, patch: Partial<Prescription>) {
    onChange(prescriptions.map((p) => (p.id === id ? { ...p, ...patch } : p)))
  }

  function remove(id: string) {
    onChange(prescriptions.filter((p) => p.id !== id))
  }

  function add() {
    onChange([...prescriptions, { id: newId(), drug: '' }])
  }

  return (
    <section>
      <SectionTitle>{t.prescriptions}</SectionTitle>

      <div className="flex flex-col gap-3">
        {prescriptions.map((p) => {
          const total = totalDoses(p)
          return (
            <Card key={p.id} className="flex flex-col gap-3">
              <div className="flex items-start gap-2">
                <Pill size={20} className="mt-3 shrink-0 text-brand-600" />
                <div className="min-w-0 flex-1">
                  <span className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-slate-700">
                    {t.drug}
                    <ProvenanceChip provenance={provenance[`prescription.${p.id}`]} />
                  </span>
                  <Input
                    value={p.drug}
                    onChange={(e) => update(p.id, { drug: e.target.value })}
                    list="formulary"
                    autoCapitalize="none"
                    placeholder={t.drug}
                  />
                </div>
                <button
                  onClick={() => remove(p.id)}
                  aria-label={t.delete}
                  className="tap-safe mt-1 grid shrink-0 place-items-center rounded-full text-slate-400 active:bg-danger-50 active:text-danger-600"
                >
                  <Trash2 size={20} />
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-600">{t.dose}</span>
                  <Input
                    value={p.dose ?? ''}
                    onChange={(e) => update(p.id, { dose: e.target.value || undefined })}
                    placeholder="500 mg"
                    className="px-2 text-base"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-600">{t.timesPerDay}</span>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={12}
                    value={p.frequencyPerDay ?? ''}
                    onChange={(e) =>
                      update(p.id, { frequencyPerDay: e.target.value ? Number(e.target.value) : undefined })
                    }
                    className="px-2 text-base"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-600">{t.days}</span>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={365}
                    value={p.durationDays ?? ''}
                    onChange={(e) =>
                      update(p.id, { durationDays: e.target.value ? Number(e.target.value) : undefined })
                    }
                    className="px-2 text-base"
                  />
                </label>
              </div>

              {/* The number staff actually need when counting tablets into a bag. */}
              {total !== undefined && (
                <p className="text-sm font-medium text-brand-800">
                  = {total} {t.dose.toLowerCase()}
                </p>
              )}
            </Card>
          )
        })}

        <Button variant="secondary" full icon={<Plus size={20} />} onClick={add}>
          {t.addPrescription}
        </Button>
      </div>

      {/* Native autocomplete: no JS, no bundle cost, works offline. */}
      <datalist id="formulary">
        {formulary.map((d) => (
          <option key={d} value={d} />
        ))}
      </datalist>
    </section>
  )
}
