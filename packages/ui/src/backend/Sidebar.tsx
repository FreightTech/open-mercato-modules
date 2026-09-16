"use client"
import * as React from 'react'
import Link from 'next/link'
import { ChevronLeft, PanelLeftOpen, Settings as SettingsIcon, Sparkles, Square } from 'lucide-react'
import { NavGroup } from '../primitives-v2/NavGroup'
import { NavItem } from '../primitives-v2/NavItem'
// The low-level shell from `primitives-v2` is imported under an alias so this
// file's own `Sidebar` export doesn't collide with it. Both names are valid
// — pick the import path that matches the abstraction level you need:
//   `@freighttech/ui`              → this `Sidebar` (full backend composition)
//   `@freighttech/ui/primitives-v2` → `Sidebar`     (240px shell only)
import {
  Sidebar as SidebarShell,
  SidebarFooter as SidebarShellFooter,
  SidebarHeader as SidebarShellHeader,
} from '../primitives-v2/Sidebar'
import { cn } from '../primitives-v2/utils'

/*
  Backend admin sidebar shell, composed from `primitives-v2`. This is the
  pure-presentational layer used by `AppShell` (and consumable by Tier-3
  customer apps standalone). All state — open groups, collapse, mode
  switching, customization — is owned by the caller and threaded in via
  props / slots.

  Three layouts are supported via `compact` / `customizing`:
    - default (240px): full `SidebarShell` with `NavGroup` + `NavItem` body
    - compact  (72px): hand-rendered icon-only rail
    - customizing (320px): default shell with the `customizationEditor`
      slot rendered in place of the nav

  And three navigation modes via `mode`:
    - 'main'     — `groups` + `openGroups` drive a collapsible group list,
                   followed by a footer with Settings + Customize buttons
    - 'settings' — `sections` render with a "← Settings" back link to /backend
    - 'profile'  — same shape as 'settings', but for the profile shell

  See spec `.ai/specs/2026-05-25-sidebar-redesign.md`.
*/

export type SidebarItem = {
  id?: string
  href: string
  title: string
  icon?: React.ReactNode
  badge?: React.ReactNode
  enabled?: boolean
  hidden?: boolean
  children?: SidebarItem[]
}

export type SidebarGroup = {
  id: string
  name: string
  items: SidebarItem[]
}

export type SidebarSectionItem = {
  id: string
  label: string
  href: string
  icon?: React.ReactNode
  order?: number
  children?: SidebarSectionItem[]
}

export type SidebarSection = {
  id: string
  label: string
  items: SidebarSectionItem[]
  order?: number
}

export type SidebarBrand = {
  /** Brand mark / logo. Rendered as-is (e.g. a Next `<Image>`). */
  logo?: React.ReactNode
  /** Product / workspace name shown next to the logo. */
  title?: React.ReactNode
  /** Link target for the header. Defaults to `/backend`. */
  href?: string
  /** Accessible label for the brand link. */
  ariaLabel?: string
}

export type SidebarProps = {
  mode: 'main' | 'settings' | 'profile'
  /** Whether to render the 72px icon-only rail instead of the 240px shell. */
  compact: boolean
  /** Suppress the SidebarHeader (mobile drawer renders its own brand row). */
  hideHeader?: boolean
  pathname: string | null
  brand: SidebarBrand
  /** Forwarded to the outer `<aside>` (or the customizing-shell). Use to
   *  override the fixed 240/72/320 width — e.g. `w-full` inside a drawer. */
  className?: string
  /** Click handler for the trailing collapse toggle in the SidebarHeader. */
  onCollapseToggle?: () => void
  collapseLabel?: string
  /** Fired on every nav item click — used by the mobile drawer to close itself. */
  onItemNavigate?: () => void

  // ---- main mode ----
  groups?: SidebarGroup[]
  /** `false` = collapsed. Missing key defaults to expanded. */
  openGroups?: Record<string, boolean>
  onToggleGroup?: (groupId: string) => void
  settingsActive?: boolean
  settingsHref?: string
  settingsLabel?: string
  customizeLabel?: string
  customizeAriaLabel?: string
  onCustomize?: () => void
  loadingCustomization?: boolean

  // ---- section mode (settings / profile) ----
  sections?: SidebarSection[]
  sectionTitle?: string
  backHref?: string
  backLabel?: string

  // ---- customization editor ----
  customizing?: boolean
  customizationEditor?: React.ReactNode

  // ---- injected slots (resolved by the caller; the sidebar just renders them) ----
  topSlot?: React.ReactNode
  navSlot?: React.ReactNode
  navFooterSlot?: React.ReactNode
  footerSlot?: React.ReactNode
  statusBadgesSlot?: React.ReactNode
}

