'use client'

/**
 * "Dostosowanie widoku" — the drawer behind the Dostosuj tab.
 *
 * The designer's process, top to bottom (gt-demo `Przesylki.tsx`, 03.09):
 *
 *   1 · Wybierz siatkę          pick one of six grids
 *   2 · Wypełnij sloty          a live miniature of the grid: fill, swap or
 *                               empty each cell; the sections below the grid
 *                               get the same editor plus their own grid
 *   3 · Zapisz i przełączaj     the saved layouts — apply, rename, share,
 *       wyglądy                 delete — and "save what is on screen"
 *
 * Everything edits the LIVE layout: the workspace behind the drawer changes as
 * you click, which is the point of a drawer over a modal. "Gotowe" only closes;
 * "Wyczyść układ" puts the page back to its own table.
 *
 * The drawer shares its frame with Configure View (`hot-config-panel`), so the
 * two side panels of the grid look like one family.
 */

import * as React from 'react'
import { Check, Pencil, Plus, Share2, Trash2, X } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Sheet, SheetContent } from '../../../primitives/sheet'
import { Button, IconButton } from '../../../primitives-v2'
import { useContentById } from '../registry/ContentRegistryContext'
import { AnchoredPanel, MenuPortalContext } from './AnchoredMenu'
import { ContentCatalogList, contentTitle } from './ContentPicker'
import { SharePanel } from './SharePanel'
import { TemplateTiles } from './TemplatePreview'
import { ICON_BUTTON, TEXT_FIELD } from './chrome'
import { useSplitViewLayouts, type SavedSplitLayout } from './useSplitViewLayouts'
import {
  addBox,
  applyBoxTemplate,
  applyGridTemplate,
  columnsOf,
  countPanes,
  countSlots,
  emptySlotAt,
  fillSlot,
  isDefaultLayout,
  layoutSignature,
  listAllPanes,
  removeBox,
  removePane,
  replaceContent,
  resetLayout,
  templateOf,
  type LayoutNode,
  type PaneContentRef,
  type SplitLayout,
} from './types'

type SetLayout = (update: (current: SplitLayout) => SplitLayout) => void

export type CustomizeDrawerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  layout: SplitLayout
  setLayout: SetLayout
  /** The page's own table — the grid's first cell, labelled "· główna". */
  primaryTableId: string
  primaryPaneId: string | undefined
}

// ─── Sections ────────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-label-semibold-2xs uppercase tracking-wider text-[var(--m3-on-surface-variant)]">
      {children}
    </div>
  )
}

function DrawerSection({ children, ...rest }: React.HTMLAttributes<HTMLElement>) {
  // Sections are separated by a hairline, not by air — "less air, more
  // structure" (gt-demo 647080f).
  return (
    <section
      className="flex flex-col gap-2 border-t border-[var(--m3-outline-variant)] pt-4 first:border-t-0 first:pt-0"
      {...rest}
    >
      {children}
    </section>
  )
}

// ─── Slot editor ─────────────────────────────────────────────────────────────

