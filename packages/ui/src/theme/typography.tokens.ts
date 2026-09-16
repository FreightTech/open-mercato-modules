/*
  Mirrors the rows in Figma "FMS Foundation" → page "🔤 Typography System".
  The Storybook story renders this list directly; keep it in sync with
  `./typography.css` when tokens are added or removed.
*/

export type TypographyGroup = 'heading' | 'body' | 'label' | 'caption' | 'code'

export type TypographyToken = {
  /** Figma token name (slash-namespaced), e.g. `heading/bold/md`. */
  name: string
  /** Group heading shown above each section in the table. */
  group: TypographyGroup
  /** Tailwind utility class produced by `--text-*` in `typography.css`. */
  className: string
  /** Equivalent Tailwind utility(ies) — what the row labels in Figma show. */
  tailwindEquivalent: string
  /** Font size in rem (matches Figma's REM column). */
  rem: string
  /** Resolved line-height (px) for human readability in the story. */
  lineHeightPx: number
  /** Resolved font-weight. */
  fontWeight: 400 | 500 | 600 | 700
  /**
   * Resolved letter-spacing in `em`, when the token declares one.
   * Headings carry −0.025em; the `2xs` micro steps carry POSITIVE tracking
   * (optical compensation below 12px). Omitted = 0 (the default).
   */
  letterSpacingEm?: number
  /**
   * Set on tokens that are NOT general-purpose UI type — names the single
   * place the token is allowed. Today this is the `2xs` micro ramp, which
   * exists only for the DynamicTable's `dense` density level.
   *
   * The Storybook story does not surface this yet; it is here so the
   * restriction travels with the data rather than living only in
   * `.ai/typography-rules.md`, and so a lint/review pass can read it.
   */
  restrictedTo?: string
  /** Polish description from Figma's DESCRIPTION column. */
  description: string
  /** Sample text from Figma's DEMO column (Polish FMS-flavoured). */
  sample: string
}

export const TYPOGRAPHY_GROUPS: Record<TypographyGroup, { label: string; subtitle: string }> = {
  heading: { label: 'Heading', subtitle: '9 styles · Geist · letter-spacing −2.5%' },
  body: { label: 'Body', subtitle: '6 styles · Geist' },
  /* NOTE: `--text-label-semibold-md` exists in typography.css but has never had
     a row here (pre-existing drift, left alone deliberately — adding it is a
     Storybook change, not a density change). Counts below describe THIS array. */
  label: { label: 'Label', subtitle: '3 styles · Geist' },
  caption: { label: 'Caption', subtitle: '2 styles · Geist' },
  code: { label: 'Code / Mono', subtitle: '3 styles · Geist Mono' },
}

