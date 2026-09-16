import type { Meta, StoryObj } from '@storybook/react-vite'
import { Checkbox } from './Checkbox'

const meta: Meta<typeof Checkbox> = {
  title: 'Components/Checkbox',
  component: Checkbox,
  parameters: {
    docs: {
      description: {
        component:
          'Figma: FMS-Componenets → Checkbox (45:73). Native input with custom paint. Focus and hover are CSS pseudo-classes — interact with the rendered element to see them.',
      },
    },
  },
}

export default meta

type Story = StoryObj<typeof Checkbox>

export const Showcase: Story = {
  name: 'Checkbox',
  render: () => (
    <div className="flex flex-col gap-3">
      <Checkbox label="Unchecked" />
      <Checkbox label="Checked" defaultChecked />
      <Checkbox label="Indeterminate" indeterminate />
      <Checkbox label="Disabled (unchecked)" disabled />
      <Checkbox label="Disabled (checked)" disabled defaultChecked />
      <Checkbox label="Error" hasError />
      <Checkbox label="Error + checked" hasError defaultChecked />
    </div>
  ),
}
