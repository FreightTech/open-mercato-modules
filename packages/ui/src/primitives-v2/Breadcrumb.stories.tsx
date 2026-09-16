import type { Meta, StoryObj } from '@storybook/react-vite'
import { Breadcrumb } from './Breadcrumb'

const meta: Meta<typeof Breadcrumb> = {
  title: 'Components/Breadcrumb',
  component: Breadcrumb,
  parameters: {
    docs: {
      description: {
        component:
          'Figma: FMS-Componenets → Breadcrumb (148:411). Variants are by depth — the same component handles any number of crumbs and auto-collapses long trails with an ellipsis.',
      },
    },
  },
}

export default meta

type Story = StoryObj<typeof Breadcrumb>

export const Showcase: Story = {
  name: 'Breadcrumb',
  render: () => (
    <div className="flex flex-col gap-3">
      <Breadcrumb items={[{ label: 'Dashboard' }]} />
      <Breadcrumb
        items={[
          { label: 'Faktury', href: '/invoices' },
          { label: 'FV/2025/0041' },
        ]}
      />
      <Breadcrumb
        items={[
          { label: 'Teczki', href: '/folders' },
          { label: 'SPOL-2025-041', href: '/folders/spol-2025-041' },
          { label: 'Faktury' },
        ]}
      />
      <Breadcrumb
        items={[
          { label: 'Teczki', href: '/folders' },
          { label: 'SPOL-2025-041', href: '/folders/spol-2025-041' },
          { label: 'Faktury', href: '/folders/spol-2025-041/invoices' },
          { label: 'FV/2025/0041' },
        ]}
      />
      <Breadcrumb
        maxItems={4}
        items={[
          { label: 'Workspace', href: '/' },
          { label: 'Klienci', href: '/clients' },
          { label: 'Maersk Line A/S', href: '/clients/maersk' },
          { label: 'Teczki', href: '/clients/maersk/folders' },
          { label: 'SPOL-2025-041', href: '/folders/spol-2025-041' },
          { label: 'Faktury', href: '/folders/spol-2025-041/invoices' },
          { label: 'FV/2025/0041' },
        ]}
      />
    </div>
  ),
}
