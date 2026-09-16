import React, { useState } from 'react';
import { Plus, MoreHorizontal, Star, Library } from 'lucide-react';
import { useT } from '@open-mercato/shared/lib/i18n/context';
import { PaginationProps } from '../types/index';
import { PerspectiveConfig, PerspectiveTemplate, PERSPECTIVE_NAME_MAX_LENGTH } from '../types/perspective';
import { Tab, TabBar } from '../../../primitives-v2';
import PerspectiveTabMenu from './PerspectiveTabMenu';
import PerspectiveDeleteDialog from './PerspectiveDeleteDialog';
import PerspectiveTemplateMenu from './PerspectiveTemplateMenu';
import PerspectivePublishDialog from './PerspectivePublishDialog';

interface PerspectiveTabsProps {
  savedPerspectives: PerspectiveConfig[];
  activePerspectiveId: string | null;
  onPerspectiveSelect: (id: string | null) => void;
  onPerspectiveRename: (id: string, newName: string) => void;
  onPerspectiveDelete: (id: string, hardDelete?: boolean) => void;
  /** Callback when the per-tab edit (pencil) control is clicked. Opens the
   *  Configure View panel pre-populated with that perspective for editing. */
  onPerspectiveEdit?: (id: string) => void;
  /** Copy a view under a new name. Omit to hide "Duplicate view". */
  onPerspectiveDuplicate?: (id: string, newName: string) => void;
  /** Make a view this USER's default. Omit to hide "Set as my default". */
  onPerspectiveSetDefault?: (id: string) => void;
  /** Id of the view that currently opens by default FOR THIS USER. */
  defaultPerspectiveId?: string | null;
  /** Views colleagues published for anyone to copy. */
  sharedTemplates?: PerspectiveTemplate[];
  /** Roles this user may publish to. Omit (or empty) to hide "Share as template…". */
  publishableRoles?: Array<{ id: string; name: string }>;
  /** Publish one of this user's views as a shared template. */
  onPerspectivePublish?: (id: string, roleIds: string[]) => void;
  /** Copy a shared template into this user's own space. */
  onPerspectiveTemplateCopy?: (template: PerspectiveTemplate, newName: string) => void;
  /**
   * Open the Configure View drawer on the BASE tab, so the user can personalize
   * "Default view" itself. Distinct from `onAddPerspective`: that one creates a
   * named view and requires a name.
   */
  onConfigureBaseView?: () => void;
  /**
   * Drop this user's personalization of the base tab and go back to the coded
   * defaults. NOT a delete: the upstream perspectives table soft-deletes while
   * keeping its `(user, tenant, org, table, name)` unique index, so a deleted
   * row would permanently block the next save under the same reserved name.
   * The host empties the row instead — same outcome for the user, and it stays
   * re-personalizable.
   */
  onBaseViewReset?: () => void;
  /** Callback when the "Add view" tab is clicked */
  onAddPerspective?: () => void;
  /**
   * @deprecated No-op since the v2 redesign. Pagination renders as a sibling
   * (`TablePagination`) on the tabs row; this component renders only the
   * underlined top-tabs layout now. Retained for Tier-3 backward compatibility
   * and removed in a future minor.
   */
  pagination?: PaginationProps;
  /**
   * @deprecated No-op since the v2 redesign (the bottom-bar layout was removed).
   * Retained for Tier-3 backward compatibility and removed in a future minor.
   */
  startContent?: React.ReactNode;
  /**
   * @deprecated No-op since the v2 redesign (the bottom-bar layout was removed).
   * Retained for Tier-3 backward compatibility and removed in a future minor.
   */
  endContent?: React.ReactNode;
  /**
   * @deprecated No-op since the v2 redesign (the bottom-bar layout was removed).
   * Retained for Tier-3 backward compatibility and removed in a future minor.
   */
  toolbar?: React.ReactNode;
  /**
   * @deprecated No-op since the v2 redesign — every table renders the top-tabs
   * layout. Retained for Tier-3 backward compatibility and removed in a future minor.
   */
  variant?: 'bottom-bar' | 'top-tabs';
}