/** One cell of the miniature: the main table, a filled pane, or a hole. */
function SlotChip({
  node,
  isPrimary,
  onPick,
  onEmpty,
  onRemoveHole,
  canRemoveHole,
}: {
  node: Extract<LayoutNode, { kind: 'pane' | 'empty' }>
  isPrimary: boolean
  onPick: (content: PaneContentRef) => void
  onEmpty: () => void
  onRemoveHole: () => void
  canRemoveHole: boolean
}) {
  const t = useT()
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null)
  const content = node.kind === 'pane' ? node.content : null
  const { item } = useContentById(content)
  const title = item ? contentTitle(t, item) : content?.kind === 'table' ? content.tableId : content?.kind === 'widget' ? content.widgetId : ''

  const picker = anchor && (
    <AnchoredPanel
      anchor={anchor}
      placement={{ width: 300, preferredHeight: 420, align: 'start' }}
      onClose={() => setAnchor(null)}
      data-split-picker=""
    >
      <ContentCatalogList
        exclude={content}
        onPick={(next) => {
          onPick(next)
          setAnchor(null)
        }}
      />
    </AnchoredPanel>
  )

  if (node.kind === 'empty') {
    return (
      <div
        className="relative flex min-h-12 min-w-0 flex-1 items-center justify-center rounded-m3-sm border border-dashed border-[var(--m3-outline-variant)]"
        data-customize-slot="empty"
      >
        <button
          type="button"
          onClick={(event) => setAnchor(event.currentTarget)}
          aria-label={t('splitView.customize.fillSlot', 'Fill this slot')}
          title={t('splitView.customize.fillSlot', 'Fill this slot')}
          className={ICON_BUTTON}
          data-customize-slot-fill={node.id}
        >
          <Plus />
        </button>
        {canRemoveHole && (
          <button
            type="button"
            onClick={onRemoveHole}
            aria-label={t('splitView.slot.remove', 'Remove this slot')}
            title={t('splitView.slot.remove', 'Remove this slot')}
            className={`absolute right-0.5 top-0.5 h-5 w-5 ${ICON_BUTTON} [&_svg]:h-3 [&_svg]:w-3`}
            data-customize-slot-remove={node.id}
          >
            <X />
          </button>
        )}
        {picker}
      </div>
    )
  }

  if (isPrimary) {
    return (
      <div
        className="flex min-h-12 min-w-0 flex-1 items-center rounded-m3-sm bg-[var(--m3-secondary-container)] px-2.5 text-[var(--m3-on-secondary-container)]"
        data-customize-slot="main"
      >
        <span className="truncate text-body-medium-sm" title={title}>
          {t('splitView.customize.mainSlot', '{title} · main', { title })}
        </span>
      </div>
    )
  }

  return (
    <div
      className="flex min-h-12 min-w-0 flex-1 items-center gap-1 rounded-m3-sm bg-[var(--m3-surface-container)] pl-2.5 pr-1"
      data-customize-slot="filled"
    >
      {/* The NAME is the swap control: click it, pick something else, the cell
          keeps its place and size. The designer asked for exactly this in the
          second step (recording 03:17). */}
      <button
        type="button"
        onClick={(event) => setAnchor(event.currentTarget)}
        title={t('splitView.pane.replaceWith', 'Replace with…')}
        className="min-w-0 flex-1 truncate rounded-m3-xs text-left text-body-medium-sm text-[var(--m3-on-surface)] hover:underline"
        data-customize-slot-swap={node.id}
      >
        {title}
      </button>
      <button
        type="button"
        onClick={onEmpty}
        aria-label={t('splitView.customize.emptySlot', 'Empty this slot')}
        title={t('splitView.customize.emptySlot', 'Empty this slot')}
        className={ICON_BUTTON}
        data-customize-slot-empty={node.id}
      >
        <X />
      </button>
      {picker}
    </div>
  )
}

/** The grid in miniature — the same tree, laid out with the same axes and shares. */
function SlotTree({
  node,
  primaryPaneId,
  slotCount,
  setLayout,
}: {
  node: LayoutNode
  primaryPaneId: string | undefined
  slotCount: number
  setLayout: SetLayout
}) {
  if (node.kind === 'split') {
    return (
      <div className={`flex min-w-0 flex-1 gap-1.5 ${node.direction === 'row' ? 'flex-row' : 'flex-col'}`}>
        {node.children.map((child, index) => (
          <div
            key={child.kind === 'split' ? `s${index}` : child.id}
            className="flex min-w-0"
            style={{ flexGrow: node.sizes[index] ?? 1, flexBasis: 0 }}
          >
            <SlotTree node={child} primaryPaneId={primaryPaneId} slotCount={slotCount} setLayout={setLayout} />
          </div>
        ))}
      </div>
    )
  }
  return (
    <SlotChip
      node={node}
      isPrimary={node.id === primaryPaneId}
      canRemoveHole={slotCount > 1}
      onPick={(content) =>
        setLayout((current) =>
          node.kind === 'empty' ? fillSlot(current, node.id, content) : replaceContent(current, node.id, content),
        )
      }
      onEmpty={() => setLayout((current) => emptySlotAt(current, node.id))}
      onRemoveHole={() => setLayout((current) => removePane(current, node.id))}
    />
  )
}

// ─── Saved layouts ───────────────────────────────────────────────────────────

function describe(t: ReturnType<typeof useT>, layout: SplitLayout): string {
  const panes = listAllPanes(layout).length
  const cols = columnsOf(layout.root)
  return t('splitView.layouts.meta', '{panes} panels · {cols} col.', {
    panes: String(panes),
    cols: String(cols),
  })
}

