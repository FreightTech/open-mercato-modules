"use client"
import * as React from 'react'
import Link from './HoverPrefetchLink'
import { ChevronDown, ChevronLeft, PanelLeftOpen, Settings as SettingsIcon, Sparkles, Square } from 'lucide-react'
import { NavGroup } from '../primitives-v2/NavGroup'
import { Collapse } from '../primitives-v2/Collapse'
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
    - default (`--sidebar-v2-width`): full `SidebarShell` with `NavGroup` + `NavItem` body
    - compact (`--sidebar-v2-rail-width`): the same shell narrowed to an icon-only rail — labels, group titles
      and nested items fold away while the width animates, so collapsing moves instead of swapping layouts
      (FMS UX 02.11; it used to be a separately rendered rail)
    - customizing (320px): default shell with the `customizationEditor`
      slot rendered in place of the nav

  An item with nested pages carries an expander at its row's end; it opens on its own branch by default and
  the user's choice is kept per item (localStorage `om:sidebarOpenItems`).

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
  /** Render every group's items as one list — no group headings, no dividers. */
  flat?: boolean
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
  compact = false,
}: {
  brand: SidebarBrand
  onCollapseToggle?: () => void
  collapseLabel?: string
  compact?: boolean
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
    <span
      className={cn(
        'min-w-0 flex-1 truncate text-body-medium-md text-sidebar-v2-foreground',
        'transition-opacity duration-[var(--m3-duration-short4)] ease-[var(--m3-ease-standard)]',
        compact ? 'opacity-0' : 'opacity-100',
      )}
    >
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

  return (
    <NavItem
      icon={icon}
      badge={item.badge}
      isActive={isActive}
      disabled={disabled}
      compact={compact}
      render={({ className, children }) => (
        <Link
          href={item.href}
          title={compact ? item.title : undefined}
          aria-label={compact ? item.title : undefined}
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

const OPEN_ITEMS_KEY = 'om:sidebarOpenItems'

/** The user's open / closed choice per item with nested pages, kept across pages and reloads. */
function useOpenItems(): [Record<string, boolean>, (key: string, open: boolean) => void] {
  const [openItems, setOpenItems] = React.useState<Record<string, boolean>>({})
  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(OPEN_ITEMS_KEY)
      const parsed = raw ? JSON.parse(raw) : null
      if (parsed && typeof parsed === 'object') setOpenItems(parsed as Record<string, boolean>)
    } catch {
      // storage unavailable: every item opens on its own branch
    }
  }, [])
  const setOpen = React.useCallback((key: string, open: boolean) => {
    setOpenItems((prev) => {
      const next = { ...prev, [key]: open }
      try {
        window.localStorage.setItem(OPEN_ITEMS_KEY, JSON.stringify(next))
      } catch {
        // storage unavailable: the choice lasts for this page
      }
      return next
    })
  }, [])
  return [openItems, setOpen]
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
  const [openItems, setOpenItem] = useOpenItems()
  const visibleItems = group.items.filter((item) => item.hidden !== true)
  if (visibleItems.length === 0) return null

  return (
    <NavGroup
      title={group.name || undefined}
      compact={compact}
      collapsed={!open}
      onCollapse={() => onToggle?.(group.id)}
    >
      {visibleItems.map((item) => {
        const childItems = (item.children ?? []).filter((c) => c.hidden !== true)
        const itemKey = resolveItemKey(item)
        const onBranch = isItemOnBranch(pathname, item.href)
        const hasChildren = childItems.length > 0
        const expanded = hasChildren && !compact && (openItems[itemKey] ?? onBranch)
        const hasActiveChild = !!(
          pathname && childItems.some((c) => isItemOnBranch(pathname, c.href))
        )
        const isParentActive = pathname === item.href || (onBranch && hasChildren && !hasActiveChild)
        const link = (
          <SidebarLinkItem
            item={item}
            isActive={isParentActive}
            onItemNavigate={onItemNavigate}
            compact={compact}
          />
        )
        if (!hasChildren) return <React.Fragment key={itemKey}>{link}</React.Fragment>

        return (
          <React.Fragment key={itemKey}>
            <div className="relative [&>a]:pr-10">
              {link}
              <button
                type="button"
                aria-expanded={expanded}
                aria-label={item.title}
                tabIndex={compact ? -1 : undefined}
                onClick={() => setOpenItem(itemKey, !expanded)}
                className={cn(
                  'absolute right-1.5 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full',
                  'text-sidebar-v2-muted hover:bg-sidebar-v2-accent hover:text-sidebar-v2-foreground',
                  'transition-[background-color,color,opacity] duration-[var(--m3-duration-short4)] ease-[var(--m3-ease-standard)]',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-v2',
                  compact ? 'pointer-events-none opacity-0' : 'opacity-100',
                )}
              >
                <ChevronDown
                  aria-hidden="true"
                  className={cn(
                    'h-4 w-4 transition-transform duration-[var(--m3-duration-medium1)] ease-[var(--m3-ease-emphasized)]',
                    expanded ? 'rotate-0' : '-rotate-90',
                  )}
                />
              </button>
            </div>
            <Collapse open={expanded}>
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
            </Collapse>
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
        // 32px high, white pill, 1px slate/200 border, 6px gap (Figma SidebarFooter); in the rail the label folds
        // away and the button narrows with the sidebar to a square around its icon.
        <button
          type="button"
          onClick={onCustomize}
          disabled={loadingCustomization}
          aria-label={customizeAria}
          title={compact ? customizeAria : undefined}
          className={cn(
            'inline-flex h-8 w-full items-center justify-center overflow-hidden rounded-lg border border-sidebar-v2-accent bg-sidebar-v2-accent-active text-body-medium-sm text-sidebar-v2-item-foreground hover:bg-sidebar-v2-accent disabled:opacity-60',
            'transition-[background-color,gap,padding] duration-[var(--m3-duration-medium2)] ease-[var(--m3-ease-emphasized)]',
            compact ? 'gap-0 px-0' : 'gap-1.5 px-3',
          )}
        >
          <Sparkles aria-hidden="true" className="h-4 w-4 shrink-0" />
          <span
            className={cn(
              'truncate transition-[opacity,max-width] duration-[var(--m3-duration-medium2)] ease-[var(--m3-ease-emphasized)]',
              compact ? 'max-w-0 opacity-0' : 'max-w-full opacity-100',
            )}
          >
            {customizeLabel ?? 'Customize sidebar'}
          </span>
        </button>
      ) : null}
    </>
  )
}

/** The `SidebarShell` at its width, narrowed to the rail when `compact`, or 320px while customizing. */
function FullSidebar(props: SidebarProps) {
  const {
    mode,
    compact,
    pathname,
    brand,
    hideHeader,
    onCollapseToggle,
    collapseLabel,
    onItemNavigate,
    groups = [],
    openGroups,
    onToggleGroup,
    flat,
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

  const rail = compact && !customizing
  const shellWidth = customizing ? '320px' : rail ? 'var(--sidebar-v2-rail-width)' : undefined

  const header = !hideHeader ? (
    <HeaderBrand brand={brand} onCollapseToggle={onCollapseToggle} collapseLabel={collapseLabel} compact={rail} />
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
              compact={rail}
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
      className={className}
      style={shellWidth ? ({ '--sidebar-v2-shell-width': shellWidth } as React.CSSProperties) : undefined}
      aria-label={sectionTitle ?? undefined}
      data-compact={rail ? 'true' : undefined}
    >
      <div data-testid="sidebar" className="flex flex-col gap-3">
        {topSlot}
        {customizing && customizationEditor ? (
          customizationEditor
        ) : mode === 'main' ? (
          <>
            {navSlot}
            {flat ? (
              <MainNavGroup
                group={{ id: 'all', name: '', items: groups.flatMap((g) => g.items) }}
                open
                pathname={pathname}
                onItemNavigate={onItemNavigate}
                compact={rail}
              />
            ) : groups
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
                      compact={rail}
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
            compact={rail}
          />
        )}
      </div>
    </SidebarShell>
  )
}

export function Sidebar(props: SidebarProps) {
  return <FullSidebar {...props} />
}
