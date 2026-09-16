import type { Meta, StoryObj } from '@storybook/react-vite'
import * as React from 'react'
import { Badge, type BadgeVariant } from './Badge'

const meta: Meta<typeof Badge> = {
  title: 'Components/Badge',
  component: Badge,
  parameters: {
    backgrounds: {
      default: 'figma-surface',
      values: [{ name: 'figma-surface', value: '#F8F8FA' }],
    },
    docs: {
      description: {
        component:
          'Figma: FMS-Componenets → Badge (45:26). 12 variants × 2 sizes. Colors come from the `-v2` status palette (extracted from Figma). Use `Tag` for filter chips, `Badge` for short status/count pills.',
      },
    },
  },
}

export default meta

type Story = StoryObj<typeof Badge>

const VARIANTS: BadgeVariant[] = [
  'neutral',
  'primary',
  'outline',
  'success',
  'error',
  'warning',
  'info',
  'purple',
  'teal',
  'orange',
  'sky',
  'rose',
]

export const Showcase: Story = {
  name: 'Badge',
  render: () => (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-[80px_repeat(2,_auto)] items-center gap-x-6 gap-y-3">
        <span />
        <span className="text-label-semibold-xs uppercase tracking-wider text-status-v2-neutral-text">sm</span>
        <span className="text-label-semibold-xs uppercase tracking-wider text-status-v2-neutral-text">md</span>
        {VARIANTS.map((v) => (
          <React.Fragment key={v}>
            <span className="text-label-medium-md text-foreground-v2">{v}</span>
            <Badge size="sm" variant={v}>
              Label
            </Badge>
            <Badge size="md" variant={v}>
              Label
            </Badge>
          </React.Fragment>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="success" withDot>
          Online
        </Badge>
        <Badge variant="warning" withDot>
          Przekroczony termin
        </Badge>
        <Badge variant="error" withDot>
          Zablokowany
        </Badge>
        <span className="inline-flex items-center gap-2 text-body-regular-sm text-foreground-v2">
          Faktury <Badge variant="primary">12</Badge>
        </span>
        <span className="inline-flex items-center gap-2 text-body-regular-sm text-foreground-v2">
          Powiadomienia <Badge variant="error">99+</Badge>
        </span>
      </div>
    </div>
  ),
}
