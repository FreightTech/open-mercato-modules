import type { Meta, StoryObj } from '@storybook/react-vite'
import {
  TYPOGRAPHY_GROUPS,
  TYPOGRAPHY_TOKENS,
  type TypographyGroup,
  type TypographyToken,
} from './typography.tokens'

const meta: Meta = {
  title: 'Foundation/Typography',
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'FMS Foundation — Typography. Mirrors the "🔤 Typography System" page in the Figma "FMS-Foundation" file. 20 named text utilities, registered via Tailwind v4 `@theme` in `packages/ui/src/theme/typography.css`.',
      },
    },
  },
}

export default meta

type Story = StoryObj

function GroupedTable({ group }: { group: TypographyGroup }) {
  const rows = TYPOGRAPHY_TOKENS.filter((t) => t.group === group)
  const { label, subtitle } = TYPOGRAPHY_GROUPS[group]
  return (
    <section className="mb-10">
      <header className="mb-3 flex items-baseline gap-3 border-b border-zinc-200 pb-2">
        <h2 className="text-heading-semibold-md uppercase tracking-wider text-zinc-700">{label}</h2>
        <span className="text-body-regular-xs text-zinc-500">{subtitle}</span>
      </header>
      <table className="w-full table-fixed border-collapse">
        <thead>
          <tr className="text-label-semibold-xs uppercase tracking-wider text-zinc-500">
            <th className="w-[12rem] py-2 pr-3 text-left">Style</th>
            <th className="w-[14rem] py-2 pr-3 text-left">Token</th>
            <th className="w-[5rem] py-2 pr-3 text-left">Rem</th>
            <th className="w-[18rem] py-2 pr-3 text-left">Description</th>
            <th className="py-2 text-left">Demo</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <TokenRow key={row.name} row={row} />
          ))}
        </tbody>
      </table>
    </section>
  )
}

function TokenRow({ row }: { row: TypographyToken }) {
  return (
    <tr className="border-t border-zinc-100 align-top">
      <td className="py-3 pr-3">
        <div className="text-body-medium-sm text-zinc-900">
          {row.name.split('/').slice(1).join('/')}
        </div>
        <div className="text-caption-medium-md text-zinc-500">{row.group}</div>
      </td>
      <td className="py-3 pr-3">
        <code className="text-code-regular-sm rounded bg-zinc-100 px-1.5 py-0.5 text-zinc-700">
          {row.className}
        </code>
        <div className="mt-1 text-caption-medium-md text-zinc-500">
          ≈ {row.tailwindEquivalent}
        </div>
      </td>
      <td className="py-3 pr-3">
        <code className="text-code-regular-sm text-zinc-700">{row.rem}</code>
        <div className="mt-1 text-caption-medium-md text-zinc-500">
          {row.lineHeightPx}px · {row.fontWeight}
        </div>
      </td>
      <td className="py-3 pr-3">
        <span className="text-body-regular-xs text-zinc-600">{row.description}</span>
      </td>
      <td className="py-3">
        <span className={row.className}>{row.sample}</span>
      </td>
    </tr>
  )
}

export const Typography: Story = {
  name: 'Typography',
  render: () => (
    <div className="mx-auto max-w-[1184px] px-6 py-8">
      <header className="mb-8">
        <h1 className="text-heading-bold-2xl text-zinc-900">Typography System</h1>
        <p className="mt-1 text-body-regular-sm text-zinc-600">
          {TYPOGRAPHY_TOKENS.length} styles · Geist + Geist Mono · bound to <code className="text-code-regular-sm">font/family</code> &amp;{' '}
          <code className="text-code-regular-sm">font/scale</code>
        </p>
      </header>
      {(Object.keys(TYPOGRAPHY_GROUPS) as TypographyGroup[]).map((g) => (
        <GroupedTable key={g} group={g} />
      ))}
    </div>
  ),
}

export const LiveSample: Story = {
  name: 'Live sample · invoice card',
  parameters: {
    docs: {
      description: {
        story:
          'Realistic composition showing how the tokens stack on a single screen (invoice header card).',
      },
    },
  },
  render: () => (
    <div className="mx-auto max-w-[640px] px-6 py-8">
      <article className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <span className="text-label-semibold-xs rounded bg-emerald-50 px-2 py-1 uppercase tracking-wider text-emerald-700">
            Przypisana
          </span>
          <span className="text-caption-medium-md text-zinc-500">2025-04-15 · ETD Gdańsk</span>
        </div>
        <h1 className="text-heading-bold-2xl text-zinc-900">Faktury przychodzące</h1>
        <h2 className="mt-1 text-heading-semibold-md text-zinc-700">Kontrahent · Maersk Line A/S</h2>

        <p className="mt-4 text-body-regular-md text-zinc-700">
          Faktura przekazana do weryfikacji przed alokacją.
        </p>

        <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-3">
          <div>
            <dt className="text-label-medium-md text-zinc-500">Numer faktury</dt>
            <dd className="text-code-regular-md text-zinc-900">FV/2025/0041</dd>
          </div>
          <div>
            <dt className="text-label-medium-md text-zinc-500">Kwota</dt>
            <dd className="text-body-medium-md text-zinc-900">12 450,00 PLN</dd>
          </div>
          <div>
            <dt className="text-label-medium-md text-zinc-500">Kontener</dt>
            <dd className="text-code-regular-md text-zinc-900">MSCU7234561</dd>
          </div>
          <div>
            <dt className="text-label-medium-md text-zinc-500">Teczka</dt>
            <dd className="text-code-regular-md text-zinc-900">SPOL-2025-041</dd>
          </div>
        </dl>

        <p className="mt-4 text-body-regular-xs text-zinc-500">
          NIP musi zawierać 10 cyfr.
        </p>
      </article>
    </div>
  ),
}
