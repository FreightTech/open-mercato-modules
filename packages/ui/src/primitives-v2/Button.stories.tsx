import type { Meta, StoryObj } from '@storybook/react-vite'
import { Plus, ArrowRight, Trash2 } from 'lucide-react'
import { Button, type ButtonVariant, type ButtonSize } from './Button'

const meta: Meta<typeof Button> = {
  title: 'Components/Button',
  component: Button,
  parameters: {
    backgrounds: {
      default: 'figma-surface',
      values: [{ name: 'figma-surface', value: '#F8F8FA' }],
    },
    docs: {
      description: {
        component:
          'Figma: FMS-Componenets → Button (44:92). Colors come from the `-v2` token set in `tokens.css`, extracted directly from each Figma variant. Hover, focus, and disabled use CSS pseudo-classes — interact with the rendered buttons to see them.',
      },
    },
  },
}

export default meta

type Story = StoryObj<typeof Button>

const VARIANTS: ButtonVariant[] = ['primary', 'secondary', 'outline', 'ghost', 'destructive']
const SIZES: ButtonSize[] = ['sm', 'md', 'lg']

export const Showcase: Story = {
  name: 'Button',
  render: () => (
    <div className="flex flex-col gap-6">
      <table className="border-separate border-spacing-x-4 border-spacing-y-3">
        <thead>
          <tr className="text-label-semibold-xs uppercase tracking-wider text-muted-v2-foreground">
            <th className="text-left">Variant ↓ / Size →</th>
            {SIZES.map((s) => (
              <th key={s} className="text-left">
                {s}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {VARIANTS.map((v) => (
            <tr key={v}>
              <td className="text-label-medium-md text-foreground-v2">{v}</td>
              {SIZES.map((s) => (
                <td key={s}>
                  <Button variant={v} size={s}>
                    {v}
                  </Button>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap items-center gap-3">
        <Button icon={<Plus />}>Dodaj fakturę</Button>
        <Button variant="outline" icon={<ArrowRight />} iconPosition="right">
          Dalej
        </Button>
        <Button variant="ghost" iconOnly icon={<Plus />} aria-label="Dodaj" />
        <Button variant="destructive" icon={<Trash2 />}>
          Usuń
        </Button>
        <Button disabled>Disabled</Button>
      </div>
    </div>
  ),
}
