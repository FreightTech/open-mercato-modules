/**
 * Class-name joiner with Tailwind conflict resolution (the platform `cn`:
 * clsx + tailwind-merge), so a caller's `w-40` overrides a base class's
 * `w-full` instead of both landing on the element and the base winning.
 *
 * The FMS named typography tokens (`text-body-regular-xs`,
 * `text-label-semibold-2xs`, … — `.ai/typography-rules.md`) are resolved here,
 * not by tailwind-merge. Stock tailwind-merge reads `text-body-regular-xs` and
 * `text-m3ft-on-surface-variant` as two text COLOURS and silently drops the
 * size — every "size + colour" pair rendered at the inherited 16 px. So tokens
 * are shielded from the merge and de-duplicated among themselves: the last
 * token wins, colours stay colours.
 */
import { cn as platformCn } from '@open-mercato/shared/lib/utils'

const TYPOGRAPHY_TOKEN = /^text-(display|heading|body|label|caption|code)-(regular|medium|semibold|bold)-(2xs|xs|sm|md|lg|xl|2xl)$/
const SHIELD = '__fms-typography__'

export function cn(...parts: Array<string | false | null | undefined>): string {
  const shielded = parts
    .filter((p): p is string => typeof p === 'string' && p.length > 0)
    .join(' ')
    .split(/\s+/)
    .map((c) => (TYPOGRAPHY_TOKEN.test(c) ? SHIELD + c : c))
    .join(' ')
  const merged = platformCn(shielded).split(' ').filter(Boolean)
  const lastToken = merged.findLastIndex((c) => c.startsWith(SHIELD))
  return merged
    .filter((c, i) => !c.startsWith(SHIELD) || i === lastToken)
    .map((c) => (c.startsWith(SHIELD) ? c.slice(SHIELD.length) : c))
    .join(' ')
}
