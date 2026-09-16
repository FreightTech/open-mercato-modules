import * as React from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import {
  Boxes,
  ClipboardList,
  FileText,
  Folder,
  LayoutGrid,
  MapPin,
  PackageOpen,
  Truck,
  Users,
} from 'lucide-react'
import { Sidebar, type SidebarGroup } from './Sidebar'

/*
  Figma parity story for the backend admin sidebar — mirrors the
  Sidebar frame (137:354). Two LABEL groups with a dotted divider,
  active "Pliki" row, footer holding Settings + "Dostosuj pasek boczny".
  See spec `.ai/specs/2026-05-25-sidebar-redesign.md`.
*/

const meta: Meta<typeof Sidebar> = {
  title: 'Backend/Sidebar',
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
          'Pure-presentational sidebar composed from `primitives-v2`. Owned state (collapse, openGroups, customizing, customizationEditor JSX) is passed in by `AppShell` (or any Tier-3 consumer). Three layouts: full 240px (default), compact 72px icon rail, or 320px while customizing. Three modes: `main`, `settings`, `profile`.',
      },
    },
  },
}

export default meta

type Story = StoryObj<typeof Sidebar>

const BrandMark = (
  <span
    aria-hidden="true"
    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-sidebar-v2-accent text-xs text-sidebar-v2-muted"
  >
    FT
  </span>
)

const items = [
  { id: 'back-office', href: '/backend/back-office', title: 'Back Office', icon: <LayoutGrid /> },
  { id: 'tasks', href: '/backend/tasks', title: 'Tablica zadań', icon: <ClipboardList /> },
  { id: 'products', href: '/backend/products', title: 'Produkty', icon: <Boxes /> },
  { id: 'offers', href: '/backend/offers', title: 'Oferty', icon: <FileText /> },
  { id: 'files', href: '/backend/files', title: 'Pliki', icon: <Folder /> },
  { id: 'transports', href: '/backend/transports', title: 'Transporty', icon: <Truck /> },
  { id: 'contractors', href: '/backend/contractors', title: 'Kontrahenci', icon: <Users /> },
  { id: 'locations', href: '/backend/locations', title: 'Lokalizacje', icon: <MapPin /> },
  { id: 'loading', href: '/backend/loading', title: 'Planowanie załadunku', icon: <PackageOpen /> },
  { id: 'carriers', href: '/backend/carriers', title: 'Przewoźnicy', icon: <Truck /> },
]

const groups: SidebarGroup[] = [
  { id: 'workspace', name: 'LABEL', items },
  { id: 'operations', name: 'LABEL', items: items.map((i) => ({ ...i, id: `${i.id}-2` })) },
]

function Frame({ children, height = 900 }: { children: React.ReactNode; height?: number }) {
  return (
    <div className="bg-[#F8F8FA] p-4" style={{ height }}>
      <div className="flex h-full">{children}</div>
    </div>
  )
}

export const Showcase: Story = {
  name: 'Sidebar — Figma parity',
  render: () => (
    <Frame>
      <Sidebar
        mode="main"
        compact={false}
        pathname="/backend/files"
        brand={{ logo: BrandMark, title: 'FreightTech', href: '/backend', ariaLabel: 'Dashboard' }}
        groups={groups}
        openGroups={{ workspace: true, operations: true }}
        onToggleGroup={() => {}}
        settingsLabel="Ustawienia"
        customizeLabel="Dostosuj pasek boczny"
        onCustomize={() => {}}
        collapseLabel="Zwiń pasek boczny"
        onCollapseToggle={() => {}}
      />
    </Frame>
  ),
}

export const Compact: Story = {
  name: 'Sidebar — compact rail (72px)',
  render: () => (
    <Frame>
      <Sidebar
        mode="main"
        compact={true}
        pathname="/backend/files"
        brand={{ logo: BrandMark, ariaLabel: 'Dashboard', href: '/backend' }}
        groups={groups}
        openGroups={{ workspace: true, operations: true }}
        settingsLabel="Ustawienia"
        customizeLabel="Dostosuj pasek boczny"
        onCustomize={() => {}}
        collapseLabel="Rozwiń pasek boczny"
        onCollapseToggle={() => {}}
      />
    </Frame>
  ),
}

export const SettingsMode: Story = {
  name: 'Sidebar — settings mode',
  render: () => (
    <Frame>
      <Sidebar
        mode="settings"
        compact={false}
        pathname="/backend/settings/users"
        brand={{ logo: BrandMark, title: 'FreightTech', href: '/backend', ariaLabel: 'Dashboard' }}
        sectionTitle="Ustawienia"
        backHref="/backend"
        backLabel="Ustawienia"
        sections={[
          {
            id: 'system',
            label: 'System',
            order: 1,
            items: [
              { id: 'users', label: 'Użytkownicy', href: '/backend/settings/users', icon: <Users /> },
              { id: 'roles', label: 'Role', href: '/backend/settings/roles', icon: <Users /> },
            ],
          },
          {
            id: 'data',
            label: 'Dane',
            order: 2,
            items: [
              { id: 'entities', label: 'Encje', href: '/backend/settings/entities', icon: <Boxes /> },
            ],
          },
        ]}
      />
    </Frame>
  ),
}

export const Customizing: Story = {
  name: 'Sidebar — customizing (320px)',
  render: () => (
    <Frame>
      <Sidebar
        mode="main"
        compact={false}
        pathname="/backend/files"
        brand={{ logo: BrandMark, title: 'FreightTech', href: '/backend', ariaLabel: 'Dashboard' }}
        groups={groups}
        openGroups={{ workspace: true, operations: true }}
        customizing
        customizationEditor={
          <div className="flex flex-col gap-3 rounded-lg border border-dashed border-sidebar-v2-border bg-sidebar-v2-accent/40 p-4 text-body-medium-sm text-sidebar-v2-item-foreground">
            <div className="font-semibold">Personalizuj sidebar</div>
            <p>
              The customization editor JSX is owned by <code>AppShell</code> — this story renders a
              placeholder. The shell switches to 320 px and replaces the nav with this slot.
            </p>
          </div>
        }
      />
    </Frame>
  ),
}
