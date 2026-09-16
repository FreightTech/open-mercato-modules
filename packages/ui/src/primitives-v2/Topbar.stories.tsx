import type { Meta, StoryObj } from '@storybook/react-vite'
import { Bell, CircleHelp, Plus } from 'lucide-react'
import { Topbar } from './Topbar'
import { Breadcrumb } from './Breadcrumb'
import { SearchInput } from './SearchInput'
import { IconButton } from './IconButton'
import { Avatar } from './Avatar'
import { Badge } from './Badge'
import { Button } from './Button'

const meta: Meta<typeof Topbar> = {
  title: 'Components/Topbar',
  component: Topbar,
  parameters: {
    layout: 'fullscreen',
    backgrounds: {
      default: 'figma-surface',
      values: [{ name: 'figma-surface', value: '#F8F8FA' }],
    },
    docs: {
      description: {
        component:
          'Figma: FMS-Componenets → Topbar (150:367 — 1440×52). Three slots: `leading`, `center`, `trailing`. Composition of the other components.',
      },
    },
  },
}

export default meta

type Story = StoryObj<typeof Topbar>

export const Showcase: Story = {
  name: 'Topbar',
  render: () => (
    <Topbar
      leading={
        <Breadcrumb
          items={[
            { label: 'Faktury', href: '/invoices' },
            { label: 'FV/2025/0041' },
          ]}
        />
      }
      center={<SearchInput inputSize="sm" className="w-[280px]" placeholder="Szukaj…" shortcut="⌘K" />}
      trailing={
        <>
          <Button size="sm" icon={<Plus />}>
            Nowa faktura
          </Button>
          <span className="relative inline-flex">
            <IconButton size="sm" icon={<Bell />} aria-label="Powiadomienia" />
            <span className="absolute -right-1 -top-1">
              <Badge variant="error" size="sm">
                3
              </Badge>
            </span>
          </span>
          <IconButton size="sm" icon={<CircleHelp />} aria-label="Pomoc" />
          <Avatar size="sm" name="Karolina Firmowe" />
        </>
      }
    />
  ),
}