function SavedLayoutRow({
  saved,
  active,
  onApply,
  onRename,
  onDelete,
  onShare,
}: {
  saved: SavedSplitLayout
  active: boolean
  onApply: () => void
  onRename: (name: string) => Promise<boolean>
  onDelete: () => void
  onShare: (userIds: string[]) => Promise<number>
}) {
  const t = useT()
  const [editing, setEditing] = React.useState(false)
  const [name, setName] = React.useState(saved.name)
  const [shareAnchor, setShareAnchor] = React.useState<HTMLElement | null>(null)

  const commit = async () => {
    const next = name.trim()
    if (!next || next === saved.name) {
      setEditing(false)
      setName(saved.name)
      return
    }
    if (await onRename(next)) setEditing(false)
  }

  const meta = saved.sharedByName
    ? `${describe(t, saved.layout)} · ${t('splitView.layouts.from', 'from {name}', { name: saved.sharedByName })}`
    : describe(t, saved.layout)

  return (
    <div
      className={`group flex items-center gap-1 rounded-m3-sm pr-1 transition-colors ${
        active ? 'bg-[var(--m3-secondary-container)]' : 'hover:bg-[var(--m3-state-layer-hover)]'
      }`}
      data-split-layout-row={saved.name}
      data-active={active ? 'true' : undefined}
    >
      {editing ? (
        <div className="flex min-w-0 flex-1 items-center gap-1 py-1 pl-1">
          <input
            autoFocus
            // Renaming usually means replacing: start with the name selected.
            onFocus={(event) => event.currentTarget.select()}
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void commit()
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                setEditing(false)
                setName(saved.name)
              }
            }}
            className={`${TEXT_FIELD} flex-1`}
            aria-label={t('splitView.layouts.rename', 'Rename')}
            data-split-layout-rename-input={saved.name}
          />
          <button
            type="button"
            onClick={() => void commit()}
            aria-label={t('splitView.layouts.renameSave', 'Save name')}
            className={ICON_BUTTON}
            data-split-layout-rename-save={saved.name}
          >
            <Check />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onApply}
          className={`flex min-w-0 flex-1 flex-col items-start gap-px px-2.5 py-2 text-left ${
            active ? 'text-[var(--m3-on-secondary-container)]' : 'text-[var(--m3-on-surface)]'
          }`}
          data-split-layout-open={saved.name}
        >
          <span className="max-w-full truncate text-body-medium-sm">{saved.name}</span>
          <span
            className={`max-w-full truncate text-body-regular-xs ${
              active ? 'text-[var(--m3-on-secondary-container)] opacity-80' : 'text-[var(--m3-on-surface-variant)]'
            }`}
          >
            {meta}
          </span>
        </button>
      )}
      {!editing && active && (
        <Check className="h-4 w-4 shrink-0 text-[var(--m3-on-secondary-container)]" aria-hidden="true" />
      )}
      {!editing && (
        <>
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label={t('splitView.layouts.renameNamed', 'Rename {name}', { name: saved.name })}
            title={t('splitView.layouts.rename', 'Rename')}
            className={ICON_BUTTON}
            data-split-layout-rename={saved.name}
          >
            <Pencil />
          </button>
          <button
            type="button"
            onClick={(event) => setShareAnchor(event.currentTarget)}
            aria-label={t('splitView.share.named', 'Share {name}', { name: saved.name })}
            title={t('splitView.share.action', 'Share')}
            className={ICON_BUTTON}
            data-split-layout-share={saved.name}
          >
            <Share2 />
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label={t('splitView.layouts.deleteNamed', 'Delete {name}', { name: saved.name })}
            title={t('splitView.layouts.delete', 'Delete')}
            className={`${ICON_BUTTON} hover:bg-[var(--m3-state-layer-error-hover)] hover:text-[var(--m3-error)]`}
            data-split-layout-delete={saved.name}
          >
            <Trash2 />
          </button>
        </>
      )}
      {shareAnchor && (
        <SharePanel
          anchor={shareAnchor}
          layoutName={saved.name}
          onShare={onShare}
          onClose={() => setShareAnchor(null)}
        />
      )}
    </div>
  )
}

// ─── Drawer ──────────────────────────────────────────────────────────────────

