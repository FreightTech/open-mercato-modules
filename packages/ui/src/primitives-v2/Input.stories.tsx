import type { Meta, StoryObj } from '@storybook/react-vite'
import { Search } from 'lucide-react'
import { Input } from './Input'

const meta: Meta<typeof Input> = {
  title: 'Components/Input',
  component: Input,
  parameters: {
    backgrounds: {
      default: 'figma-surface',
      values: [{ name: 'figma-surface', value: '#F8F8FA' }],
    },
    docs: {
      description: {
        component:
          'Figma: FMS-Componenets → Input (147:379). 5 states × 2 sizes in Figma (we add `lg` for parity with Button). **Focus border is teal `#0D9488`**, not navy — a deliberate accent. Tab into a field to see it.',
      },
    },
  },
}

export default meta

type Story = StoryObj<typeof Input>

export const Showcase: Story = {
  name: 'Input',
  render: () => (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-[100px_repeat(2,_minmax(240px,_auto))] items-center gap-x-4 gap-y-3">
        <span />
        <span className="text-label-semibold-xs uppercase tracking-wider text-status-v2-neutral-text">sm</span>
        <span className="text-label-semibold-xs uppercase tracking-wider text-status-v2-neutral-text">md</span>

        <span className="text-label-medium-md text-foreground-v2">default</span>
        <Input inputSize="sm" placeholder="Placeholder..." />
        <Input inputSize="md" placeholder="Placeholder..." />

        <span className="text-label-medium-md text-foreground-v2">filled</span>
        <Input inputSize="sm" defaultValue="Wartość" />
        <Input inputSize="md" defaultValue="Wartość" />

        <span className="text-label-medium-md text-foreground-v2">error</span>
        <Input inputSize="sm" defaultValue="Niepoprawna wartość" hasError />
        <Input inputSize="md" defaultValue="Niepoprawna wartość" hasError />

        <span className="text-label-medium-md text-foreground-v2">disabled</span>
        <Input inputSize="sm" defaultValue="Wyłączone" disabled />
        <Input inputSize="md" defaultValue="Wyłączone" disabled />
      </div>
      <div className="flex w-[420px] flex-col gap-3">
        <Input placeholder="Szukaj kontrahenta…" leftAddon={<Search />} />
        <Input
          defaultValue="12 450,00"
          rightAddon={<span className="text-body-regular-sm text-muted-v2-foreground">PLN</span>}
        />
      </div>
    </div>
  ),
}
