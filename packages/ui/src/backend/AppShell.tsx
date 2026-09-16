"use client"
import * as React from 'react'
import { createContext, useContext } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { ChevronUp, ChevronDown, PanelLeftClose, PanelLeftOpen, House } from 'lucide-react'
import { Button } from '../primitives/button'
import { IconButton } from '../primitives/icon-button'
import { IconButton as IconButtonV2 } from '../primitives-v2/IconButton'
import { Separator } from '../primitives/separator'
import { FlashMessages } from './FlashMessages'
import { QueryProvider } from '../theme/QueryProvider'
import { usePathname, useSearchParams } from 'next/navigation'
import { apiCall } from './utils/apiCall'
import { LastOperationBanner } from './operations/LastOperationBanner'
import { ProgressTopBar } from './progress/ProgressTopBar'
import { UpgradeActionBanner } from './upgrades/UpgradeActionBanner'
import { PartialIndexBanner } from './indexes/PartialIndexBanner'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { slugifySidebarId } from '@open-mercato/shared/modules/navigation/sidebarPreferences'
import type { SectionNavGroup } from './section-page/types'
import { useTheme } from '../theme/ThemeProvider'
import { InjectionSpot } from './injection/InjectionSpot'
import type { InjectionMenuItem } from '@open-mercato/shared/modules/widgets/injection'
import { LEGACY_GLOBAL_MUTATION_INJECTION_SPOT_ID } from './injection/mutationEvents'
import { mergeMenuItems } from './injection/mergeMenuItems'
import { useInjectedMenuItems } from './injection/useInjectedMenuItems'
import { resolveInjectedIcon } from './injection/resolveInjectedIcon'
import { useEventBridge } from './injection/eventBridge'
import { SseEventIndicator } from './injection/SseEventIndicator'
import { StatusBadgeInjectionSpot } from './injection/StatusBadgeInjectionSpot'
import { UmesDevToolsPanel } from './devtools'
import {
  Sidebar as ChromeSidebar,
  type SidebarBrand,
  type SidebarGroup as ChromeSidebarGroup,
  type SidebarItem as ChromeSidebarItem,
  type SidebarSection,
  type SidebarSectionItem,
} from './Sidebar'
import {
  BACKEND_LAYOUT_FOOTER_INJECTION_SPOT_ID,
  BACKEND_LAYOUT_TOP_INJECTION_SPOT_ID,
  BACKEND_RECORD_CURRENT_INJECTION_SPOT_ID,
  BACKEND_SIDEBAR_FOOTER_INJECTION_SPOT_ID,
  BACKEND_SIDEBAR_TOP_INJECTION_SPOT_ID,
  BACKEND_SIDEBAR_NAV_FOOTER_INJECTION_SPOT_ID,
  BACKEND_SIDEBAR_NAV_INJECTION_SPOT_ID,
  BACKEND_TOPBAR_ACTIONS_INJECTION_SPOT_ID,
  GLOBAL_HEADER_STATUS_INDICATORS_INJECTION_SPOT_ID,
  GLOBAL_SIDEBAR_STATUS_BADGES_INJECTION_SPOT_ID,
} from './injection/spotIds'

export type AppShellProps = {
  productName?: string
  email?: string
  brandId?: string
  brandLogo?: {
    src: string
    srcLight?: string
    srcDark?: string
    alt: string
    name?: string
    width?: number
    height?: number
  }
  groups: {
    id?: string
    name: string
    defaultName?: string
    items: {
      id?: string
      href: string
      title: string
      defaultTitle?: string
      icon?: React.ReactNode
      enabled?: boolean
      hidden?: boolean
      pageContext?: 'main' | 'admin' | 'settings' | 'profile'
      children?: {
        id?: string
        href: string
        title: string
        defaultTitle?: string
        icon?: React.ReactNode
        enabled?: boolean
        hidden?: boolean
        pageContext?: 'main' | 'admin' | 'settings' | 'profile'
      }[]
    }[]
  }[]
  children: React.ReactNode
  rightHeaderSlot?: React.ReactNode
  sidebarCollapsedDefault?: boolean
  currentTitle?: string
  breadcrumb?: Array<{ label: string; href?: string }>
  // Optional: full admin nav API to refresh sidebar client-side
  adminNavApi?: string
  version?: string
  settingsSectionTitle?: string
  settingsPathPrefixes?: string[]
  settingsSections?: SectionNavGroup[]
  profileSections?: SectionNavGroup[]
  profileSectionTitle?: string
  profilePathPrefixes?: string[]
  mobileSidebarSlot?: React.ReactNode
}

type Breadcrumb = Array<{ label: string; href?: string }>

type SidebarCustomizationDraft = {
  order: string[]
  groupLabels: Record<string, string>
  itemLabels: Record<string, string>
  hiddenItemIds: Record<string, boolean>
}

type SidebarGroup = AppShellProps['groups'][number]
type SidebarItem = SidebarGroup['items'][number]
type SidebarRoleTarget = { id: string; name: string; hasPreference: boolean }

function convertInjectedMenuItemToSidebarItem(item: InjectionMenuItem, title: string): SidebarItem | null {
  if (!item.href) return null
  return {
    id: item.id,
    href: item.href,
    title,
    defaultTitle: title,
    icon: resolveInjectedIcon(item.icon) ?? undefined,
    enabled: true,
    hidden: false,
    pageContext: 'main',
  }
}

function resolveInjectedMenuLabel(
  item: { id: string; label?: string; labelKey?: string },
  t: (key: string, fallback?: string) => string,
): string {
  if (item.labelKey && item.label) return t(item.labelKey, item.label)
  if (item.labelKey) return t(item.labelKey, item.id)
  if (item.label && item.label.includes('.')) return t(item.label, item.id)
  return item.label ?? item.id
}

function mergeSidebarItemsWithInjected(
  items: SidebarItem[],
  injectedItems: InjectionMenuItem[],
  t: (key: string, fallback?: string) => string,
): SidebarItem[] {
  if (injectedItems.length === 0) return items

  const builtInById = new Map<string, SidebarItem>()
  for (const item of items) {
    builtInById.set(item.id ?? item.href, item)
  }

  const merged = mergeMenuItems(
    items.map((item) => ({
      id: item.id ?? item.href,
    })),
    injectedItems,
  )

  const result: SidebarItem[] = []
  for (const entry of merged) {
    if (entry.source === 'built-in') {
      const original = builtInById.get(entry.id)
      if (original) result.push(original)
      continue
    }
    const translatedLabel = resolveInjectedMenuLabel(
      { id: entry.id, label: entry.label, labelKey: entry.labelKey },
      t,
    )
    const converted = convertInjectedMenuItemToSidebarItem(
      {
        id: entry.id,
        label: translatedLabel,
        icon: entry.icon,
        href: entry.href,
      },
      translatedLabel,
    )
    if (converted) result.push(converted)
  }

  return result
}

function mergeSidebarGroupsWithInjected(
  groups: SidebarGroup[],
  injectedItems: InjectionMenuItem[],
  t: (key: string, fallback?: string) => string,
): SidebarGroup[] {
  if (injectedItems.length === 0) return groups

  const injectedByGroup = new Map<string, InjectionMenuItem[]>()
  const ungrouped: InjectionMenuItem[] = []

  for (const item of injectedItems) {
    if (item.groupId && item.groupId.trim().length > 0) {
      const groupItems = injectedByGroup.get(item.groupId) ?? []
      groupItems.push(item)
      injectedByGroup.set(item.groupId, groupItems)
      continue
    }
    ungrouped.push(item)
  }

  const nextGroups = groups.map((group, index) => {
    const groupId = group.id || resolveGroupKey(group)
    const groupInjected = [
      ...(injectedByGroup.get(groupId) ?? []),
      ...(index === 0 ? ungrouped : []),
    ]
    return {
      ...group,
      items: mergeSidebarItemsWithInjected(group.items, groupInjected, t),
    }
  })

  const existingIds = new Set(nextGroups.map((group) => group.id || resolveGroupKey(group)))
  for (const [groupId, items] of injectedByGroup.entries()) {
    if (existingIds.has(groupId)) continue
    const first = items[0]
    const label = first.groupLabelKey
      ? t(first.groupLabelKey, first.groupLabel ?? groupId)
      : (first.groupLabel ?? groupId)
    const groupItems = mergeSidebarItemsWithInjected([], items, t)
    if (groupItems.length === 0) continue
    nextGroups.push({
      id: groupId,
      name: label,
      defaultName: label,
      items: groupItems,
    })
  }

  return nextGroups
}

