import type { Meta, StoryObj } from '@storybook/react-vite'
import { Folder, FileText, Truck, BarChart3, PanelLeftClose } from 'lucide-react'
import { Sidebar, SidebarHeader, SidebarFooter } from './Sidebar'
import { NavGroup } from './NavGroup'
import { NavItem } from './NavItem'
import { Avatar } from './Avatar'

const meta: Meta<typeof Sidebar> = {
  title: 'Components/Sidebar',
  component: Sidebar,
  parameters: {
    layout: 'fullscreen',
    backgrounds: {
      default: 'figma-surface',
      values: [{ name: 'figma-surface', value: '#F8F8FA' }],
    },
    docs: {
      description: {
        component:
          'Figma sources: SidebarHeader (112:110), SidebarFooter (112:117), Sidebar shell (137:354 — 220×900). Three slots: `header`, scrollable body (children), `footer`. Compose with `NavGroup` + `NavItem`.',
      },
    },
  },
}

export default meta

type Story = StoryObj<typeof Sidebar>

const BrandMark = () => (
  <span
    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-dashed border-border-v2-strong bg-secondary-v2 text-[10px] text-muted-v2-foreground"
    aria-hidden="true"
  >
    img
  </span>
)

const CollapseToggle = () => (
  <button
    type="button"
    aria-label="Zwiń pasek boczny"
    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-v2-foreground hover:bg-sidebar-v2-accent hover:text-foreground-v2 transition-colors"
  >
    <PanelLeftClose className="h-4 w-4" />
  </button>
)

export const Showcase: Story = {
  name: 'Sidebar',
  render: () => (
    <div className="h-[900px]">
      <Sidebar
        header={<SidebarHeader logo={<BrandMark />} title="FreightTech FMS" trailing={<CollapseToggle />} />}
        footer={
          <SidebarFooter>
            <div className="flex items-center gap-2 px-2 py-1.5">
              <Avatar size="sm" name="Karolina Firmowe" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-body-medium-sm text-sidebar-v2-foreground">Karolina Firmowe</div>
                <div className="truncate text-caption-medium-md text-muted-v2-foreground">karolina@example.com</div>
              </div>
            </div>
          </SidebarFooter>
        }
      >
        <NavGroup title="Workspace">
          <NavItem icon={<BarChart3 />} isActive>
            Pulpit
          </NavItem>
          <NavItem icon={<FileText />} badge="3">
            Powiadomienia
          </NavItem>
        </NavGroup>
        <NavGroup title="Operacje">
          <NavItem icon={<Folder />} badge="248">
            Teczki
          </NavItem>
          <NavItem icon={<FileText />} badge="12">
            Faktury
          </NavItem>
          <NavItem icon={<Truck />}>Transporty</NavItem>
        </NavGroup>
        <NavGroup title="Archiwum" defaultCollapsed>
          <NavItem>2024</NavItem>
          <NavItem>2023</NavItem>
        </NavGroup>
      </Sidebar>
    </div>
  ),
}
