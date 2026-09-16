import type { Meta, StoryObj } from '@storybook/react-vite'
import { Toggle } from './Toggle'

const meta: Meta<typeof Toggle> = {
  title: 'Components/Toggle',
  component: Toggle,
  parameters: {
    docs: {
      description: {
        component:
          'Figma: FMS-Componenets → Toggle (45:80). Native `<input type="checkbox" role="switch">` with a styled track + thumb. Two sizes — Figma defines one, we expose `sm` and `md`.',
      },
    },
  },
}

export default meta

type Story = StoryObj<typeof Toggle>

export const Showcase: Story = {
  name: 'Toggle',
  render: () => (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Toggle label="Off (default)" />
        <Toggle label="On" defaultChecked />
        <Toggle label="Disabled (off)" disabled />
        <Toggle label="Disabled (on)" disabled defaultChecked />
      </div>
      <div className="flex items-center gap-6">
        <Toggle toggleSize="sm" label="Small" defaultChecked />
        <Toggle toggleSize="md" label="Medium (default)" defaultChecked />
      </div>
    </div>
  ),
}
