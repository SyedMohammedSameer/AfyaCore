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

/** The languages the interface is fully translated into. Drives the picker. */
export const SUPPORTED_LANGS: LangCode[] = ['fr', 'mg', 'en']

function isLangCode(v: unknown): v is LangCode {
  return v === 'fr' || v === 'mg' || v === 'en'
}

function initialLang(): LangCode {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (isLangCode(stored)) return stored

  // On a first run only, follow the device. A phone set to English almost
  // certainly belongs to someone who reads English, and the picker in the
  // header is one tap away for anyone this guesses wrong about.
  for (const tag of navigator.languages ?? [navigator.language]) {
    const base = tag?.slice(0, 2).toLowerCase()
    if (isLangCode(base)) return base
  }

  // French is the working language of clinical documentation in Madagascar, so
  // it remains the fallback when the device says nothing useful.
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
