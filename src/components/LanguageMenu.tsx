import { ChevronDown, Languages } from 'lucide-react'
import { LANG_LABELS, SUPPORTED_LANGS, useI18n } from '../i18n'
import type { LangCode } from '../db/schema'
import { cx } from './ui'

/**
 * Interface language picker.
 *
 * A native `<select>` sits invisibly over the chip rather than a custom popover:
 * it gets the platform's own picker wheel on a phone, it is keyboard and screen
 * reader accessible for free, and it costs nothing in bundle size. The hit area
 * is deliberately grown past the chip's visible bounds so it clears a thumb
 * target without making the header taller.
 *
 * This changes the *interface* language only. The patient instruction sheet
 * always follows the patient's own recorded language, and dictation follows the
 * interface language through `clinicalLocaleFor`.
 */
export function LanguageMenu({ onDark = false, expand = false }: { onDark?: boolean; expand?: boolean }) {
  const { lang, setLang, t } = useI18n()

  return (
    <div
      className={cx(
        'press relative inline-flex shrink-0 items-center gap-1.5 rounded-full text-xs font-bold ring-1 backdrop-blur-md',
        expand ? 'w-full justify-between px-3 py-2.5 text-sm' : 'px-2.5 py-2',
        onDark
          ? 'bg-white/13 text-white/90 ring-white/20 hover:bg-white/20'
          : 'bg-white/70 text-slate-700 ring-slate-200/80 hover:bg-white',
      )}
    >
      <span className="inline-flex items-center gap-1.5">
        <Languages size={expand ? 16 : 14} />
        <span>{expand ? LANG_LABELS[lang] : lang.toUpperCase()}</span>
      </span>
      <ChevronDown size={13} className="opacity-70" />
      <select
        aria-label={t.language}
        value={lang}
        onChange={(e) => setLang(e.target.value as LangCode)}
        // Overflows the chip so the tap target clears 44px without the chip
        // itself having to be that tall in a crowded header.
        className="absolute -inset-y-2 inset-x-0 cursor-pointer text-base opacity-0"
      >
        {SUPPORTED_LANGS.map((code) => (
          <option key={code} value={code}>
            {LANG_LABELS[code]}
          </option>
        ))}
      </select>
    </div>
  )
}