const PerspectiveTabs: React.FC<PerspectiveTabsProps> = ({
  savedPerspectives,
  activePerspectiveId,
  onPerspectiveSelect,
  onPerspectiveRename,
  onPerspectiveDelete,
  onPerspectiveEdit,
  onPerspectiveDuplicate,
  onPerspectiveSetDefault,
  defaultPerspectiveId,
  sharedTemplates,
  publishableRoles,
  onPerspectivePublish,
  onPerspectiveTemplateCopy,
  onConfigureBaseView,
  onBaseViewReset,
  onAddPerspective,
}) => {
  const t = useT();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  // A6: every destructive/structural view action lives behind this one trigger.
  const [tabMenu, setTabMenu] = useState<{ id: string; anchorRect: DOMRect } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PerspectiveConfig | null>(null);
  const [templateMenu, setTemplateMenu] = useState<DOMRect | null>(null);
  const [pendingPublish, setPendingPublish] = useState<PerspectiveConfig | null>(null);
  const [baseMenu, setBaseMenu] = useState<DOMRect | null>(null);
  const [pendingBaseReset, setPendingBaseReset] = useState(false);

  const handleDoubleClick = (perspective: PerspectiveConfig) => {
    setEditingId(perspective.id);
    setEditValue(perspective.name);
  };

  const handleRename = (id: string) => {
    if (editValue.trim()) {
      onPerspectiveRename(id, editValue.trim());
    }
    setEditingId(null);
  };

  // Get indicators for a perspective (shown in the tab tooltip)
  const getIndicators = (perspective: PerspectiveConfig) => {
    const indicators: string[] = [];
    if (perspective.columns.hidden.length > 0) {
      indicators.push(`${perspective.columns.hidden.length} ${t('dynamicTable.perspectives.indicator.hidden', 'hidden')}`);
    }
    if (perspective.filters.length > 0) {
      indicators.push(`${perspective.filters.length} ${t('dynamicTable.perspectives.indicator.filters', 'filters')}`);
    }
    if (perspective.sorting.length > 0) {
      indicators.push(`${perspective.sorting.length} ${t('dynamicTable.perspectives.indicator.sorts', 'sorts')}`);
    }
    return indicators;
  };

  /**
   * The user's personalization of the base tab. It is an ordinary personal
   * perspective row, but it gets no tab of its own — the tab it personalizes
   * ("Default view") is already on screen, and a second one would read as two
   * defaults.
   */
  const baseView = savedPerspectives.find(perspective => perspective.isBaseView) ?? null;

  const visiblePerspectives = savedPerspectives.filter(
    perspective => !perspective.id.startsWith('__') && !perspective.isBaseView
  );

  const templates = sharedTemplates ?? [];
  const canPublish = !!onPerspectivePublish && (publishableRoles?.length ?? 0) > 0;
  const canCopyTemplates = !!onPerspectiveTemplateCopy && templates.length > 0;

  /**
   * Keep a generated name inside the API's 120-character cap by trimming the
   * BASE, never the suffix — "… (copy 2)" is the part that carries the meaning,
   * and a name that loses it stops being a distinguishable copy. A name that is
   * already at the cap plus a suffix is exactly how "duplicate a long view"
   * failed with a bare error toast and no copy.
   */
  const withSuffix = (base: string, suffix: string): string => {
    const room = PERSPECTIVE_NAME_MAX_LENGTH - suffix.length;
    return `${room > 0 ? base.slice(0, room).trimEnd() : ''}${suffix}`;
  };

  /** A copied template lands as "<name>", de-duplicated against existing names. */
  const nextCopyOfTemplateName = (base: string): string => {
    const taken = new Set(visiblePerspectives.map(p => p.name));
    const clamped = base.slice(0, PERSPECTIVE_NAME_MAX_LENGTH);
    if (!taken.has(clamped)) return clamped;
    const suffix = t('dynamicTable.perspectives.copySuffix', 'copy');
    let candidate = withSuffix(base, ` (${suffix})`);
    let n = 2;
    while (taken.has(candidate)) {
      candidate = withSuffix(base, ` (${suffix} ${n})`);
      n += 1;
    }
    return candidate;
  };

  const menuPerspective = tabMenu
    ? visiblePerspectives.find(p => p.id === tabMenu.id) ?? null
    : null;

  /** A duplicate lands as "<name> (copy)", de-duplicated against existing names. */
  const nextCopyName = (base: string): string => {
    const taken = new Set(visiblePerspectives.map(p => p.name));
    const suffix = t('dynamicTable.perspectives.copySuffix', 'copy');
    let candidate = withSuffix(base, ` (${suffix})`);
    let n = 2;
    while (taken.has(candidate)) {
      candidate = withSuffix(base, ` (${suffix} ${n})`);
      n += 1;
    }
    return candidate;
  };

  // Always renders the v2 design-system Tab/TabBar (primitives-v2): underlined
  // active tab + "Add view" add control, per the Figma "Table System" frame.
  // Inline rename (double-click) stays as a shortcut; every other view action —
  // including delete — is behind the per-tab `⋯` menu (workshop A6).
  return (
    <>
    <TabBar
      className="hot-top-tabs-v2"
      value={activePerspectiveId ?? ''}
      onChange={(id) => onPerspectiveSelect(id || null)}
      ariaLabel={t('dynamicTable.perspectives.ariaLabel', 'Perspectives')}
    >
      {/* Default (base) view — the unfiltered state. Always present and
          selected when no saved perspective is active. Not deletable.
          Once the user has personalized it, this tab IS that saved row: its
          value becomes the row's id, so selecting it applies their own columns,
          sorting and filters instead of the coded defaults. */}
      <Tab value={baseView?.id ?? ''}>
        {t('dynamicTable.perspectives.defaultView', 'Default view')}
        {defaultPerspectiveId && baseView && defaultPerspectiveId === baseView.id && (
          <span
            className="hot-top-tab-default-v2"
            title={t('dynamicTable.perspectives.isMyDefault', 'This is my default view')}
            aria-label={t('dynamicTable.perspectives.isMyDefault', 'This is my default view')}
          >
            <Star size={10} />
          </span>
        )}
        {/* The base tab gets the same `⋯` as every other tab — that is how a
            user reaches "Configure view…" for the view they actually spend the
            day in. Without it the only way to keep a change to "Default view"
            was to invent a name for it. */}
        {onConfigureBaseView && (
          <span
            role="button"
            aria-haspopup="menu"
            aria-label={t('dynamicTable.perspectives.baseMenu', 'Default view options')}
            className="hot-top-tab-menu-v2"
            data-testid="perspective-base-menu"
            onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              setBaseMenu((prev) => (prev ? null : rect));
            }}
          >
            <MoreHorizontal size={13} />
          </span>
        )}
      </Tab>
      {visiblePerspectives.map(perspective =>
        editingId === perspective.id ? (
          <input
            key={perspective.id}
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            // Same 120-character API cap the Configure View name field enforces.
            // Without it a long rename came back as a bare "Failed to rename
            // perspective" toast with nothing the user could act on.
            maxLength={PERSPECTIVE_NAME_MAX_LENGTH}
            onBlur={() => handleRename(perspective.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRename(perspective.id);
              if (e.key === 'Escape') setEditingId(null);
            }}
            className="hot-top-tab-input"
            autoFocus
          />
        ) : (
          <Tab
            key={perspective.id}
            value={perspective.id}
            onDoubleClick={() => handleDoubleClick(perspective)}
            title={getIndicators(perspective).join(', ') || undefined}
          >
            {perspective.name}
            {defaultPerspectiveId === perspective.id && (
              <span
                className="hot-top-tab-default-v2"
                title={t('dynamicTable.perspectives.isMyDefault', 'This is my default view')}
                aria-label={t('dynamicTable.perspectives.isMyDefault', 'This is my default view')}
              >
                <Star size={10} />
              </span>
            )}
            {/* A6 — one trigger, every view action, delete last and confirmed.
                Replaces the pencil + bare `×` pair: the `×` sat a few pixels
                from the label and removed a saved layout on a single click. */}
            <span
              role="button"
              aria-haspopup="menu"
              aria-label={t('dynamicTable.perspectives.menu', 'View options')}
              className="hot-top-tab-menu-v2"
              data-testid={`perspective-tab-menu-${perspective.id}`}
              onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setTabMenu((prev) => (prev?.id === perspective.id ? null : { id: perspective.id, anchorRect: rect }));
              }}
            >
              <MoreHorizontal size={13} />
            </span>
          </Tab>
        )
      )}
      <Tab
        value="__add__"
        className="hot-top-tab-add-v2"
        onClick={(e) => {
          // Don't let TabBar mark "__add__" active — just open the panel.
          e.preventDefault();
          if (onAddPerspective) onAddPerspective(); else onPerspectiveSelect(null);
        }}
      >
        <Plus size={14} />
        {t('dynamicTable.perspectives.add', 'Add view')}
      </Tab>
      {/* Shared templates. Present only when somebody has actually published
          one: an always-visible empty shelf would be four permanent pixels of
          noise on every grid in the product. */}
      {canCopyTemplates && (
        <Tab
          value="__templates__"
          className="hot-top-tab-add-v2"
          badge={templates.length}
          data-testid="perspective-templates-trigger"
          onClick={(e) => {
            e.preventDefault();
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setTemplateMenu((prev) => (prev ? null : rect));
          }}
        >
          <Library size={14} />
          {t('dynamicTable.perspectives.templates', 'Templates')}
        </Tab>
      )}
    </TabBar>

    {tabMenu && menuPerspective && (
      <PerspectiveTabMenu
        anchorRect={tabMenu.anchorRect}
        perspectiveName={menuPerspective.name}
        isDefault={defaultPerspectiveId === menuPerspective.id}
        onRename={() => handleDoubleClick(menuPerspective)}
        onDuplicate={
          onPerspectiveDuplicate
            ? () => onPerspectiveDuplicate(menuPerspective.id, nextCopyName(menuPerspective.name))
            : undefined
        }
        onSetDefault={
          onPerspectiveSetDefault ? () => onPerspectiveSetDefault(menuPerspective.id) : undefined
        }
        onPublish={canPublish ? () => setPendingPublish(menuPerspective) : undefined}
        isPublished={!!menuPerspective.publication}
        originTemplateName={menuPerspective.origin?.name || null}
        onDelete={() => setPendingDelete(menuPerspective)}
        onEditView={onPerspectiveEdit ? () => onPerspectiveEdit(menuPerspective.id) : undefined}
        onClose={() => setTabMenu(null)}
      />
    )}

    {baseMenu && onConfigureBaseView && (
      <PerspectiveTabMenu
        anchorRect={baseMenu}
        perspectiveName={t('dynamicTable.perspectives.defaultView', 'Default view')}
        isDefault={!!baseView && defaultPerspectiveId === baseView.id}
        // No rename and no duplicate: the base tab is a fixed part of the strip,
        // and "duplicate" is what "Add view" already does from the same state.
        onEditView={() => onConfigureBaseView()}
        onSetDefault={
          baseView && onPerspectiveSetDefault
            ? () => onPerspectiveSetDefault(baseView.id)
            : undefined
        }
        // Reset is offered only when there IS a personalization to undo.
        onDelete={baseView && onBaseViewReset ? () => setPendingBaseReset(true) : undefined}
        deleteLabel={t('dynamicTable.perspectives.resetBaseView', 'Reset to defaults…')}
        onClose={() => setBaseMenu(null)}
      />
    )}

    {templateMenu && (
      <PerspectiveTemplateMenu
        anchorRect={templateMenu}
        templates={templates}
        savedPerspectives={visiblePerspectives}
        onCopy={(template) => {
          onPerspectiveTemplateCopy?.(template, nextCopyOfTemplateName(template.name));
        }}
        onClose={() => setTemplateMenu(null)}
      />
    )}

    <PerspectivePublishDialog
      perspective={pendingPublish}
      roles={publishableRoles ?? []}
      onCancel={() => setPendingPublish(null)}
      onConfirm={(roleIds) => {
        if (pendingPublish) onPerspectivePublish?.(pendingPublish.id, roleIds);
        setPendingPublish(null);
      }}
    />

    <PerspectiveDeleteDialog
      name={pendingDelete?.name ?? null}
      onCancel={() => setPendingDelete(null)}
      onConfirm={() => {
        if (pendingDelete) onPerspectiveDelete(pendingDelete.id, true);
        setPendingDelete(null);
      }}
    />

    <PerspectiveDeleteDialog
      variant="baseReset"
      name={pendingBaseReset && baseView ? baseView.id : null}
      onCancel={() => setPendingBaseReset(false)}
      onConfirm={() => {
        onBaseViewReset?.();
        setPendingBaseReset(false);
      }}
    />
    </>
  );
};

export default PerspectiveTabs;