export function CustomizeDrawer({
  open,
  onOpenChange,
  layout,
  setLayout,
  primaryTableId,
  primaryPaneId,
}: CustomizeDrawerProps) {
  const t = useT()
  const { layouts, save, remove, rename, share } = useSplitViewLayouts(primaryTableId)
  const [saveName, setSaveName] = React.useState('')
  const [portalTarget, setPortalTarget] = React.useState<HTMLElement | null>(null)

  const signature = layoutSignature(layout)
  const activeId = layouts.find((saved) => layoutSignature(saved.layout) === signature)?.id ?? null
  const isDefault = isDefaultLayout(layout, primaryTableId)
  const currentTemplate = isDefault ? null : templateOf(layout.root)
  const mainSlots = countSlots(layout.root)
  const boxes = layout.boxes ?? []

  const saveCurrent = async () => {
    const name = saveName.trim() || t('splitView.layouts.defaultName', 'Layout {n}', { n: String(layouts.length + 1) })
    const saved = await save(name, layout)
    if (saved) setSaveName('')
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        ariaTitle={t('splitView.customize.title', 'Customize view')}
        hideCloseButton
        className="hot-config-panel hot-appearance-v2"
        overlayClassName="hot-config-overlay !backdrop-blur-none"
        // The dialog contract: Cmd/Ctrl+Enter is "Gotowe", Escape cancels
        // (Radix closes the sheet on Escape itself).
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault()
            onOpenChange(false)
          }
        }}
        data-split-customize=""
      >
        <MenuPortalContext.Provider value={portalTarget}>
        <div className="hot-config-panel-inner" ref={setPortalTarget}>
          <div className="hot-config-panel-header">
            <div className="hot-config-panel-header-row">
              <h3 className="hot-config-panel-title">{t('splitView.customize.title', 'Customize view')}</h3>
              <IconButton
                size="sm"
                aria-label={t('splitView.customize.close', 'Close')}
                icon={<X className="h-4 w-4" />}
                onClick={() => onOpenChange(false)}
              />
            </div>
            {/* The design's header is the title alone; the sentence stays for
                screen readers, who get no picture of the three steps. */}
            <p className="sr-only">
              {t('splitView.customize.subtitle', 'Pick a grid, fill it with tables and widgets, and save it as a layout.')}
            </p>
          </div>

          <div className="hot-config-panel-body !gap-4 pb-4">
            <DrawerSection data-customize-step="grid">
              <SectionLabel>{t('splitView.customize.step1', '1 · Choose a grid')}</SectionLabel>
              <TemplateTiles
                currentId={currentTemplate}
                onPick={(id) => setLayout((current) => applyGridTemplate(current, id, primaryPaneId))}
              />
            </DrawerSection>

            <DrawerSection data-customize-step="slots">
              <SectionLabel>{t('splitView.customize.step2', '2 · Fill the slots')}</SectionLabel>
              {isDefault ? (
                <p className="text-body-regular-sm text-[var(--m3-on-surface-variant)]" data-customize-slots-empty="">
                  {t(
                    'splitView.customize.onlyMain',
                    'Only the main view so far — choose a grid above to add slots for tables and widgets.',
                  )}
                </p>
              ) : (
                <div className="flex min-h-12 w-full" data-customize-slots="main">
                  <SlotTree node={layout.root} primaryPaneId={primaryPaneId} slotCount={mainSlots} setLayout={setLayout} />
                </div>
              )}

              {boxes.map((box, index) => (
                <div key={box.id} className="mt-2 flex flex-col gap-1.5" data-customize-box={box.id}>
                  <div className="flex items-center gap-2">
                    <span className="text-label-semibold-xs text-[var(--m3-on-surface)]">
                      {t('splitView.box.label', 'Section {n}', { n: String(index + 2) })}
                    </span>
                    <span className="text-body-regular-xs text-[var(--m3-on-surface-variant)]">
                      {t('splitView.box.capacity', '{count} of {max}', {
                        count: String(countPanes(box.root)),
                        max: '4',
                      })}
                    </span>
                    <span className="flex-1" />
                    <button
                      type="button"
                      onClick={() => setLayout((current) => removeBox(current, box.id))}
                      className="rounded-m3-full px-2 py-0.5 text-label-semibold-xs text-[var(--m3-error)] transition-colors hover:bg-[var(--m3-state-layer-error-hover)]"
                      data-customize-box-remove={box.id}
                    >
                      {t('splitView.box.remove', 'Remove section')}
                    </button>
                  </div>
                  <TemplateTiles
                    currentId={templateOf(box.root)}
                    onPick={(id) => setLayout((current) => applyBoxTemplate(current, box.id, id))}
                    dataPrefix="data-customize-box-template"
                  />
                  <div className="flex min-h-12 w-full">
                    <SlotTree
                      node={box.root}
                      primaryPaneId={primaryPaneId}
                      slotCount={countSlots(box.root)}
                      setLayout={setLayout}
                    />
                  </div>
                </div>
              ))}

              {!isDefault && (
                <button
                  type="button"
                  onClick={() => setLayout((current) => addBox(current))}
                  className="flex h-8 items-center gap-1.5 self-start rounded-m3-full px-2 text-label-medium-md text-[var(--m3-on-surface)] transition-colors hover:bg-[var(--m3-state-layer-hover)]"
                  data-customize-add-box=""
                >
                  <Plus className="h-4 w-4 text-[var(--m3-on-surface-variant)]" />
                  {t('splitView.box.add', 'Add section')}
                </button>
              )}
            </DrawerSection>

            <DrawerSection data-customize-step="layouts">
              <SectionLabel>{t('splitView.customize.step3', '3 · Save and switch layouts')}</SectionLabel>
              <div className="flex flex-col gap-0.5" data-split-layouts-menu="">
                {/* The way back. The designer asked for it in the picker
                    (recording 02:13); it lives here too so the list of "things
                    this page can look like" is complete in one place. */}
                <div
                  className={`flex items-center gap-1 rounded-m3-sm pr-2 transition-colors ${
                    isDefault ? 'bg-[var(--m3-secondary-container)]' : 'hover:bg-[var(--m3-state-layer-hover)]'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setLayout((current) => resetLayout(current, primaryTableId))}
                    className={`flex min-w-0 flex-1 flex-col items-start gap-px px-2.5 py-2 text-left ${
                      isDefault ? 'text-[var(--m3-on-secondary-container)]' : 'text-[var(--m3-on-surface)]'
                    }`}
                    data-split-layout-default=""
                  >
                    <span className="text-body-medium-sm">{t('splitView.layouts.default', 'Default view')}</span>
                    <span
                      className={`text-body-regular-xs ${
                        isDefault ? 'text-[var(--m3-on-secondary-container)] opacity-80' : 'text-[var(--m3-on-surface-variant)]'
                      }`}
                    >
                      {t('splitView.layouts.defaultMeta', 'The page’s own table')}
                    </span>
                  </button>
                  {isDefault && <Check className="h-4 w-4 shrink-0 text-[var(--m3-on-secondary-container)]" aria-hidden="true" />}
                </div>

                {layouts.map((saved) => (
                  <SavedLayoutRow
                    key={saved.id}
                    saved={saved}
                    active={saved.id === activeId}
                    onApply={() => setLayout(() => saved.layout)}
                    onRename={(name) => rename(saved.id, name)}
                    onDelete={() => void remove(saved.id)}
                    onShare={(userIds) => share(saved.id, userIds)}
                  />
                ))}
              </div>

              <div className="mt-1 flex items-center gap-2">
                <input
                  value={saveName}
                  onChange={(event) => setSaveName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      // Enter (with or without Cmd/Ctrl) saves this field — it
                      // must not bubble up and close the drawer as well.
                      event.preventDefault()
                      event.stopPropagation()
                      void saveCurrent()
                    }
                  }}
                  placeholder={t('splitView.layouts.namePlaceholder', 'Layout name…')}
                  className={`${TEXT_FIELD} flex-1`}
                  data-split-layout-name=""
                />
                <Button variant="outline" size="sm" onClick={() => void saveCurrent()} data-split-layout-save="">
                  {t('splitView.layouts.saveCurrent', 'Save current')}
                </Button>
              </div>
            </DrawerSection>
          </div>

          <div className="hot-config-panel-footer !justify-between">
            <Button
              variant="ghost"
              size="md"
              onClick={() => setLayout((current) => resetLayout(current, primaryTableId))}
              data-customize-clear=""
            >
              {t('splitView.customize.clear', 'Clear layout')}
            </Button>
            <Button variant="primary" size="md" onClick={() => onOpenChange(false)} data-customize-done="">
              {t('splitView.customize.done', 'Done')}
            </Button>
          </div>
        </div>
        </MenuPortalContext.Provider>
      </SheetContent>
    </Sheet>
  )
}

export default CustomizeDrawer