const DefaultItemIcon = <Square aria-hidden="true" className="h-4 w-4" />

function resolveItemKey(item: { id?: string; href: string }): string {
  const candidate = item.id?.trim()
  return candidate && candidate.length > 0 ? candidate : item.href
}

function isItemOnBranch(pathname: string | null, href: string): boolean {
  if (!pathname) return false
  if (pathname === href) return true
  return pathname.startsWith(`${href}/`)
}

/** Renders the active brand row in the SidebarHeader. */
function HeaderBrand({
  brand,
  onCollapseToggle,
  collapseLabel,
}: {
  brand: SidebarBrand
  onCollapseToggle?: () => void
  collapseLabel?: string
}) {
  const trailing = onCollapseToggle ? (
    <button
      type="button"
      onClick={onCollapseToggle}
      aria-label={collapseLabel ?? 'Toggle sidebar'}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-sidebar-v2-muted transition-colors hover:bg-sidebar-v2-accent"
    >
      <PanelLeftOpen aria-hidden="true" className="h-4 w-4" />
    </button>
  ) : undefined

  const titleNode = (
    <span className="min-w-0 flex-1 truncate text-body-medium-md text-sidebar-v2-foreground">
      {brand.title}
    </span>
  )

  return (
    <SidebarShellHeader
      logo={
        brand.href ? (
          <Link
            href={brand.href}
            aria-label={brand.ariaLabel}
            className="inline-flex shrink-0 items-center"
          >
            {brand.logo}
          </Link>
        ) : (
          <span className="inline-flex shrink-0 items-center">{brand.logo}</span>
        )
      }
      title={
        brand.href ? (
          <Link href={brand.href} aria-label={brand.ariaLabel} className="min-w-0 flex-1 truncate">
            {titleNode}
          </Link>
        ) : (
          titleNode
        )
      }
      trailing={trailing}
    />
  )
}

/** A single NavItem rendered as a Next.js <Link>, preserving `data-menu-item-id`. */
function SidebarLinkItem({
  item,
  isActive,
  onItemNavigate,
  compact,
}: {
  item: SidebarItem
  isActive: boolean
  onItemNavigate?: () => void
  compact?: boolean
}) {
  const disabled = item.enabled === false
  const dataId = resolveItemKey(item)
  const icon = item.icon ?? DefaultItemIcon

  if (compact) {
    // Icon-only rail cell — bypasses NavItem's full-width row layout.
    return (
      <Link
        href={item.href}
        title={item.title}
        aria-label={item.title}
        aria-current={isActive ? 'page' : undefined}
        aria-disabled={disabled}
        data-menu-item-id={dataId}
        onClick={onItemNavigate}
        className={cn(
          'inline-flex h-10 w-10 items-center justify-center rounded-lg border border-transparent transition-colors',
          isActive
            ? 'border-sidebar-v2-accent bg-sidebar-v2-accent-active text-sidebar-v2-accent-foreground'
            : 'text-sidebar-v2-item-foreground hover:bg-sidebar-v2-accent',
          disabled ? 'pointer-events-none opacity-50' : null,
        )}
      >
        <span aria-hidden="true" className="h-4 w-4">
          {icon}
        </span>
      </Link>
    )
  }

  return (
    <NavItem
      icon={icon}
      badge={item.badge}
      isActive={isActive}
      disabled={disabled}
      render={({ className, children }) => (
        <Link
          href={item.href}
          aria-current={isActive ? 'page' : undefined}
          aria-disabled={disabled}
          data-menu-item-id={dataId}
          onClick={onItemNavigate}
          className={cn(className, disabled ? 'pointer-events-none' : null)}
        >
          {children}
        </Link>
      )}
    >
      {item.title}
    </NavItem>
  )
}

