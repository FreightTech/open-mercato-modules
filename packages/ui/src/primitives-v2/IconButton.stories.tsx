import type { Meta, StoryObj } from '@storybook/react-vite'
import { MoreHorizontal, Trash2, Pencil } from 'lucide-react'
import { IconButton } from './IconButton'

const meta: Meta<typeof IconButton> = {
  title: 'Components/IconButton',
  component: IconButton,
  parameters: {
    docs: {
      description: {
        component:
          'Figma: FMS-Componenets → IconButton (148:377). Square button for icon-only actions (close, more, sort). Inherits all visual states from `Button`. **Always pass `aria-label`** — there is no visible text.',
      },
    },
  },
}

export default meta

type Story = StoryObj<typeof IconButton>

export const Showcase: Story = {
  name: 'IconButton',
  render: () => (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <IconButton variant="primary" icon={<Pencil />} aria-label="Edytuj" />
        <IconButton variant="secondary" icon={<Pencil />} aria-label="Edytuj" />
        <IconButton variant="outline" icon={<Pencil />} aria-label="Edytuj" />
        <IconButton variant="ghost" icon={<Pencil />} aria-label="Edytuj" />
        <IconButton variant="destructive" icon={<Trash2 />} aria-label="Usuń" />
      </div>
      <div className="flex items-center gap-3">
        <IconButton size="sm" icon={<MoreHorizontal />} aria-label="Więcej" />
        <IconButton size="md" icon={<MoreHorizontal />} aria-label="Więcej" />
        <IconButton size="lg" icon={<MoreHorizontal />} aria-label="Więcej" />
      </div>
    </div>
  ),
}