function mergeSectionGroupsWithInjected(
  sections: SectionNavGroup[],
  injectedItems: InjectionMenuItem[],
  t: (key: string, fallback?: string) => string,
): SectionNavGroup[] {
  if (injectedItems.length === 0) return sections
  const byGroup = new Map<string, InjectionMenuItem[]>()
  for (const item of injectedItems) {
    const groupId = item.groupId && item.groupId.trim().length > 0 ? item.groupId : 'injected'
    const bucket = byGroup.get(groupId) ?? []
    bucket.push(item)
    byGroup.set(groupId, bucket)
  }

  const nextSections = sections.map((section) => {
    const sectionItems = byGroup.get(section.id) ?? []
    if (sectionItems.length === 0) return section
    const mergedItems = mergeMenuItems(
      section.items.map((item) => ({ id: item.id, item })),
      sectionItems,
    ).flatMap((item) => {
      if (item.source === 'built-in') {
        const original = section.items.find((entry) => entry.id === item.id)
        return original ? [original] : []
      }
      if (!item.href) return []
      const label = resolveInjectedMenuLabel(item, t)
      return [{
        id: item.id,
        label,
        href: item.href,
        icon: resolveInjectedIcon(item.icon) ?? undefined,
      }]
    })
    return {
      ...section,
      items: mergedItems,
    }
  })

  for (const [sectionId, sectionItems] of byGroup.entries()) {
    const exists = nextSections.some((section) => section.id === sectionId)
    if (exists) continue
    const first = sectionItems[0]
    const label = first.groupLabelKey
      ? t(first.groupLabelKey, first.groupLabel ?? sectionId)
      : (first.groupLabel ?? sectionId)
    const items = sectionItems.flatMap((item) => {
      if (!item.href) return []
      const itemLabel = resolveInjectedMenuLabel(item, t)
      return [{ id: item.id, label: itemLabel, href: item.href, icon: resolveInjectedIcon(item.icon) ?? undefined }]
    })
    if (items.length === 0) continue
    nextSections.push({ id: sectionId, label, items })
  }

  return nextSections
}

function resolveGroupKey(group: SidebarGroup): string {
  if (group.id && group.id.length) return group.id
  if (group.defaultName && group.defaultName.length) return slugifySidebarId(group.defaultName)
  return slugifySidebarId(group.name)
}

function resolveItemKey(item: { id?: string; href: string }): string {
  const candidate = item.id?.trim()
  if (candidate && candidate.length > 0) return candidate
  return item.href
}

const HeaderContext = createContext<{
  setBreadcrumb: (b?: Breadcrumb) => void
  setTitle: (t?: string) => void
} | null>(null)

export function ApplyBreadcrumb({ breadcrumb, title, titleKey }: { breadcrumb?: Array<{ label: string; href?: string; labelKey?: string }>; title?: string; titleKey?: string }) {
  const ctx = useContext(HeaderContext)
  const t = useT()
  const resolvedBreadcrumb = React.useMemo<Breadcrumb | undefined>(() => {
    if (!breadcrumb) return undefined
    return breadcrumb.map(({ label, labelKey, href }) => {
      const translated = labelKey ? t(labelKey) : undefined
      const finalLabel = translated && translated !== labelKey ? translated : label
      return {
        href,
        label: finalLabel,
      }
    })
  }, [breadcrumb, t])
  const resolvedTitle = React.useMemo(() => {
    if (!titleKey) return title
    const translated = t(titleKey)
    if (translated && translated !== titleKey) return translated
    return title
  }, [titleKey, title, t])
  React.useEffect(() => {
    ctx?.setBreadcrumb(resolvedBreadcrumb)
    if (resolvedTitle !== undefined) ctx?.setTitle(resolvedTitle)
  }, [ctx, resolvedBreadcrumb, resolvedTitle])
  return null
}

// DataTable icon used for dynamic custom entity records links. Kept as a
// hand-rolled SVG (rather than a lucide import) so the icon shape matches
// the existing user-entity rows for visual continuity.
const DataTableIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="4" width="18" height="16" rx="2" ry="2"/>
    <line x1="3" y1="8" x2="21" y2="8"/>
    <line x1="9" y1="8" x2="9" y2="20"/>
    <line x1="15" y1="8" x2="15" y2="20"/>
  </svg>
)