/** Renders one collapsible group with its items + nested children. */
function MainNavGroup({
  group,
  open,
  onToggle,
  pathname,
  onItemNavigate,
  compact,
}: {
  group: SidebarGroup
  open: boolean
  onToggle?: (groupId: string) => void
  pathname: string | null
  onItemNavigate?: () => void
  compact?: boolean
}) {
  const visibleItems = group.items.filter((item) => item.hidden !== true)
  if (visibleItems.length === 0) return null

  return (
    <NavGroup
      title={compact ? undefined : group.name}
      collapsed={!open}
      onCollapse={() => onToggle?.(group.id)}
    >
      {visibleItems.map((item) => {
        const childItems = (item.children ?? []).filter((c) => c.hidden !== true)
        const onBranch = isItemOnBranch(pathname, item.href)
        const showChildren = onBranch && childItems.length > 0
        const hasActiveChild = !!(
          pathname && childItems.some((c) => isItemOnBranch(pathname, c.href))
        )
        const isParentActive = pathname === item.href || (showChildren && !hasActiveChild)

        return (
          <React.Fragment key={resolveItemKey(item)}>
            <SidebarLinkItem
              item={item}
              isActive={isParentActive}
              onItemNavigate={onItemNavigate}
              compact={compact}
            />
            {showChildren && !compact ? (
              <div className="flex flex-col gap-0.5 pl-4">
                {childItems.map((child) => (
                  <SidebarLinkItem
                    key={resolveItemKey(child)}
                    item={child}
                    isActive={isItemOnBranch(pathname, child.href)}
                    onItemNavigate={onItemNavigate}
                  />
                ))}
              </div>
            ) : null}
          </React.Fragment>
        )
      })}
    </NavGroup>
  )
}

