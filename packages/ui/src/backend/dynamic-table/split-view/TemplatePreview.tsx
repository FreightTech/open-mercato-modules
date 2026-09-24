'use client'

/**
 * A grid template's thumbnail, drawn from the tree it builds.
 *
 * Deriving the picture from `build()` rather than hand-drawing six icons means
 * a template can never advertise a shape it does not produce.
 */

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { GRID_TEMPLATE_LIST, type GridTemplateId, type LayoutNode } from './types'

export function TemplatePreview({ node, selected }: { node: LayoutNode; selected?: boolean }) {
  if (node.kind !== 'split') {
    return (
      <div
        className={`min-h-0 min-w-0 flex-1 rounded-[2px] ${
          selected
            ? 'bg-[var(--m3-on-secondary-container)] opacity-80'
            : 'bg-[var(--m3-outline)] opacity-60'
        }`}
      />
    )
  }
  return (
    <div className={`flex min-h-0 min-w-0 flex-1 gap-[2px] ${node.direction === 'row' ? 'flex-row' : 'flex-col'}`}>
      {node.children.map((child, index) => (
        <TemplatePreview key={index} node={child} selected={selected} />
      ))}
    </div>
  )
}

/**
 * The six grids as one row of tiles — the drawer's "1 · Wybierz siatkę", the
 * layout menu and a section's own re-arrange menu all use this, so the three
 * places cannot disagree about what a grid looks like.
 */
export function TemplateTiles({
  currentId,
  onPick,
  dataPrefix = 'data-split-template',
}: {
  currentId: GridTemplateId | null
  onPick: (id: GridTemplateId) => void
  dataPrefix?: string
}) {
  const t = useT()
  return (
    <div className="grid grid-cols-6 gap-1.5" role="radiogroup" aria-label={t('splitView.customize.grid', 'Grid')}>
      {GRID_TEMPLATE_LIST.map((template) => {
        const selected = currentId === template.id
        const label = t(`splitView.template.${template.id}`, template.label)
        return (
          <button
            key={template.id}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={label}
            title={`${label} — ${t(`splitView.template.${template.id}.hint`, template.hint)}`}
            onClick={() => onPick(template.id)}
            className={`flex flex-col items-center gap-1 rounded-m3-sm border p-1.5 transition-colors duration-[var(--m3-duration-short2)] ease-m3-standard ${
              selected
                ? 'border-[var(--m3-accent)] bg-[var(--m3-secondary-container)] text-[var(--m3-on-secondary-container)]'
                : 'border-[var(--m3-outline-variant)] bg-[var(--m3-surface-container-lowest)] text-[var(--m3-on-surface-variant)] hover:bg-[var(--m3-container-hover)]'
            }`}
            {...{ [dataPrefix]: template.id }}
          >
            <span className="flex h-5 w-full">
              <TemplatePreview node={template.build()} selected={selected} />
            </span>
            <span className="text-label-semibold-xs">{template.slots}</span>
          </button>
        )
      })}
    </div>
  )
}

export default TemplatePreview