export function AppShell({ productName, email, brandId, brandLogo, groups, rightHeaderSlot, children, sidebarCollapsedDefault = false, currentTitle, breadcrumb, adminNavApi, version, settingsSectionTitle, settingsPathPrefixes = [], settingsSections, profileSections, profileSectionTitle, profilePathPrefixes = [], mobileSidebarSlot }: AppShellProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const t = useT()
  const locale = useLocale()
  const { resolvedTheme } = useTheme()
  const { items: mainSidebarInjectedMenuItems } = useInjectedMenuItems('menu:sidebar:main')
  const { items: settingsSidebarInjectedMenuItems } = useInjectedMenuItems('menu:sidebar:settings')
  const { items: profileSidebarInjectedMenuItems } = useInjectedMenuItems('menu:sidebar:profile')
  const { items: topbarInjectedMenuItems } = useInjectedMenuItems('menu:topbar:actions')
  useEventBridge() // SSE DOM Event Bridge — singleton SSE connection for real-time server events
  const resolvedProductName = productName ?? t('appShell.productName')
  // Brand logo resolution — supports theme-aware logos via srcLight/srcDark
  const logoSrc = brandLogo
    ? (resolvedTheme === 'dark' ? (brandLogo.srcDark ?? brandLogo.src) : (brandLogo.srcLight ?? brandLogo.src))
    : '/open-mercato.svg'
  const logoAlt = brandLogo?.alt ?? resolvedProductName
  const logoWidth = brandLogo?.width ?? 32
  const logoHeight = brandLogo?.height ?? 32
  const logoName = brandLogo?.name
  const [mobileOpen, setMobileOpen] = React.useState(false)
  // Initialize from server-provided prop only to avoid hydration flicker
  const [collapsed, setCollapsed] = React.useState(sidebarCollapsedDefault)
  // Maintain internal nav state so we can augment it client-side
  const [navGroups, setNavGroups] = React.useState(AppShell.cloneGroups(groups))
  const [openGroups, setOpenGroups] = React.useState<Record<string, boolean>>(() =>
    Object.fromEntries(groups.map((g) => [resolveGroupKey(g), true])) as Record<string, boolean>
  )
  const [customizing, setCustomizing] = React.useState(false)
  const [customDraft, setCustomDraft] = React.useState<SidebarCustomizationDraft | null>(null)
  const [loadingPreferences, setLoadingPreferences] = React.useState(false)
  const [savingPreferences, setSavingPreferences] = React.useState(false)
  const [customizationError, setCustomizationError] = React.useState<string | null>(null)
  const [availableRoleTargets, setAvailableRoleTargets] = React.useState<SidebarRoleTarget[]>([])
  const [selectedRoleIds, setSelectedRoleIds] = React.useState<string[]>([])
  const [canApplyToRoles, setCanApplyToRoles] = React.useState(false)
  const originalNavRef = React.useRef<SidebarGroup[] | null>(null)
  const [headerTitle, setHeaderTitle] = React.useState<string | undefined>(currentTitle)
  const [headerBreadcrumb, setHeaderBreadcrumb] = React.useState<Breadcrumb | undefined>(breadcrumb)
  const effectiveCollapsed = customizing ? false : collapsed
  const injectionContext = React.useMemo(
    () => ({
      path: pathname ?? '',
      query: searchParams?.toString() ?? '',
    }),
    [pathname, searchParams],
  )

  const isOnSettingsPath = React.useMemo(() => {
    if (!pathname) return false
    if (pathname === '/backend/settings') return true
    return settingsPathPrefixes.some((prefix) => pathname.startsWith(prefix))
  }, [pathname, settingsPathPrefixes])

  const isOnProfilePath = React.useMemo(() => {
    if (!pathname) return false
    if (pathname === '/backend/profile') return true
    return profilePathPrefixes.some((prefix) => pathname.startsWith(prefix))
  }, [pathname, profilePathPrefixes])

  const sidebarMode: 'main' | 'settings' | 'profile' =
    isOnSettingsPath ? 'settings' :
    isOnProfilePath ? 'profile' :
    'main'

  const mainNavGroupsWithInjected = React.useMemo(
    () => mergeSidebarGroupsWithInjected(navGroups, mainSidebarInjectedMenuItems, t),
    [mainSidebarInjectedMenuItems, navGroups, t],
  )

  // Lock body scroll when mobile drawer is open so touch scroll stays in the drawer
  React.useEffect(() => {
    if (!mobileOpen || typeof document === 'undefined') return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [mobileOpen])

  React.useEffect(() => {
    try {
      const savedOpen = typeof window !== 'undefined' ? localStorage.getItem('om:sidebarOpenGroups') : null
      if (!savedOpen) return
      const parsed = JSON.parse(savedOpen) as Record<string, boolean>
      setOpenGroups((prev) => {
        const next = { ...prev }
        for (const group of groups) {
          const key = resolveGroupKey(group)
          if (key in parsed) next[key] = !!parsed[key]
          else if (group.name in parsed) next[key] = !!parsed[group.name]
        }
        return next
      })
    } catch {
      // ignore localStorage errors to avoid breaking hydration
    }
  }, [groups])

  const toggleGroup = (groupId: string) => setOpenGroups((prev) => ({ ...prev, [groupId]: prev[groupId] === false }))

  const updateDraft = React.useCallback((updater: (draft: SidebarCustomizationDraft) => SidebarCustomizationDraft) => {
    setCustomDraft((prev) => {
      if (!prev) return prev
      const next = updater(prev)
      if (originalNavRef.current) {
        setNavGroups(applyCustomizationDraft(originalNavRef.current, next))
      }
      return next
    })
  }, [])

  const startCustomization = React.useCallback(async () => {
    if (customizing || loadingPreferences) return
    setCustomizationError(null)
    setLoadingPreferences(true)
   try {
     const baseSnapshot = filterMainSidebarGroups(AppShell.cloneGroups(navGroups))
     const call = await apiCall<{
       settings?: Record<string, unknown>
       canApplyToRoles?: boolean
       roles?: Array<{ id?: string; name?: string; hasPreference?: boolean }>
     }>('/api/auth/sidebar/preferences')
      const data = call.ok ? (call.result ?? null) : null
      const rawSettings = data?.settings
      const responseOrder = Array.isArray(rawSettings?.groupOrder)
        ? rawSettings.groupOrder
            .map((id: unknown) => (typeof id === 'string' ? id.trim() : ''))
            .filter((id: string) => id.length > 0)
        : []
      const responseGroupLabels: Record<string, string> = {}
      if (rawSettings?.groupLabels && typeof rawSettings.groupLabels === 'object') {
        for (const [key, value] of Object.entries(rawSettings.groupLabels as Record<string, unknown>)) {
          if (typeof value !== 'string') continue
          const trimmedKey = key.trim()
          if (!trimmedKey) continue
          responseGroupLabels[trimmedKey] = value
        }
      }
      const responseItemLabels: Record<string, string> = {}
      if (rawSettings?.itemLabels && typeof rawSettings.itemLabels === 'object') {
        for (const [key, value] of Object.entries(rawSettings.itemLabels as Record<string, unknown>)) {
          if (typeof value !== 'string') continue
          const trimmedKey = key.trim()
          if (!trimmedKey) continue
          responseItemLabels[trimmedKey] = value
        }
      }
      const responseHiddenItems = Array.isArray(rawSettings?.hiddenItems)
        ? rawSettings.hiddenItems
            .map((itemId: unknown) => (typeof itemId === 'string' ? itemId.trim() : ''))
            .filter((itemId: string) => itemId.length > 0)
        : []
      const canManageRoles = data?.canApplyToRoles === true
      setCanApplyToRoles(canManageRoles)
      if (canManageRoles) {
        const roles = Array.isArray(data?.roles)
          ? (data.roles as Array<{ id?: string; name?: string; hasPreference?: boolean }>).filter((role) => typeof role?.id === 'string' && typeof role?.name === 'string')
          : []
        const mappedRoles: SidebarRoleTarget[] = roles.map((role) => ({
          id: role.id as string,
          name: role.name as string,
          hasPreference: role.hasPreference === true,
        }))
        setAvailableRoleTargets(mappedRoles)
        setSelectedRoleIds(mappedRoles.filter((role) => role.hasPreference).map((role) => role.id))
      } else {
        setAvailableRoleTargets([])
        setSelectedRoleIds([])
      }
      const currentIds = baseSnapshot.map((group) => resolveGroupKey(group))
      const order = mergeGroupOrder(responseOrder, currentIds)
      const { itemDefaults } = collectSidebarDefaults(baseSnapshot)
      const hiddenItemIds: Record<string, boolean> = {}
      for (const itemId of responseHiddenItems) {
        if (!itemDefaults.has(itemId)) continue
        hiddenItemIds[itemId] = true
      }
      const draft: SidebarCustomizationDraft = {
        order,
        groupLabels: { ...responseGroupLabels },
        itemLabels: { ...responseItemLabels },
        hiddenItemIds,
      }
      originalNavRef.current = baseSnapshot
      setCustomDraft(draft)
      setNavGroups(applyCustomizationDraft(baseSnapshot, draft))
      setCustomizing(true)
    } catch (error) {
      console.error('Failed to load sidebar preferences', error)
      setCustomizationError(t('appShell.sidebarCustomizationLoadError'))
    } finally {
      setLoadingPreferences(false)
    }
  }, [customizing, loadingPreferences, navGroups, t])

  const cancelCustomization = React.useCallback(() => {
    setCustomizing(false)
    setCustomDraft(null)
    setCustomizationError(null)
    setAvailableRoleTargets([])
    setSelectedRoleIds([])
    setCanApplyToRoles(false)
    if (originalNavRef.current) {
      setNavGroups(AppShell.cloneGroups(originalNavRef.current))
    }
    originalNavRef.current = null
  }, [])

  const resetCustomization = React.useCallback(() => {
    if (!originalNavRef.current) return
    const base = AppShell.cloneGroups(originalNavRef.current)
    const order = base.map((group) => resolveGroupKey(group))
    const draft: SidebarCustomizationDraft = { order, groupLabels: {}, itemLabels: {}, hiddenItemIds: {} }
    originalNavRef.current = base
    setCustomDraft(draft)
    setNavGroups(applyCustomizationDraft(base, draft))
    if (canApplyToRoles) {
      setSelectedRoleIds(availableRoleTargets.filter((role) => role.hasPreference).map((role) => role.id))
    }
  }, [availableRoleTargets, canApplyToRoles])

  const saveCustomization = React.useCallback(async () => {
    if (!customDraft) return
    setSavingPreferences(true)
    setCustomizationError(null)
    try {
      const baseGroups = originalNavRef.current ?? filterMainSidebarGroups(AppShell.cloneGroups(navGroups))
      const { groupDefaults, itemDefaults } = collectSidebarDefaults(baseGroups)
      const sanitizedGroupLabels: Record<string, string> = {}
      for (const [key, value] of Object.entries(customDraft.groupLabels)) {
        const trimmed = value.trim()
        const base = groupDefaults.get(key)
        if (!trimmed || !base) continue
        if (trimmed !== base) sanitizedGroupLabels[key] = trimmed
      }
      const sanitizedItemLabels: Record<string, string> = {}
      for (const [itemId, value] of Object.entries(customDraft.itemLabels)) {
        const trimmed = value.trim()
        const base = itemDefaults.get(itemId)
        if (!trimmed || !base) continue
        if (trimmed !== base) sanitizedItemLabels[itemId] = trimmed
      }
      const sanitizedHiddenItems: string[] = []
      for (const [itemId, hidden] of Object.entries(customDraft.hiddenItemIds)) {
        if (!hidden) continue
        if (!itemDefaults.has(itemId)) continue
        sanitizedHiddenItems.push(itemId)
      }
      const applyToRolesPayload = canApplyToRoles ? [...selectedRoleIds] : []
      const clearRoleIdsPayload = canApplyToRoles
        ? availableRoleTargets
            .filter((role) => role.hasPreference && !selectedRoleIds.includes(role.id))
            .map((role) => role.id)
        : []
      const payload: Record<string, unknown> = {
        groupOrder: customDraft.order,
        groupLabels: sanitizedGroupLabels,
        itemLabels: sanitizedItemLabels,
        hiddenItems: sanitizedHiddenItems,
      }
      if (canApplyToRoles) {
        payload.applyToRoles = applyToRolesPayload
        payload.clearRoleIds = clearRoleIdsPayload
      }
      const call = await apiCall<{
        canApplyToRoles?: boolean
        roles?: Array<{ id?: string; name?: string; hasPreference?: boolean }>
      }>('/api/auth/sidebar/preferences', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!call.ok) {
        setCustomizationError(t('appShell.sidebarCustomizationSaveError'))
        return
      }
      const data = call.result ?? null
      if (data?.canApplyToRoles !== undefined) {
        setCanApplyToRoles(data.canApplyToRoles === true)
      }
      if (Array.isArray(data?.roles)) {
        const mappedRoles: SidebarRoleTarget[] = (data.roles as Array<{ id?: string; name?: string; hasPreference?: boolean }>).filter((role) => typeof role?.id === 'string' && typeof role?.name === 'string').map((role) => ({
          id: role.id as string,
          name: role.name as string,
          hasPreference: role.hasPreference === true,
        }))
        setAvailableRoleTargets(mappedRoles)
        setSelectedRoleIds(mappedRoles.filter((role) => role.hasPreference).map((role) => role.id))
      }
      originalNavRef.current = applyCustomizationDraft(baseGroups, customDraft)
      setNavGroups(AppShell.cloneGroups(originalNavRef.current))
      setCustomizing(false)
      setCustomDraft(null)
      try { window.dispatchEvent(new Event('om:refresh-sidebar')) } catch {}
    } catch (error) {
      console.error('Failed to save sidebar preferences', error)
      setCustomizationError(t('appShell.sidebarCustomizationSaveError'))
    } finally {
      setSavingPreferences(false)
    }
  }, [customDraft, navGroups, t])

  const moveGroup = React.useCallback((groupId: string, offset: number) => {
    updateDraft((draft) => {
      const order = [...draft.order]
      const index = order.indexOf(groupId)
      if (index === -1) return draft
      const nextIndex = Math.max(0, Math.min(order.length - 1, index + offset))
      if (nextIndex === index) return draft
      order.splice(index, 1)
      order.splice(nextIndex, 0, groupId)
      return { ...draft, order }
    })
  }, [updateDraft])

  const setGroupLabel = React.useCallback((groupId: string, value: string) => {
    updateDraft((draft) => {
      const next = { ...draft.groupLabels }
      if (value.trim().length === 0) delete next[groupId]
      else next[groupId] = value
      return { ...draft, groupLabels: next }
    })
  }, [updateDraft])

  const setItemLabel = React.useCallback((itemId: string, value: string) => {
    updateDraft((draft) => {
      const next = { ...draft.itemLabels }
      if (value.trim().length === 0) delete next[itemId]
      else next[itemId] = value
      return { ...draft, itemLabels: next }
    })
  }, [updateDraft])
  const setItemHidden = React.useCallback((itemId: string, hidden: boolean) => {
    updateDraft((draft) => {
      const next = { ...draft.hiddenItemIds }
      if (hidden) next[itemId] = true
      else delete next[itemId]
      return { ...draft, hiddenItemIds: next }
    })
  }, [updateDraft])

  const toggleRoleSelection = React.useCallback((roleId: string) => {
    setSelectedRoleIds((prev) => (prev.includes(roleId) ? prev.filter((id) => id !== roleId) : [...prev, roleId]))
  }, [])


  // Persist collapse state to localStorage and cookie
  React.useEffect(() => {
    try { localStorage.setItem('om:sidebarCollapsed', collapsed ? '1' : '0') } catch {}
    try {
      document.cookie = `om_sidebar_collapsed=${collapsed ? '1' : '0'}; path=/; max-age=31536000; samesite=lax`
    } catch {}
  }, [collapsed])
  React.useEffect(() => {
    try { localStorage.setItem('om:sidebarOpenGroups', JSON.stringify(openGroups)) } catch {}
  }, [openGroups])

  // Ensure current route's group is expanded on load
  React.useEffect(() => {
    const activeGroup = navGroups.find((g) => g.items.some((i) => pathname?.startsWith(i.href)))
    if (!activeGroup) return
    const key = resolveGroupKey(activeGroup)
    setOpenGroups((prev) => (prev[key] === false ? { ...prev, [key]: true } : prev))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, navGroups])
  // Keep header state in sync with props (server-side updates)
  React.useEffect(() => {
    setHeaderTitle(currentTitle)
    setHeaderBreadcrumb(breadcrumb)
  }, [currentTitle, breadcrumb])
  // Clear breadcrumb on client-side navigation so stale state doesn't persist;
  // the new page's ApplyBreadcrumb (if any) will set the correct values
  const prevPathname = React.useRef(pathname)
  React.useEffect(() => {
    if (pathname !== prevPathname.current) {
      prevPathname.current = pathname
      setHeaderTitle(undefined)
      setHeaderBreadcrumb(undefined)
    }
  }, [pathname])

  // Keep navGroups in sync when server-provided groups change
  React.useEffect(() => {
    if (customizing && customDraft && originalNavRef.current) {
      originalNavRef.current = filterMainSidebarGroups(AppShell.cloneGroups(groups))
      setNavGroups(applyCustomizationDraft(originalNavRef.current, customDraft))
      return
    }
    setNavGroups(AppShell.cloneGroups(groups))
  }, [groups, customizing, customDraft])

  // Optional: full refresh from adminNavApi, used to reflect RBAC/org/entity changes without page reload
  React.useEffect(() => {
    let cancelled = false
    function indexIcons(groupsToIndex: AppShellProps['groups']): Map<string, React.ReactNode | undefined> {
      const map = new Map<string, React.ReactNode | undefined>()
      for (const g of groupsToIndex) {
        for (const i of g.items) {
          map.set(i.href, i.icon)
          if (i.children) for (const c of i.children) map.set(c.href, c.icon)
        }
      }
      return map
    }
    function mergePreservingIcons(oldG: AppShellProps['groups'], newG: AppShellProps['groups']): AppShellProps['groups'] {
      const iconMap = indexIcons(oldG)
      const merged = newG.map((g) => ({
        id: g.id,
        name: g.name,
        defaultName: g.defaultName,
        items: g.items.map((i) => ({
          href: i.href,
          title: i.title,
          defaultTitle: i.defaultTitle,
          enabled: i.enabled,
          hidden: i.hidden,
          icon: i.icon ?? iconMap.get(i.href),
          pageContext: i.pageContext,
          children: i.children?.map((c) => ({
            href: c.href,
            title: c.title,
            defaultTitle: c.defaultTitle,
            enabled: c.enabled,
            hidden: c.hidden,
            icon: c.icon ?? iconMap.get(c.href),
            pageContext: c.pageContext,
          })),
        })),
      }))
      return merged
    }
    async function refreshFullNav() {
      if (!adminNavApi) return
      try {
        const call = await apiCall<{ groups?: unknown[] }>(adminNavApi, { credentials: 'include' as any })
        if (!call.ok) return
        const data = call.result
        if (cancelled) return
        const nextGroups = Array.isArray(data?.groups) ? data.groups : []
        if (nextGroups.length) setNavGroups((prev) => AppShell.cloneGroups(mergePreservingIcons(prev, nextGroups as any)))
      } catch {}
    }
    // Refresh on window focus
    const onFocus = () => refreshFullNav()
    window.addEventListener('focus', onFocus)
    return () => { cancelled = true; window.removeEventListener('focus', onFocus) }
  }, [adminNavApi])

  // Refresh sidebar when other parts of the app dispatch an explicit event
  React.useEffect(() => {
    if (!adminNavApi) return
    const api = adminNavApi as string
    let cancelled = false
    function indexIcons(groupsToIndex: AppShellProps['groups']): Map<string, React.ReactNode | undefined> {
      const map = new Map<string, React.ReactNode | undefined>()
      for (const g of groupsToIndex) {
        for (const i of g.items) {
          map.set(i.href, i.icon)
          if (i.children) for (const c of i.children) map.set(c.href, c.icon)
        }
      }
      return map
    }
    function mergePreservingIcons(oldG: AppShellProps['groups'], newG: AppShellProps['groups']): AppShellProps['groups'] {
      const iconMap = indexIcons(oldG)
      const merged = newG.map((g) => ({
        id: g.id,
        name: g.name,
        defaultName: g.defaultName,
        items: g.items.map((i) => ({
          href: i.href,
          title: i.title,
          defaultTitle: i.defaultTitle,
          enabled: i.enabled,
          hidden: i.hidden,
          icon: i.icon ?? iconMap.get(i.href),
          pageContext: i.pageContext,
          children: i.children?.map((c) => ({
            href: c.href,
            title: c.title,
            defaultTitle: c.defaultTitle,
            enabled: c.enabled,
            hidden: c.hidden,
            icon: c.icon ?? iconMap.get(c.href),
            pageContext: c.pageContext,
          })),
        })),
      }))
      return merged
    }
    async function refreshFullNav() {
      try {
        const call = await apiCall<{ groups?: unknown[] }>(api, { credentials: 'include' as any })
        if (!call.ok) return
        const data = call.result
        if (cancelled) return
        const nextGroups = Array.isArray(data?.groups) ? data.groups : []
        if (nextGroups.length) setNavGroups((prev) => AppShell.cloneGroups(mergePreservingIcons(prev, nextGroups as any)))
      } catch {}
    }
    const onRefresh = () => { refreshFullNav() }
    window.addEventListener('om:refresh-sidebar', onRefresh as any)
    return () => { cancelled = true; window.removeEventListener('om:refresh-sidebar', onRefresh as any) }
  }, [adminNavApi])

  // adminNavApi already includes user entities; no extra fetch

  // Memoized. The footer Settings link in the v2 Sidebar reads this to
  // decide whether to render as active. Keeps the giant prefix list in
  // one place; the upstream Open Mercato nav doesn't expose a single
  // "is on the settings sub-app" predicate today.
  const settingsLinkActive = React.useMemo(() => {
    if (!pathname) return false
    const SETTINGS_PREFIXES = [
      '/backend/settings',
      '/backend/config',
      '/backend/users',
      '/backend/roles',
      '/backend/api-keys',
      '/backend/entities',
      '/backend/query-indexes',
      '/backend/definitions',
      '/backend/instances',
      '/backend/tasks',
      '/backend/events',
      '/backend/rules',
      '/backend/sets',
      '/backend/logs',
      '/backend/directory',
      '/backend/feature-toggles',
    ]
    return SETTINGS_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  }, [pathname])

  // The v2 Sidebar takes a fully-resolved brand (logo + title as ReactNodes).
  // AppShell handles theme-aware logo selection and Next/Image rendering; the
  // sidebar component itself is DI-free beyond `next/link`.
  const sidebarBrand: SidebarBrand = React.useMemo(
    () => ({
      logo: (
        <Image
          src={logoSrc}
          alt={logoAlt}
          width={logoWidth}
          height={logoHeight}
          className="rounded"
        />
      ),
      title: logoName ?? resolvedProductName,
      href: '/backend',
      ariaLabel: t('appShell.goToDashboard'),
    }),
    [logoSrc, logoAlt, logoWidth, logoHeight, logoName, resolvedProductName, t],
  )

  // Fallback icon for dynamic entity records rows; otherwise the sidebar's
  // own `DefaultItemIcon` (a dashed square per Figma) takes over.
  const resolveItemIcon = React.useCallback(
    (item: { icon?: React.ReactNode; href: string }): React.ReactNode | undefined => {
      if (item.icon) return item.icon
      if (item.href.includes('/backend/entities/user/') && item.href.endsWith('/records')) {
        return DataTableIcon
      }
      return undefined
    },
    [],
  )

  // ---- Data shape adapters: AppShellProps shape → ChromeSidebar props ----
  const toChromeItem = React.useCallback(
    (item: SidebarItem): ChromeSidebarItem => ({
      id: resolveItemKey(item),
      href: item.href,
      title: item.title,
      icon: resolveItemIcon(item),
      enabled: item.enabled,
      hidden: item.hidden,
      children: item.children?.map(toChromeItem),
    }),
    [resolveItemIcon],
  )

  const toChromeSectionItem = React.useCallback(
    (item: NonNullable<SectionNavGroup['items'][number]>): SidebarSectionItem => ({
      id: item.id,
      label: item.labelKey ? t(item.labelKey, item.label) : item.label,
      href: item.href,
      icon: resolveItemIcon(item),
      order: item.order,
      children: item.children?.map(toChromeSectionItem),
    }),
    [resolveItemIcon, t],
  )

  const toChromeSection = React.useCallback(
    (section: SectionNavGroup): SidebarSection => ({
      id: section.id,
      label: section.labelKey ? t(section.labelKey, section.label) : section.label,
      order: section.order,
      items: section.items.map(toChromeSectionItem),
    }),
    [t, toChromeSectionItem],
  )

  // The customization editor JSX is unchanged from the pre-v2 implementation;
  // only its container moves into the new Sidebar via the `customizationEditor`
  // slot. Closures over component state (`customDraft`, `savingPreferences`, …)
  // are preserved because this lives inside the AppShell function body.
  const renderCustomizationEditor = (): React.ReactNode => {
    if (!customDraft) {
      return (
        <div className="rounded border border-dashed border-sidebar-foreground/30 bg-sidebar-accent/50 p-3 text-sm text-sidebar-foreground/70">
          {t('appShell.sidebarCustomizationLoading')}
        </div>
      )
    }

    const baseGroupsForDefaults = originalNavRef.current ?? mainNavGroupsWithInjected
    const baseGroupMap = new Map<string, SidebarGroup>()
    for (const group of baseGroupsForDefaults) {
      baseGroupMap.set(resolveGroupKey(group), group)
    }
    const localeLabel = (locale || '').toUpperCase()
    const orderedGroupIds = mergeGroupOrder(
      customDraft.order,
      Array.from(baseGroupMap.keys()),
    )

    const renderEditableItems = (
      baseItems: SidebarItem[],
      currentItems: SidebarItem[],
      depth = 0,
    ): React.ReactNode => {
      return baseItems.map((baseItem) => {
        const itemKey = resolveItemKey(baseItem)
        const current = currentItems.find((item) => item.href === baseItem.href) ?? baseItem
        const placeholder = baseItem.defaultTitle ?? baseItem.title
        const value = customDraft.itemLabels[itemKey] ?? ''
        const hidden = customDraft.hiddenItemIds[itemKey] === true
        return (
          <div
            key={itemKey}
            className={`flex flex-col gap-1 ${hidden ? 'opacity-60' : ''}`}
            style={depth ? { marginLeft: depth * 16 } : undefined}
          >
            <span className="text-xs font-medium text-sidebar-foreground/70">{placeholder}</span>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 accent-sidebar-primary"
                checked={!hidden}
                onChange={(event) => setItemHidden(itemKey, !event.target.checked)}
                disabled={savingPreferences}
                aria-label={t('appShell.sidebarCustomizationShowItem')}
                title={t('appShell.sidebarCustomizationShowItem')}
              />
              <input
                value={value}
                onChange={(event) => setItemLabel(itemKey, event.target.value)}
                placeholder={placeholder}
                disabled={savingPreferences}
                className="h-8 flex-1 rounded border border-sidebar-foreground/20 bg-sidebar px-2 text-sm text-sidebar-foreground placeholder:text-sidebar-foreground/50 focus:outline-none focus:ring-2 focus:ring-sidebar-primary disabled:opacity-60"
              />
            </div>
            {baseItem.children && baseItem.children.length > 0 ? (
              <div className="flex flex-col gap-1">
                {renderEditableItems(baseItem.children, current.children ?? [], depth + 1)}
              </div>
            ) : null}
          </div>
        )
      })
    }

    return (
      <div className="flex flex-col gap-3 rounded border border-dashed border-sidebar-foreground/30 bg-sidebar-accent/50 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-semibold">{t('appShell.sidebarCustomizationHeading')}</div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={resetCustomization} disabled={savingPreferences}>
              {t('appShell.sidebarCustomizationReset')}
            </Button>
            <Button variant="outline" size="sm" onClick={cancelCustomization} disabled={savingPreferences}>
              {t('appShell.sidebarCustomizationCancel')}
            </Button>
            <Button
              size="sm"
              className="bg-sidebar-primary text-sidebar-primary-foreground hover:opacity-90"
              onClick={saveCustomization}
              disabled={savingPreferences}
            >
              {savingPreferences ? t('appShell.sidebarCustomizationSaving') : t('appShell.sidebarCustomizationSave')}
            </Button>
          </div>
        </div>
        <p className="text-xs text-sidebar-foreground/70">{t('appShell.sidebarCustomizationHint', { locale: localeLabel })}</p>
        {canApplyToRoles ? (
          <div className="flex flex-col gap-2 rounded border border-sidebar-foreground/20 bg-sidebar-accent p-3">
            <div>
              <div className="text-sm font-semibold">{t('appShell.sidebarApplyToRolesTitle')}</div>
              <p className="text-xs text-sidebar-foreground/70">{t('appShell.sidebarApplyToRolesDescription')}</p>
            </div>
            {availableRoleTargets.length > 0 ? (
              <div className="flex flex-col gap-2">
                {availableRoleTargets.map((role) => {
                  const checked = selectedRoleIds.includes(role.id)
                  const willClear = role.hasPreference && !checked
                  return (
                    <label key={role.id} className="flex items-center gap-2 rounded border border-sidebar-foreground/20 bg-sidebar px-2 py-1 text-sm">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-sidebar-primary"
                        checked={checked}
                        onChange={() => toggleRoleSelection(role.id)}
                        disabled={savingPreferences}
                      />
                      <span className="flex-1 truncate">{role.name}</span>
                      {role.hasPreference ? (
                        <span className={`text-xs ${willClear ? 'text-destructive' : 'text-sidebar-foreground/60'}`}>
                          {willClear ? t('appShell.sidebarRoleWillClear') : t('appShell.sidebarRoleHasPreset')}
                        </span>
                      ) : null}
                    </label>
                  )
                })}
              </div>
            ) : (
              <p className="text-xs text-sidebar-foreground/60">{t('appShell.sidebarApplyToRolesEmpty')}</p>
            )}
          </div>
        ) : null}
        {customizationError ? <p className="text-xs text-destructive">{customizationError}</p> : null}
        <div className="flex flex-col gap-3">
          {orderedGroupIds.map((groupId, index) => {
            const baseGroup = baseGroupMap.get(groupId)
            if (!baseGroup) return null
            const currentGroup = navGroups.find((group) => resolveGroupKey(group) === groupId) ?? baseGroup
            const placeholder = baseGroup.defaultName ?? baseGroup.name
            const value = customDraft.groupLabels[groupId] ?? ''
            return (
              <div key={groupId} className="flex flex-col gap-3 rounded border border-sidebar-foreground/20 bg-sidebar-accent p-3">
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <span className="text-xs font-medium text-sidebar-foreground/70">{t('appShell.sidebarCustomizationGroupLabel')}</span>
                    <input
                      value={value}
                      onChange={(event) => setGroupLabel(groupId, event.target.value)}
                      placeholder={placeholder}
                      disabled={savingPreferences}
                      className="mt-1 h-8 w-full rounded border border-sidebar-foreground/20 bg-sidebar px-2 text-sm text-sidebar-foreground placeholder:text-sidebar-foreground/50 focus:outline-none focus:ring-2 focus:ring-sidebar-primary disabled:opacity-60"
                    />
                  </div>
                  <div className="flex items-center gap-1 self-start">
                    <IconButton
                      variant="outline"
                      size="sm"
                      className="text-sidebar-foreground/70 hover:text-sidebar-foreground"
                      onClick={() => moveGroup(groupId, -1)}
                      disabled={index === 0 || savingPreferences}
                      aria-label={t('appShell.sidebarCustomizationMoveUp')}
                    >
                      <ChevronUp className="size-4" />
                    </IconButton>
                    <IconButton
                      variant="outline"
                      size="sm"
                      className="text-sidebar-foreground/70 hover:text-sidebar-foreground"
                      onClick={() => moveGroup(groupId, 1)}
                      disabled={index === orderedGroupIds.length - 1 || savingPreferences}
                      aria-label={t('appShell.sidebarCustomizationMoveDown')}
                    >
                      <ChevronDown className="size-4" />
                    </IconButton>
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  {renderEditableItems(baseGroup.items, currentGroup.items)}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  function renderSidebar(compact: boolean, hideHeader?: boolean) {
    const hasSettings = sidebarMode === 'settings' && !!settingsSections && settingsSections.length > 0
    const hasProfile = sidebarMode === 'profile' && !!profileSections && profileSections.length > 0
    const mode: 'main' | 'settings' | 'profile' = hasSettings ? 'settings' : hasProfile ? 'profile' : 'main'
    const shouldRenderInjections = !hideHeader

    // Main groups: drop items pinned to other contexts (settings/profile) and items
    // whose href targets a settings prefix — those live in the section sidebar.
    let chromeGroups: ChromeSidebarGroup[] | undefined
    if (mode === 'main') {
      const isSettingsPath = (href: string) => {
        if (href === '/backend/settings') return true
        return settingsPathPrefixes.some((prefix) => href.startsWith(prefix))
      }
      const isMainItem = (item: SidebarItem) => {
        if (item.pageContext && item.pageContext !== 'main') return false
        if (isSettingsPath(item.href)) return false
        return true
      }
      chromeGroups = mainNavGroupsWithInjected
        .map((g) => ({
          id: resolveGroupKey(g),
          name: g.name,
          items: g.items
            .filter((item) => isMainItem(item) && item.hidden !== true)
            .map(toChromeItem),
        }))
        .filter((g) => g.items.length > 0)
    }

    // Section groups: settings or profile, both flow through mergeSectionGroupsWithInjected.
    let chromeSections: SidebarSection[] | undefined
    let sectionTitle: string | undefined
    if (mode === 'settings') {
      const merged = mergeSectionGroupsWithInjected(
        settingsSections!,
        settingsSidebarInjectedMenuItems,
        t,
      )
      chromeSections = merged.map(toChromeSection)
      sectionTitle = settingsSectionTitle ?? t('backend.nav.settings', 'Settings')
    } else if (mode === 'profile') {
      const merged = mergeSectionGroupsWithInjected(
        profileSections!,
        profileSidebarInjectedMenuItems,
        t,
      )
      chromeSections = merged.map(toChromeSection)
      sectionTitle = profileSectionTitle ?? t('backend.nav.profile', 'Profile')
    }

    // Injection spots — render only on the desktop variant (the mobile drawer
    // already has its own copies via the parent layout). The Sidebar component
    // is DI-free; AppShell resolves spots into ReactNodes and passes them in.
    const topSlot = shouldRenderInjections ? (
      <InjectionSpot spotId={BACKEND_SIDEBAR_TOP_INJECTION_SPOT_ID} context={injectionContext} />
    ) : undefined
    const navSlot = shouldRenderInjections && mode === 'main' ? (
      <InjectionSpot spotId={BACKEND_SIDEBAR_NAV_INJECTION_SPOT_ID} context={injectionContext} />
    ) : undefined
    const navFooterSlot = shouldRenderInjections && mode === 'main' ? (
      <InjectionSpot spotId={BACKEND_SIDEBAR_NAV_FOOTER_INJECTION_SPOT_ID} context={injectionContext} />
    ) : undefined
    const footerSlot = shouldRenderInjections ? (
      <InjectionSpot spotId={BACKEND_SIDEBAR_FOOTER_INJECTION_SPOT_ID} context={injectionContext} />
    ) : undefined
    const statusBadgesSlot = shouldRenderInjections ? (
      <StatusBadgeInjectionSpot
        spotId={GLOBAL_SIDEBAR_STATUS_BADGES_INJECTION_SPOT_ID}
        context={injectionContext}
      />
    ) : undefined

    const isCustomizing = customizing && mode === 'main'

    return (
      <ChromeSidebar
        mode={mode}
        compact={compact}
        hideHeader={hideHeader}
        pathname={pathname ?? null}
        brand={sidebarBrand}
        // Collapse toggle lives on the sidebar's right border (rendered by
        // AppShell below), so the sidebar header itself renders no toggle —
        // this keeps a single toggle visible in both expanded and compact
        // states instead of one that vanishes into the compact logo.
        onCollapseToggle={undefined}
        collapseLabel={t(compact ? 'appShell.expandSidebar' : 'appShell.collapseSidebar')}
        onItemNavigate={() => setMobileOpen(false)}
        groups={chromeGroups}
        openGroups={openGroups}
        onToggleGroup={toggleGroup}
        settingsActive={settingsLinkActive}
        settingsHref="/backend/settings"
        settingsLabel={t('backend.nav.settings', 'Settings')}
        customizeLabel={
          loadingPreferences
            ? t('appShell.sidebarCustomizationLoading')
            : t('appShell.customizeSidebar')
        }
        customizeAriaLabel={t('appShell.customizeSidebar')}
        // Customization is a main-mode-only flow; suppress in section sidebars.
        onCustomize={mode === 'main' ? startCustomization : undefined}
        loadingCustomization={loadingPreferences}
        sections={chromeSections}
        sectionTitle={sectionTitle}
        backHref="/backend"
        backLabel={sectionTitle ?? t('backend.nav.backToMain', 'Back')}
        customizing={isCustomizing}
        customizationEditor={isCustomizing ? renderCustomizationEditor() : undefined}
        topSlot={topSlot}
        navSlot={navSlot}
        navFooterSlot={navFooterSlot}
        footerSlot={footerSlot}
        statusBadgesSlot={statusBadgesSlot}
        className={hideHeader ? 'h-full w-full border-r-0' : 'min-h-svh'}
      />
    )
  }

  // The Sidebar's outer <aside> carries its own width (240/72/320). Use an
  // auto track so the grid column sizes to whatever the Sidebar renders;
  // avoids keeping two width sources in sync across collapse/customize.
  const gridColsClass = 'lg:grid-cols-[auto_1fr]'
  const headerCtxValue = React.useMemo(() => ({
    setBreadcrumb: setHeaderBreadcrumb,
    setTitle: setHeaderTitle,
  }), [])
  const renderedTopbarInjectedActions = React.useMemo(
    () =>
      topbarInjectedMenuItems.map((item) => {
        const label = resolveInjectedMenuLabel(item, t)
        if (item.href) {
          return (
            <Link
              key={item.id}
              href={item.href}
              className="inline-flex items-center rounded border px-2 py-1 text-xs hover:bg-accent hover:text-accent-foreground"
              data-menu-item-id={item.id}
            >
              {label}
            </Link>
          )
        }
        return (
          <Button
            key={item.id}
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            data-menu-item-id={item.id}
            onClick={() => item.onClick?.()}
          >
            {label}
          </Button>
        )
      }),
    [t, topbarInjectedMenuItems],
  )

  return (
    <QueryProvider>
    <HeaderContext.Provider value={headerCtxValue}>
    <div className={`min-h-svh lg:h-svh lg:overflow-hidden lg:grid lg:grid-rows-1 ${gridColsClass}`}>
      {/* Desktop sidebar — the Sidebar component renders its own <aside> with the v2 chrome.
          The collapse toggle is pinned to the sidebar's right border so it stays visible in
          both expanded and compact states and slides with the border as the width changes. */}
      <div className="relative hidden lg:block">
        {renderSidebar(effectiveCollapsed)}
        {!customizing && (
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={t('appShell.toggleSidebar')}
            title={t('appShell.toggleSidebar')}
            className="absolute top-3 right-0 z-30 inline-flex h-7 w-7 -translate-y-px translate-x-1/2 cursor-pointer items-center justify-center rounded-full border border-sidebar-v2-border bg-background text-sidebar-v2-muted shadow-sm transition-colors hover:bg-sidebar-v2-accent hover:text-sidebar-v2-foreground"
          >
            {effectiveCollapsed ? (
              <PanelLeftOpen aria-hidden="true" className="h-4 w-4" />
            ) : (
              <PanelLeftClose aria-hidden="true" className="h-4 w-4" />
            )}
          </button>
        )}
      </div>

      <div className="flex min-h-svh flex-col min-w-0 lg:h-full lg:min-h-0 bg-topbar-v2-bg">
        <header className="bg-topbar-v2-bg pl-3 pr-3 lg:pl-6 py-2.5 flex items-center justify-between gap-2 text-topbar-v2-icon">
          <div className="flex items-center gap-1 min-w-0">
            {/* Mobile menu button */}
            <IconButton variant="outline" size="sm" className="lg:hidden" aria-label={t('appShell.openMenu')} onClick={() => setMobileOpen(true)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
            </IconButton>
            {/* Desktop collapse toggle now lives on the sidebar's right border (see above). */}
            {/* Header breadcrumb: the Dashboard root renders as a Home icon button (Figma 781:13633). */}
            {(() => {
              const dashboardLabel = t('dashboard.title')
              const root: Breadcrumb = [{ label: dashboardLabel, href: '/backend' }]
              let rest: Breadcrumb = []
              if (headerBreadcrumb && headerBreadcrumb.length) {
                const first = headerBreadcrumb[0]
                const dup = first && (first.href === '/backend' || first.label === dashboardLabel || first.label?.toLowerCase() === 'dashboard')
                rest = dup ? headerBreadcrumb.slice(1) : headerBreadcrumb
              } else if (headerTitle) {
                rest = [{ label: headerTitle }]
              }
              const items = [...root, ...rest]
              const lastIndex = items.length - 1
              // aria-label is the standard ARIA breadcrumb pattern: it names this
              // nav for assistive tech and is the stable handle tests select on.
              // Do NOT identify this nav by className — it was previously only
              // distinguishable from the footer nav by styling, so restyling it
              // silently broke the AppShell breadcrumb test.
              return (
                <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 min-w-0">
                  {items.map((b, i) => {
                    const isLast = i === lastIndex
                    // Root (Dashboard) → Home icon button.
                    if (i === 0) {
                      return (
                        <IconButtonV2
                          key={i}
                          asChild
                          variant="outline"
                          size="sm"
                          aria-label={b.label}
                          title={b.label}
                          className="shrink-0 border-topbar-v2-border bg-topbar-v2-field-bg text-topbar-v2-icon enabled:hover:bg-topbar-v2-border"
                        >
                          <Link href={b.href ?? '/backend'}>
                            <House aria-hidden="true" className="h-4 w-4 text-topbar-v2-icon" />
                          </Link>
                        </IconButtonV2>
                      )
                    }
                    const hiddenOnMobile = !isLast ? 'hidden md:inline' : ''
                    return (
                      <React.Fragment key={i}>
                        {i > 1 && <span className="text-topbar-v2-field-placeholder hidden md:inline" aria-hidden="true">/</span>}
                        {b.href && !isLast ? (
                          <Link href={b.href} className={`text-label-medium-md text-topbar-v2-icon transition-colors hover:text-topbar-v2-title ${hiddenOnMobile}`}>
                            {b.label}
                          </Link>
                        ) : (
                          <span className="text-label-semibold-md text-topbar-v2-title truncate max-w-[45vw] md:max-w-[60vw]">{b.label}</span>
                        )}
                      </React.Fragment>
                    )
                  })}
                </nav>
              )
            })()}
          </div>
          <div className="flex items-center gap-1 md:gap-2 text-sm shrink-0">
            <StatusBadgeInjectionSpot
              spotId={GLOBAL_HEADER_STATUS_INDICATORS_INJECTION_SPOT_ID}
              context={injectionContext}
            />
            <InjectionSpot
              spotId={BACKEND_TOPBAR_ACTIONS_INJECTION_SPOT_ID}
              context={injectionContext}
            />
            {renderedTopbarInjectedActions}
            {rightHeaderSlot ? (
              rightHeaderSlot
            ) : (
              <span className="opacity-80">{email || t('appShell.userFallback')}</span>
            )}
          </div>
        </header>
        <ProgressTopBar t={t} className="sticky top-0 z-10" />
        <main className="flex-1 p-4 lg:p-6 lg:min-h-0 lg:overflow-y-auto bg-background lg:mx-1.5 lg:mt-1.5 lg:rounded-2xl">
          <InjectionSpot spotId={BACKEND_LAYOUT_TOP_INJECTION_SPOT_ID} context={injectionContext} />
          <FlashMessages />
          <SseEventIndicator />
          <PartialIndexBanner />
          <UpgradeActionBanner />
          <LastOperationBanner />
          <InjectionSpot spotId={BACKEND_RECORD_CURRENT_INJECTION_SPOT_ID} context={injectionContext} />
          <InjectionSpot
            spotId={LEGACY_GLOBAL_MUTATION_INJECTION_SPOT_ID}
            context={injectionContext}
          />
          <div id="om-top-banners" className="mb-3 space-y-2" />
          {children}
          <InjectionSpot spotId={BACKEND_LAYOUT_FOOTER_INJECTION_SPOT_ID} context={injectionContext} />
        </main>
        <footer className="bg-topbar-v2-bg px-4 py-3 flex flex-wrap items-center justify-end gap-4">
          {version ? (
            <span className="text-xs text-muted-foreground">
              {t('appShell.version', { version })}
            </span>
          ) : null}
          <nav className="flex items-center gap-3 text-xs text-muted-foreground">
            <Link href="/terms" className="transition hover:text-foreground">
              {t('common.terms')}
            </Link>
            <Link href="/privacy" className="transition hover:text-foreground">
              {t('common.privacy')}
            </Link>
          </nav>
        </footer>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} aria-hidden="true" />
          <aside className="absolute left-0 top-0 flex h-full w-[260px] flex-col overflow-hidden border-r border-sidebar-v2-border bg-sidebar-v2 text-sidebar-v2-foreground">
            <div className="flex shrink-0 items-center justify-between border-b border-sidebar-v2-border px-3 py-2">
              <Link href="/backend" className="flex items-center gap-2 text-body-medium-sm font-semibold" onClick={() => setMobileOpen(false)} aria-label={t('appShell.goToDashboard')}>
                <Image src={logoSrc} alt={logoAlt} width={logoWidth > 32 ? logoWidth : 28} height={logoHeight > 32 ? logoHeight : 28} className="mr-2" />
                {logoName ?? resolvedProductName}
              </Link>
              <IconButton variant="outline" size="sm" onClick={() => setMobileOpen(false)} aria-label={t('appShell.closeMenu')}>✕</IconButton>
            </div>
            {mobileSidebarSlot && (
              <div className="shrink-0 border-b border-sidebar-v2-border px-3 py-2">
                {mobileSidebarSlot}
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
              {/* Force expanded sidebar in mobile drawer, hide its header and collapse toggle.
                  The Sidebar's className override drops its fixed 240px width + right border. */}
              {renderSidebar(false, true)}
            </div>
          </aside>
        </div>
      )}
    </div>
    <UmesDevToolsPanel />
    </HeaderContext.Provider>
    </QueryProvider>
  )
}

// Helper: deep-clone minimal shape we mutate (children arrays)
AppShell.cloneGroups = function cloneGroups(groups: AppShellProps['groups']): AppShellProps['groups'] {
  const cloneItem = (item: SidebarItem): SidebarItem => ({
    id: item.id,
    href: item.href,
    title: item.title,
    defaultTitle: item.defaultTitle,
    icon: item.icon,
    enabled: item.enabled,
    hidden: item.hidden,
    pageContext: item.pageContext,
    children: item.children ? item.children.map((child) => cloneItem(child)) : undefined,
  })
  return groups.map((group) => ({
    id: group.id,
    name: group.name,
    defaultName: group.defaultName,
    items: group.items.map((item) => cloneItem(item)),
  }))
}

function applyCustomizationDraft(baseGroups: SidebarGroup[], draft: SidebarCustomizationDraft): SidebarGroup[] {
  const clones = AppShell.cloneGroups(baseGroups)
  const byId = new Map<string, SidebarGroup>()
  for (const group of clones) {
    byId.set(resolveGroupKey(group), group)
  }
  const orderedIds = mergeGroupOrder(draft.order, Array.from(byId.keys()))
  const seen = new Set<string>()
  const result: SidebarGroup[] = []
  for (const id of orderedIds) {
    if (seen.has(id)) continue
    const group = byId.get(id)
    if (!group) continue
    seen.add(id)
    const baseName = group.defaultName ?? group.name
    const override = draft.groupLabels[id]?.trim()
    result.push({
      ...group,
      name: override && override.length > 0 ? override : baseName,
      items: group.items.map((item) => applyItemDraft(item, draft)),
    })
  }
  return result
}

function applyItemDraft(item: SidebarItem, draft: SidebarCustomizationDraft): SidebarItem {
  const itemKey = resolveItemKey(item)
  const baseTitle = item.defaultTitle ?? item.title
  const override = draft.itemLabels[itemKey]?.trim()
  const children = item.children
    ? item.children
        .map((child) => applyItemDraft(child, draft))
    : undefined
  const hidden = draft.hiddenItemIds[itemKey] === true
  return {
    ...item,
    title: override && override.length > 0 ? override : baseTitle,
    hidden,
    children,
  }
}

function mergeGroupOrder(preferred: string[], current: string[]): string[] {
  const seen = new Set<string>()
  const merged: string[] = []
  for (const id of preferred) {
    const trimmed = id.trim()
    if (!trimmed || seen.has(trimmed) || !current.includes(trimmed)) continue
    seen.add(trimmed)
    merged.push(trimmed)
  }
  for (const id of current) {
    if (seen.has(id)) continue
    seen.add(id)
    merged.push(id)
  }
  return merged
}

function collectSidebarDefaults(groups: SidebarGroup[]) {
  const groupDefaults = new Map<string, string>()
  const itemDefaults = new Map<string, string>()

  const visitItems = (items: SidebarItem[]) => {
    for (const item of items) {
      const key = resolveItemKey(item)
      const baseTitle = item.defaultTitle ?? item.title
      itemDefaults.set(key, baseTitle)
      // Backward-compatible alias for legacy stored href-based preferences.
      itemDefaults.set(item.href, baseTitle)
      if (item.children && item.children.length > 0) visitItems(item.children)
    }
  }

  for (const group of groups) {
    const key = resolveGroupKey(group)
    groupDefaults.set(key, group.defaultName ?? group.name)
    visitItems(group.items)
  }

  return { groupDefaults, itemDefaults }
}

/**
 * Filters groups to include only main sidebar items.
 * Excludes items with pageContext 'settings' or 'profile' from customization.
 * Per SPEC-007: Sidebar customization applies only to the main sidebar.
 */
function filterMainSidebarGroups(groups: SidebarGroup[]): SidebarGroup[] {
  const isMainItem = (item: SidebarItem): boolean => {
    if (item.pageContext && item.pageContext !== 'main') return false
    return true
  }

  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter(isMainItem).map((item) => ({
        ...item,
        children: item.children?.filter(isMainItem),
      })),
    }))
    .filter((group) => group.items.length > 0)
}
