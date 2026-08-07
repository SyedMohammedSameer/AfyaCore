import { createContext, use, useCallback, useEffect, useState, type ReactNode } from 'react'
import type { LangCode } from '../db/schema'
import { STRINGS, type Strings } from './strings'

export { LANG_LABELS } from './strings'
export type { Strings } from './strings'

const STORAGE_KEY = 'afyacore.lang'

interface I18nValue {
  lang: LangCode
  t: Strings
  setLang: (l: LangCode) => void
}

const I18nContext = createContext<I18nValue | null>(null)

function initialLang(): LangCode {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'fr' || stored === 'mg' || stored === 'en') return stored
  // French is the working language of clinical documentation in Madagascar, so
  // it is the default regardless of what the device reports.
  return 'fr'
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<LangCode>(initialLang)

  const setLang = useCallback((l: LangCode) => {
    setLangState(l)
    localStorage.setItem(STORAGE_KEY, l)
  }, [])

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  return <I18nContext value={{ lang, t: STRINGS[lang], setLang }}>{children}</I18nContext>
}

export function useI18n(): I18nValue {
  const ctx = use(I18nContext)
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider')
  return ctx
}
