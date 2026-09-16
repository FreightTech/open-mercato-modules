import type { Meta, StoryObj } from '@storybook/react-vite'
import * as React from 'react'
import { SearchInput } from './SearchInput'

const meta: Meta<typeof SearchInput> = {
  title: 'Components/SearchInput',
  component: SearchInput,
  parameters: {
    docs: {
      description: {
        component:
          'Figma: FMS-Componenets → SearchInput (149:375). Specialization of `Input` with a search icon on the left and an inline clear "×" on the right (visible when there\'s a value AND an `onClear` handler).',
      },
    },
  },
}

export default meta

type Story = StoryObj<typeof SearchInput>

function Controlled() {
  const [value, setValue] = React.useState('FV/2025/0041')
  return (
    <SearchInput
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onClear={() => setValue('')}
      placeholder="Z przyciskiem clear"
    />
  )
}

export const Showcase: Story = {
  name: 'SearchInput',
  render: () => (
    <div className="flex w-[420px] flex-col gap-3">
      <SearchInput placeholder="Default — pusty" />
      <SearchInput defaultValue="Maersk" placeholder="Z wpisanym tekstem" />
      <Controlled />
      <SearchInput defaultValue="Tylko do odczytu" disabled />
    </div>
  ),
}