/** Section sidebar (settings / profile) — renders a "back" row then per-section groups. */
function SectionNav({
  sections,
  backHref,
  backLabel,
  pathname,
  onItemNavigate,
  openGroups,
  onToggleGroup,
  compact,
}: {
  sections: SidebarSection[]
  backHref: string
  backLabel: string
  pathname: string | null
  onItemNavigate?: () => void
  openGroups?: Record<string, boolean>
  onToggleGroup?: (sectionId: string) => void
  compact?: boolean
}) {
  const sortedSections = React.useMemo(
    () => [...sections].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [sections],
  )

  const renderSectionItem = (item: SidebarSectionItem, depth = 0): React.ReactNode => {
    const onBranch = isItemOnBranch(pathname, item.href)
    const childItems = (item.children ?? []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    const hasActiveChild = !!(
      pathname && childItems.some((child) => isItemOnBranch(pathname, child.href))
    )
    const showChildren = childItems.length > 0 && onBranch
    const isActive = onBranch || hasActiveChild
    const wrappedItem: SidebarItem = {
      id: item.id,
      href: item.href,
      title: item.label,
      icon: item.icon,
    }
    return (
      <React.Fragment key={item.id}>
        <div style={depth ? { paddingLeft: depth * 12 } : undefined}>
          <SidebarLinkItem
            item={wrappedItem}
            isActive={isActive}
            onItemNavigate={onItemNavigate}
            compact={compact}
          />
        </div>
        {showChildren ? childItems.map((c) => renderSectionItem(c, depth + 1)) : null}
      </React.Fragment>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <Link
        href={backHref}
        onClick={onItemNavigate}
        className={cn(
          'inline-flex items-center gap-2 rounded-md px-2 py-1 text-body-medium-sm text-sidebar-v2-item-foreground transition-colors hover:bg-sidebar-v2-accent',
          compact ? 'justify-center' : null,
        )}
        aria-label={backLabel}
        data-menu-item-id="section-back"
      >
        <ChevronLeft aria-hidden="true" className="h-4 w-4 shrink-0" />
        {!compact ? <span className="truncate">{backLabel}</span> : null}
      </Link>
      {sortedSections.map((section, idx) => {
        const sortedItems = [...section.items].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        if (sortedItems.length === 0) return null
        const key = `section:${section.id}`
        const open = openGroups ? openGroups[key] !== false : true
        return (
          <React.Fragment key={section.id}>
            <NavGroup
              title={compact ? undefined : section.label}
              collapsed={!open}
              onCollapse={() => onToggleGroup?.(key)}
            >
              {sortedItems.map((item) => renderSectionItem(item))}
            </NavGroup>
            {idx < sortedSections.length - 1 ? (
              <div className="border-t border-dotted border-sidebar-v2-border" />
            ) : null}
          </React.Fragment>
        )
      })}
    </div>
  )
}

/** Footer for main mode: Settings link + Customize button, stacked. */
function MainFooter({
  pathname,
  settingsActive,
  settingsHref,
  settingsLabel,
  customizeLabel,
  customizeAriaLabel,
  onCustomize,
  loadingCustomization,
  onItemNavigate,
  compact,
  navFooterSlot,
  statusBadgesSlot,
}: Pick<
  SidebarProps,
  | 'settingsActive'
  | 'settingsHref'
  | 'settingsLabel'
  | 'customizeLabel'
  | 'customizeAriaLabel'
  | 'onCustomize'
  | 'loadingCustomization'
  | 'onItemNavigate'
  | 'navFooterSlot'
  | 'statusBadgesSlot'
  | 'compact'
> & { pathname: string | null }) {
  const settingsItem: SidebarItem = {
    id: 'footer-settings',
    href: settingsHref ?? '/backend/settings',
    title: settingsLabel ?? 'Settings',
    icon: <SettingsIcon aria-hidden="true" className="h-4 w-4" />,
  }
  const settingsActiveResolved =
    settingsActive ?? (pathname ? isItemOnBranch(pathname, settingsItem.href) : false)

  const customizeAria = customizeAriaLabel ?? customizeLabel ?? 'Customize sidebar'

  return (
    <>
      {navFooterSlot}
      {statusBadgesSlot}
      <SidebarLinkItem
        item={settingsItem}
        isActive={settingsActiveResolved}
        onItemNavigate={onItemNavigate}
        compact={compact}
      />
      {onCustomize ? (
        compact ? (
          // Compact rail: 32×32 square mirroring the full button's height + chrome.
          <button
            type="button"
            onClick={onCustomize}
            disabled={loadingCustomization}
            aria-label={customizeAria}
            className="inline-flex h-8 w-8 items-center justify-center self-center rounded-lg border border-sidebar-v2-accent bg-sidebar-v2-accent-active text-sidebar-v2-item-foreground transition-colors hover:bg-sidebar-v2-accent disabled:opacity-60"
          >
            <Sparkles aria-hidden="true" className="h-4 w-4" />
          </button>
        ) : (
          // Full row: 32px high, white pill, 1px slate/200 border, 6px gap, 12px side padding (Figma SidebarFooter).
          <button
            type="button"
            onClick={onCustomize}
            disabled={loadingCustomization}
            aria-label={customizeAria}
            className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-sidebar-v2-accent bg-sidebar-v2-accent-active px-3 text-body-medium-sm text-sidebar-v2-item-foreground transition-colors hover:bg-sidebar-v2-accent disabled:opacity-60"
          >
            <Sparkles aria-hidden="true" className="h-4 w-4" />
            <span className="truncate">{customizeLabel ?? 'Customize sidebar'}</span>
          </button>
        )
      ) : null}
    </>
  )
}

/** Compact 72px icon-only rail. Bypasses the v2 SidebarShell (which is fixed 240px). */
function CompactSidebar(props: SidebarProps) {
  const {
    mode,
    pathname,
    brand,
    hideHeader,
    onCollapseToggle,
    collapseLabel,
    onItemNavigate,
    groups = [],
    openGroups,
    sections = [],
    backHref,
    backLabel,
    settingsActive,
    settingsHref,
    settingsLabel,
    customizeLabel,
    customizeAriaLabel,
    onCustomize,
    loadingCustomization,
    topSlot,
    navSlot,
    navFooterSlot,
    footerSlot,
    statusBadgesSlot,
    className,
  } = props

  return (
    <aside
      aria-label="Sidebar"
      className={cn(
        'flex h-full w-[72px] shrink-0 flex-col border-r border-sidebar-v2-border bg-sidebar-v2 text-sidebar-v2-foreground',
        className,
      )}
    >
      {!hideHeader ? (
        <div
          className="flex shrink-0 items-center justify-center border-b border-sidebar-v2-border px-2"
          style={{ height: 52 }}
        >
          {onCollapseToggle ? (
            <button
              type="button"
              onClick={onCollapseToggle}
              aria-label={collapseLabel ?? 'Expand sidebar'}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md text-black transition-colors hover:bg-sidebar-v2-accent"
            >
              {brand.logo ?? <PanelLeftOpen aria-hidden="true" className="h-4 w-4" />}
            </button>
          ) : (
            <span aria-hidden="true" className="inline-flex h-9 w-9 items-center justify-center">
              {brand.logo}
            </span>
          )}
        </div>
      ) : null}
      {topSlot}
      <div
        data-testid="sidebar"
        className="flex flex-1 flex-col items-center gap-3 overflow-y-auto px-2 py-3"
      >
        {navSlot}
        {mode === 'main'
          ? groups
              .filter((g) => g.items.some((i) => i.hidden !== true))
              .map((g) => (
                <div key={g.id} className="flex w-full flex-col items-center gap-1">
                  {g.items
                    .filter((i) => i.hidden !== true)
                    .map((item) => (
                      <SidebarLinkItem
                        key={resolveItemKey(item)}
                        item={item}
                        isActive={isItemOnBranch(pathname, item.href)}
                        onItemNavigate={onItemNavigate}
                        compact
                      />
                    ))}
                </div>
              ))
          : (
            <SectionNav
              sections={sections}
              backHref={backHref ?? '/backend'}
              backLabel={backLabel ?? 'Back'}
              pathname={pathname}
              onItemNavigate={onItemNavigate}
              openGroups={openGroups}
              compact
            />
          )}
      </div>
      {mode === 'main' ? (
        <div className="flex shrink-0 flex-col items-center gap-2 border-t border-sidebar-v2-border px-2 pb-3 pt-2">
          <MainFooter
            pathname={pathname}
            settingsActive={settingsActive}
            settingsHref={settingsHref}
            settingsLabel={settingsLabel}
            customizeLabel={customizeLabel}
            customizeAriaLabel={customizeAriaLabel}
            onCustomize={onCustomize}
            loadingCustomization={loadingCustomization}
            onItemNavigate={onItemNavigate}
            compact
            statusBadgesSlot={statusBadgesSlot}
          />
          {footerSlot}
        </div>
      ) : null}
    </aside>
  )
}

/** Default 240px (or 320px while customizing) `SidebarShell`. */
function FullSidebar(props: SidebarProps) {
  const {
    mode,
    pathname,
    brand,
    hideHeader,
    onCollapseToggle,
    collapseLabel,
    onItemNavigate,
    groups = [],
    openGroups,
    onToggleGroup,
    sections = [],
    sectionTitle,
    backHref,
    backLabel,
    settingsActive,
    settingsHref,
    settingsLabel,
    customizeLabel,
    customizeAriaLabel,
    onCustomize,
    loadingCustomization,
    customizing,
    customizationEditor,
    topSlot,
    navSlot,
    navFooterSlot,
    footerSlot,
    statusBadgesSlot,
    className,
  } = props

  const widthClass = customizing ? 'w-[320px]' : undefined

  const header = !hideHeader ? (
    <HeaderBrand brand={brand} onCollapseToggle={onCollapseToggle} collapseLabel={collapseLabel} />
  ) : undefined

  const footer = customizing
    ? footerSlot ?? undefined
    : (
        <>
          {mode === 'main' ? (
            <MainFooter
              pathname={pathname}
              settingsActive={settingsActive}
              settingsHref={settingsHref}
              settingsLabel={settingsLabel}
              customizeLabel={customizeLabel}
              customizeAriaLabel={customizeAriaLabel}
              onCustomize={onCustomize}
              loadingCustomization={loadingCustomization}
              onItemNavigate={onItemNavigate}
              navFooterSlot={navFooterSlot}
              statusBadgesSlot={statusBadgesSlot}
              compact={false}
            />
          ) : null}
          {footerSlot}
        </>
      )

  // SidebarShell's body is a scrollable `<nav>`. We don't put a second `<nav>` inside,
  // but we DO add `data-testid="sidebar"` on a wrapping div so existing selectors hold.
  return (
    <SidebarShell
      header={header}
      footer={footer}
      className={cn(widthClass, className)}
      aria-label={sectionTitle ?? undefined}
    >
      <div data-testid="sidebar" className="flex flex-col gap-3">
        {topSlot}
        {customizing && customizationEditor ? (
          customizationEditor
        ) : mode === 'main' ? (
          <>
            {navSlot}
            {groups
              .filter((g) => g.items.some((i) => i.hidden !== true))
              .map((g, idx, visible) => {
                const open = openGroups ? openGroups[g.id] !== false : true
                const isLast = idx === visible.length - 1
                return (
                  <React.Fragment key={g.id}>
                    <MainNavGroup
                      group={g}
                      open={open}
                      onToggle={onToggleGroup}
                      pathname={pathname}
                      onItemNavigate={onItemNavigate}
                    />
                    {!isLast ? (
                      <div className="border-t border-dotted border-sidebar-v2-border" />
                    ) : null}
                  </React.Fragment>
                )
              })}
          </>
        ) : (
          <SectionNav
            sections={sections}
            backHref={backHref ?? '/backend'}
            backLabel={backLabel ?? sectionTitle ?? 'Back'}
            pathname={pathname}
            onItemNavigate={onItemNavigate}
            openGroups={openGroups}
            onToggleGroup={onToggleGroup}
          />
        )}
      </div>
    </SidebarShell>
  )
}

export function Sidebar(props: SidebarProps) {
  return props.compact ? <CompactSidebar {...props} /> : <FullSidebar {...props} />
}
