"use client"

import type { Locale } from 'date-fns'
import { de } from 'date-fns/locale/de'
import { enUS } from 'date-fns/locale/en-US'
import { es } from 'date-fns/locale/es'
import { pl } from 'date-fns/locale/pl'
import { useLocale } from '@open-mercato/shared/lib/i18n/context'

const DATE_FNS_LOCALES: Record<string, Locale> = { pl, de, es, en: enUS }

/**
 * The date-fns locale of an app language ('pl', 'pl-PL', 'en'…): month and day
 * names and the first day of the week for a `Calendar` / `DatePicker`. English
 * for a language without one.
 */
export function dateFnsLocaleFor(appLocale: string | null | undefined): Locale {
  const code = String(appLocale ?? '').split('-')[0]?.toLowerCase() ?? ''
  return DATE_FNS_LOCALES[code] ?? enUS
}

/** The date-fns locale of the app's current language (needs the I18nProvider). */
export function useDateFnsLocale(): Locale {
  return dateFnsLocaleFor(useLocale())
}

const ISO_DATE_PLACEHOLDERS: Record<string, string> = {
  pl: 'RRRR-MM-DD',
  de: 'JJJJ-MM-TT',
  es: 'AAAA-MM-DD',
}

/** The typed-date hint for a `yyyy-MM-dd` input, in the language's own letters ("RRRR-MM-DD" in Polish). */
export function isoDatePlaceholderFor(appLocale: string | null | undefined): string {
  const code = String(appLocale ?? '').split('-')[0]?.toLowerCase() ?? ''
  return ISO_DATE_PLACEHOLDERS[code] ?? 'YYYY-MM-DD'
}
