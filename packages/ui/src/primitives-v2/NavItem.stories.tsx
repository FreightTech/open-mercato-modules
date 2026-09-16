import type { Meta, StoryObj } from '@storybook/react-vite'
import { Folder } from 'lucide-react'
import { NavItem } from './NavItem'

const meta: Meta<typeof NavItem> = {
  title: 'Components/NavItem',
  component: NavItem,
  parameters: {
    backgrounds: {
      default: 'figma-surface',
      values: [{ name: 'figma-surface', value: '#F8F8FA' }],
    },
    docs: {
      description: {
        component:
          'Figma: FMS-Componenets → NavItem (60:78), aligned to the current Sidebar frame. Single row in a sidebar / dropdown / nav list. States: default / hover / active (white pill, brand-blue text + icon) / disabled. Use the `render` prop to integrate with Next\'s `<Link>` without losing styling.',
      },
    },
  },
}

export default meta

type Story = StoryObj<typeof NavItem>

export const Showcase: Story = {
  name: 'NavItem',
  render: () => {
    const columns = [
      { label: 'default', extraClass: '' },
      { label: 'hover', extraClass: 'bg-sidebar-v2-accent' },
      { label: 'active', extraClass: '', isActive: true },
      { label: 'disabled', extraClass: '', disabled: true },
    ] as const
    const rows = [
      { label: 'icon, no badge', icon: <Folder />, badge: undefined as string | undefined },
      { label: 'icon + badge', icon: <Folder />, badge: '12' },
      { label: 'no icon', icon: undefined, badge: undefined as string | undefined },
      { label: 'no icon + badge', icon: undefined, badge: '12' },
    ]
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-4 gap-3 px-1 text-label-semibold-xs uppercase tracking-wider text-status-v2-neutral-text">
          {columns.map((c) => (
            <span key={c.label}>{c.label}</span>
          ))}
        </div>
        {rows.map((row) => (
          <div key={row.label} className="grid grid-cols-4 gap-3 rounded-md bg-sidebar-v2 p-2">
            {columns.map((col) => (
              <NavItem
                key={col.label}
                icon={row.icon}
                badge={row.badge}
                isActive={'isActive' in col && col.isActive}
                disabled={'disabled' in col && col.disabled}
                className={col.extraClass}
              >
                Nav item
              </NavItem>
            ))}
          </div>
        ))}
      </div>
    )
  },
}