export const TYPOGRAPHY_TOKENS: TypographyToken[] = [
  // ── Heading ───────────────────────────────────────────────────────
  {
    name: 'heading/bold/2xl',
    group: 'heading',
    className: 'text-heading-bold-2xl',
    tailwindEquivalent: 'text-2xl font-bold',
    rem: '1.5rem',
    lineHeightPx: 32,
    fontWeight: 700,
    description: 'Page title · h1 · jedna na stronę',
    sample: 'Faktury przychodzące',
  },
  {
    name: 'heading/bold/xl',
    group: 'heading',
    className: 'text-heading-bold-xl',
    tailwindEquivalent: 'text-xl font-bold',
    rem: '1.25rem',
    lineHeightPx: 28,
    fontWeight: 700,
    description: 'Section title · h2',
    sample: 'Krok 1 — Weryfikacja',
  },
  {
    name: 'heading/bold/lg',
    group: 'heading',
    className: 'text-heading-bold-lg',
    tailwindEquivalent: 'text-lg font-bold',
    rem: '1.125rem',
    lineHeightPx: 28,
    fontWeight: 700,
    description: 'Subsection · h3 · dialog title',
    sample: 'Dane faktury',
  },
  {
    name: 'heading/bold/md',
    group: 'heading',
    className: 'text-heading-bold-md',
    tailwindEquivalent: 'text-base font-bold',
    rem: '1rem',
    lineHeightPx: 24,
    fontWeight: 700,
    description: 'Card title · h4',
    sample: 'SPOL-2025-041',
  },
  {
    name: 'heading/semibold/2xl',
    group: 'heading',
    className: 'text-heading-semibold-2xl',
    tailwindEquivalent: 'text-2xl font-semibold',
    rem: '1.5rem',
    lineHeightPx: 32,
    fontWeight: 600,
    description: 'Page title alt · lżejszy od bold',
    sample: 'Teczki projektów',
  },
  {
    name: 'heading/semibold/xl',
    group: 'heading',
    className: 'text-heading-semibold-xl',
    tailwindEquivalent: 'text-xl font-semibold',
    rem: '1.25rem',
    lineHeightPx: 28,
    fontWeight: 600,
    description: 'Section alt · SectionHeader',
    sample: 'Alokacja kosztów',
  },
  {
    name: 'heading/semibold/lg',
    group: 'heading',
    className: 'text-heading-semibold-lg',
    tailwindEquivalent: 'text-lg font-semibold',
    rem: '1.125rem',
    lineHeightPx: 28,
    fontWeight: 600,
    description: 'SectionHeader komponent · h3 alt',
    sample: 'Pozycje faktury',
  },
  {
    name: 'heading/semibold/md',
    group: 'heading',
    className: 'text-heading-semibold-md',
    tailwindEquivalent: 'text-base font-semibold',
    rem: '1rem',
    lineHeightPx: 24,
    fontWeight: 600,
    description: 'Form section label · card header',
    sample: 'Kontrahent',
  },
  {
    name: 'heading/semibold/sm',
    group: 'heading',
    className: 'text-heading-semibold-sm',
    tailwindEquivalent: 'text-sm font-semibold',
    rem: '0.875rem',
    lineHeightPx: 20,
    fontWeight: 600,
    description: 'Table th · breadcrumb · nav active',
    sample: 'Rodzaj kosztu',
  },

  // ── Body ──────────────────────────────────────────────────────────
  {
    name: 'body/regular/sm',
    group: 'body',
    className: 'text-body-regular-sm',
    tailwindEquivalent: 'text-sm',
    rem: '0.875rem',
    lineHeightPx: 20,
    fontWeight: 400,
    description: '★ Default UI · tabele · listy · sidebary',
    sample: 'Maersk Line A/S · 12 450,00 PLN',
  },
  {
    name: 'body/regular/md',
    group: 'body',
    className: 'text-body-regular-md',
    tailwindEquivalent: 'text-base',
    rem: '1rem',
    lineHeightPx: 24,
    fontWeight: 400,
    description: 'Długi tekst · opisy · content areas',
    sample: 'Faktura przekazana do weryfikacji przed alokacją.',
  },
  {
    name: 'body/regular/xs',
    group: 'body',
    className: 'text-body-regular-xs',
    tailwindEquivalent: 'text-xs',
    rem: '0.75rem',
    lineHeightPx: 16,
    fontWeight: 400,
    description: 'Helper text · hint pod inputem · meta',
    sample: 'NIP musi zawierać 10 cyfr',
  },
  {
    name: 'body/medium/sm',
    group: 'body',
    className: 'text-body-medium-sm',
    tailwindEquivalent: 'text-sm font-medium',
    rem: '0.875rem',
    lineHeightPx: 20,
    fontWeight: 500,
    description: 'Emphasized body · form description',
    sample: 'Kontener przypisany do teczki',
  },
  {
    name: 'body/medium/md',
    group: 'body',
    className: 'text-body-medium-md',
    tailwindEquivalent: 'text-base font-medium',
    rem: '1rem',
    lineHeightPx: 24,
    fontWeight: 500,
    description: 'Strong body · ważny opis',
    sample: 'Actual Cost = $0 — wymaga alokacji',
  },
  {
    name: 'body/regular/2xs',
    group: 'body',
    className: 'text-body-regular-2xs',
    tailwindEquivalent: 'text-[11px]/[14px] tracking-[0.01em]',
    rem: '0.6875rem',
    lineHeightPx: 14,
    letterSpacingEm: 0.01,
    fontWeight: 400,
    description: 'DynamicTable · gęstość „dense" · komórki danych',
    restrictedTo: 'DynamicTable [data-density-level="dense"]',
    sample: 'Maersk Line A/S · 12 450,00 PLN',
  },

  // ── Label ─────────────────────────────────────────────────────────
  {
    name: 'label/semibold/xs',
    group: 'label',
    className: 'text-label-semibold-xs',
    tailwindEquivalent: 'text-xs font-semibold',
    rem: '0.75rem',
    lineHeightPx: 16,
    fontWeight: 600,
    description: 'Badge · tag · kbd · overline',
    sample: 'PRZYPISANA',
  },
  {
    name: 'label/medium/md',
    group: 'label',
    className: 'text-label-medium-md',
    tailwindEquivalent: 'text-sm font-medium',
    rem: '0.875rem',
    lineHeightPx: 20,
    fontWeight: 500,
    description: 'Chip · dropdown item · badge label',
    sample: "FCL 40'",
  },
  {
    name: 'label/semibold/2xs',
    group: 'label',
    className: 'text-label-semibold-2xs',
    tailwindEquivalent: 'text-[10px]/[12px] font-semibold tracking-[0.02em]',
    rem: '0.625rem',
    lineHeightPx: 12,
    letterSpacingEm: 0.02,
    fontWeight: 600,
    description: 'DynamicTable · gęstość „dense" · nagłówki kolumn',
    restrictedTo: 'DynamicTable [data-density-level="dense"]',
    sample: 'ETA · POD · NR KONTENERA',
  },

  // ── Caption ───────────────────────────────────────────────────────
  {
    name: 'caption/medium/lg',
    group: 'caption',
    className: 'text-caption-medium-lg',
    tailwindEquivalent: 'text-sm font-medium',
    rem: '0.875rem',
    lineHeightPx: 20,
    fontWeight: 500,
    description: 'Hint · secondary info · subtitle',
    sample: 'Przed chwilą · FV/2025/0041',
  },
  {
    name: 'caption/medium/md',
    group: 'caption',
    className: 'text-caption-medium-md',
    tailwindEquivalent: 'text-xs font-medium',
    rem: '0.75rem',
    lineHeightPx: 16,
    fontWeight: 500,
    description: 'Timestamp · status pill · meta mini',
    sample: '2025-04-15 · ETD Gdańsk',
  },

  // ── Code / Mono ───────────────────────────────────────────────────
  {
    name: 'code/regular/md',
    group: 'code',
    className: 'text-code-regular-md',
    tailwindEquivalent: 'text-sm font-mono',
    rem: '0.875rem',
    lineHeightPx: 24,
    fontWeight: 400,
    description: 'Nr kontenera · NIP · kwoty · booking ref',
    sample: 'MSCU7234561 → SPOL-2025-041',
  },
  {
    name: 'code/regular/sm',
    group: 'code',
    className: 'text-code-regular-sm',
    tailwindEquivalent: 'text-xs font-mono',
    rem: '0.75rem',
    lineHeightPx: 16,
    fontWeight: 400,
    description: 'Badge ID · kody portów · tabela ref',
    sample: 'FV/2025/0041 · 521-000-00-000',
  },
  {
    name: 'code/regular/2xs',
    group: 'code',
    className: 'text-code-regular-2xs',
    tailwindEquivalent: 'text-[11px]/[14px] font-mono tracking-[0.01em]',
    rem: '0.6875rem',
    lineHeightPx: 14,
    letterSpacingEm: 0.01,
    fontWeight: 400,
    description: 'DynamicTable · gęstość „dense" · komórki mono',
    restrictedTo: 'DynamicTable [data-density-level="dense"]',
    sample: 'MSCU7234561 · 2026-08-03',
  },
]
