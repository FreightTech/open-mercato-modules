import type { Meta, StoryObj } from '@storybook/react-vite'
import { Tag } from './Tag'

const meta: Meta<typeof Tag> = {
  title: 'Components/Tag',
  component: Tag,
  parameters: {
    backgrounds: {
      default: 'figma-surface',
      values: [{ name: 'figma-surface', value: '#F8F8FA' }],
    },
    docs: {
      description: {
        component:
          'Figma: FMS-Componenets → Tag (46:38). Three **identity** variants (`default`, `container`, `teczka`) plus six additive **status-color** variants (`success`, `error`, `warning`, `info`, `purple`, `orange`) that reuse the `--status-v2-*` palette so the same chip shape can render status pills (e.g. `Loaded`, `Przeterminowana`). Each can be `removable` via `onRemove`. `size`: `sm` (12 px / 2 px padding — used in dense rows) or `md` (13 px / 3 px — the Figma default).',
      },
    },
  },
}

export default meta

type Story = StoryObj<typeof Tag>

export const Showcase: Story = {
  name: 'All variants',
  render: () => (
    <div className="space-y-8">
      <Section
        title="Identity (Figma source)"
        subtitle="default · container · teczka — paired with their removable state"
      >
        <Row label="default">
          <Tag variant="default">FCL 40&apos;</Tag>
          <Tag variant="default" onRemove={() => {}}>FCL 40&apos;</Tag>
        </Row>
        <Row label="container">
          <Tag variant="container">MSCU7234561</Tag>
          <Tag variant="container" onRemove={() => {}}>MSCU7234561</Tag>
        </Row>
        <Row label="teczka">
          <Tag variant="teczka">SPOL-2025-041</Tag>
          <Tag variant="teczka" onRemove={() => {}}>SPOL-2025-041</Tag>
        </Row>
      </Section>

      <Section
        title="Status colors (additive)"
        subtitle="Reuse the `--status-v2-*` palette so the same chip shape covers status pills."
      >
        <Row label="success">
          <Tag variant="success">Załadowany</Tag>
          <Tag variant="success" size="sm">Zapłacona</Tag>
        </Row>
        <Row label="error">
          <Tag variant="error">Przeterminowana</Tag>
          <Tag variant="error" size="sm">Failed</Tag>
        </Row>
        <Row label="warning">
          <Tag variant="warning">Oczekuje</Tag>
          <Tag variant="warning" size="sm">Partial</Tag>
        </Row>
        <Row label="info">
          <Tag variant="info">Planowanie</Tag>
          <Tag variant="info" size="sm">Estimated</Tag>
        </Row>
        <Row label="purple">
          <Tag variant="purple">Estimated</Tag>
          <Tag variant="purple" size="sm">Invoiced</Tag>
        </Row>
        <Row label="orange">
          <Tag variant="orange">Partially Delivered</Tag>
          <Tag variant="orange" size="sm">In Transit</Tag>
        </Row>
      </Section>

      <Section
        title="Size"
        subtitle="`md` (Figma default, 13 px / 3 px padding) vs `sm` (compact, 12 px / 2 px padding)."
      >
        <Row label="md">
          <Tag variant="default" size="md">IMPORT</Tag>
          <Tag variant="success" size="md">Załadowany</Tag>
          <Tag variant="container" size="md">MSCU7234561</Tag>
        </Row>
        <Row label="sm">
          <Tag variant="default" size="sm">IMPORT</Tag>
          <Tag variant="success" size="sm">Załadowany</Tag>
          <Tag variant="container" size="sm">MSCU7234561</Tag>
        </Row>
      </Section>
    </div>
  ),
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle: string
  children: React.ReactNode
}) {
  return (
    <div>
      <h3 className="text-heading-semibold-md text-foreground-v2 mb-1">{title}</h3>
      <p className="text-body-regular-xs text-status-v2-neutral-text mb-3">{subtitle}</p>
      <div className="grid grid-cols-[100px_minmax(0,1fr)] items-center gap-x-6 gap-y-2.5">
        {children}
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <span className="text-label-medium-md text-foreground-v2">{label}</span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </>
  )
}
