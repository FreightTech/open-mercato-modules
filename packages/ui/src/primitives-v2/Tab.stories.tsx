import type { Meta, StoryObj } from '@storybook/react-vite'
import * as React from 'react'
import { Tab, TabBar } from './Tab'

const meta: Meta<typeof Tab> = {
  title: 'Components/Tab',
  component: Tab,
  parameters: {
    backgrounds: {
      default: 'figma-surface',
      values: [{ name: 'figma-surface', value: '#F8F8FA' }],
    },
    docs: {
      description: {
        component:
          'Figma: FMS-Componenets → Tab (45:90) and TabBar (183:453). Active tab uses the teal `--accent-v2` (`#0D9488`) as an underline overlapping the TabBar baseline.',
      },
    },
  },
}

export default meta

type Story = StoryObj<typeof Tab>

export const Showcase: Story = {
  name: 'Tab',
  render: () => {
    const [a, setA] = React.useState('details')
    const [b, setB] = React.useState('docs')
    return (
      <div className="flex flex-col gap-8 px-6">
        <TabBar value={a} onChange={setA} ariaLabel="Tabs">
          <Tab value="details">Szczegóły</Tab>
          <Tab value="cargo">Ładunek</Tab>
          <Tab value="docs">Dokumenty</Tab>
          <Tab value="costs">Koszty</Tab>
          <Tab value="timeline">Oś czasu</Tab>
        </TabBar>

        <TabBar value={b} onChange={setB} ariaLabel="Tabs with badges">
          <Tab value="details">Szczegóły</Tab>
          <Tab value="cargo" badge="3">
            Ładunek
          </Tab>
          <Tab value="docs" badge="12">
            Dokumenty
          </Tab>
          <Tab value="costs" badge="0">
            Koszty
          </Tab>
        </TabBar>

        <div className="flex items-end gap-6 border-b border-border-v2 px-0 py-2">
          <Tab>Default</Tab>
          <Tab isActive>Active</Tab>
          <Tab disabled>Disabled</Tab>
        </div>
      </div>
    )
  },
}
