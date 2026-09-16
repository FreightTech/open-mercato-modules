import type { Meta, StoryObj } from '@storybook/react-vite'
import { Folder, FileText, Truck } from 'lucide-react'
import { NavGroup } from './NavGroup'
import { NavItem } from './NavItem'

const meta: Meta<typeof NavGroup> = {
  title: 'Components/NavGroup',
  component: NavGroup,
  parameters: {
    docs: {
      description: {
        component:
          'Figma: FMS-Componenets → NavGroup (72:154). Section header + collapsible list of `NavItem`s. Figma\'s 10 boolean `itemN_show` flags become plain React children — pass any number of items.',
      },
    },
  },
}

export default meta

type Story = StoryObj<typeof NavGroup>

export const Showcase: Story = {
  name: 'NavGroup',
  render: () => (
    <div className="w-[240px] rounded-md bg-sidebar-v2 p-2">
      <div className="flex flex-col gap-3">
        <NavGroup title="Workspace">
          <NavItem icon={<Folder />} isActive>
            Pulpit
          </NavItem>
          <NavItem icon={<FileText />} badge="3">
            Powiadomienia
          </NavItem>
        </NavGroup>
        <NavGroup title="Operacje">
          <NavItem icon={<Folder />}>Teczki</NavItem>
          <NavItem icon={<FileText />} badge="12">
            Faktury
          </NavItem>
          <NavItem icon={<Truck />}>Transporty</NavItem>
        </NavGroup>
        <NavGroup title="Archiwum" defaultCollapsed>
          <NavItem>2024</NavItem>
          <NavItem>2023</NavItem>
        </NavGroup>
      </div>
    </div>
  ),
}
