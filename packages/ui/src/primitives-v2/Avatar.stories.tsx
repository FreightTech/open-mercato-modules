import type { Meta, StoryObj } from '@storybook/react-vite'
import { User } from 'lucide-react'
import { Avatar, AvatarStack } from './Avatar'

const meta: Meta<typeof Avatar> = {
  title: 'Components/Avatar',
  component: Avatar,
  parameters: {
    docs: {
      description: {
        component:
          'Figma: FMS-Componenets → Avatar (46:67). Size × type matrix (image · initials · icon · placeholder). Falls back to initials on image load failure.',
      },
    },
  },
}

export default meta

type Story = StoryObj<typeof Avatar>

export const Showcase: Story = {
  name: 'Avatar',
  render: () => (
    <div className="flex flex-col gap-8">
      <div className="flex items-center gap-4">
        <Avatar size="xs" name="Anna Kowalska" />
        <Avatar size="sm" name="Anna Kowalska" />
        <Avatar size="md" name="Anna Kowalska" />
        <Avatar size="lg" name="Anna Kowalska" />
        <Avatar size="xl" name="Anna Kowalska" />
      </div>
      <div className="flex items-center gap-4">
        <div className="flex flex-col items-center gap-2 text-caption-medium-md text-muted-v2-foreground">
          <Avatar size="lg" src="https://i.pravatar.cc/120?img=12" name="Anna Kowalska" />
          Image
        </div>
        <div className="flex flex-col items-center gap-2 text-caption-medium-md text-muted-v2-foreground">
          <Avatar size="lg" name="Anna Kowalska" />
          Initials
        </div>
        <div className="flex flex-col items-center gap-2 text-caption-medium-md text-muted-v2-foreground">
          <Avatar size="lg" icon={<User />} />
          Icon
        </div>
        <div className="flex flex-col items-center gap-2 text-caption-medium-md text-muted-v2-foreground">
          <Avatar size="lg" />
          Placeholder
        </div>
      </div>
      <AvatarStack size="md" max={3}>
        <Avatar name="Anna Kowalska" />
        <Avatar name="Bartek Lipiński" />
        <Avatar name="Cezary Mróz" />
        <Avatar name="Dorota Nowak" />
        <Avatar name="Edward O." />
      </AvatarStack>
    </div>
  ),
}
