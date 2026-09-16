import React, { useCallback, useMemo, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useT } from '@open-mercato/shared/lib/i18n/context';
import { Button, Input } from '../../../primitives-v2';
import type { ColumnDef } from '../types/index';
import type { FormulaColumnRef, FormulaIssue, FormulaResultType } from '../formula/types';
import { formulaIssueI18nKey } from '../formula/types';
import { checkFormulaColumn, fieldMetaFromColumns } from '../formula/check';
import { evaluateExpression } from '../formula/evaluate';
import { FORMULA_FUNCTION_SIGNATURES } from '../formula/functions';
import {
  formatFormulaValue,
  isFormulaColumnKey,
  uniqueFormulaColumnKey,
} from '../utils/formulaColumns';

export interface ConfigureViewFormulasProps {
  /** Calculated columns currently on the view. */
  formulas: FormulaColumnRef[];
  onFormulasChange: (refs: FormulaColumnRef[]) => void;
  /** Every column a formula may reference. Calculated columns are excluded — a
   *  formula reads them by key, and offering them here invites cycles. */
  columns: ColumnDef[];
  /** Current column visibility. A new calculated column is switched ON: the
   *  user just wrote it, so hiding it would read as the save having failed. */
  visibleColumns: string[];
  hiddenColumns: string[];
  onColumnVisibilityChange: (visible: string[], hidden: string[]) => void;
  /** One loaded row, used for the live preview. Optional: without it the editor
   *  still validates, it just cannot show a number yet. */
  sampleRow?: Record<string, unknown>;
  /**
   * Authoring gate. OPEN by default — `packages/ui` ships no ACL of its own; a
   * host that wants `<module>.<entity>.formula.manage` passes `false` here.
   */
  canManage?: boolean;
}

const RESULT_TYPES: FormulaResultType[] = ['number', 'text', 'boolean', 'date'];

interface DraftState {
  /** Key being edited, or null when adding a new column. */
  editingKey: string | null;
  label: string;
  expression: string;
  resultType: FormulaResultType;
}

const EMPTY_DRAFT: DraftState = {
  editingKey: null,
  label: '',
  expression: '',
  resultType: 'number',
};

/**
 * "Calculated columns": the Configure View section that authors a view-scoped
 * formula column.
 *
 * Validation is live and at DEFINITION time — an unknown column reference or a
 * self-reference is refused here, so a saved view can never contain one and no
 * cell has to discover it at render time.
 */
const ConfigureViewFormulas: React.FC<ConfigureViewFormulasProps> = ({
  formulas,
  onFormulasChange,
  columns,
  visibleColumns,
  hiddenColumns,
  onColumnVisibilityChange,
  sampleRow,
  canManage = true,
}) => {
  const t = useT();
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT);
  const [isEditorOpen, setEditorOpen] = useState(false);
  const [showFunctions, setShowFunctions] = useState(false);

  const referenceableColumns = useMemo(
    () => columns.filter((c) => !isFormulaColumnKey(c.data)),
    [columns],
  );
  const fields = useMemo(() => fieldMetaFromColumns(referenceableColumns), [referenceableColumns]);

  const draftKey = useMemo(() => {
    if (draft.editingKey) return draft.editingKey;
    return uniqueFormulaColumnKey(draft.label || 'calc', formulas.map((f) => f.key));
  }, [draft.editingKey, draft.label, formulas]);

  const draftRef: FormulaColumnRef = useMemo(
    () => ({
      key: draftKey,
      label: draft.label.trim() || draftKey,
      expression: draft.expression,
      resultType: draft.resultType,
    }),
    [draftKey, draft.label, draft.expression, draft.resultType],
  );

  // Live validation. An empty expression is "not yet", not "wrong" — the user is
  // still typing, so no error is shown and the save button is simply disabled.
  const issues: FormulaIssue[] = useMemo(() => {
    if (!draft.expression.trim()) return [];
    const checked = checkFormulaColumn({ ref: draftRef, fields, existing: formulas });
    return checked.ok ? [] : checked.issues;
  }, [draft.expression, draftRef, fields, formulas]);

  const preview = useMemo(() => {
    if (!sampleRow || issues.length > 0 || !draft.expression.trim()) return null;
    return evaluateExpression(draft.expression, sampleRow, fields, draft.resultType);
  }, [sampleRow, issues.length, draft.expression, draft.resultType, fields]);

  const canSave = draft.label.trim().length > 0 && draft.expression.trim().length > 0 && issues.length === 0;

  const translateIssue = useCallback(
    (issue: FormulaIssue) => t(formulaIssueI18nKey(issue), issue.message, issue.params),
    [t],
  );

  const resetDraft = useCallback(() => {
    setDraft(EMPTY_DRAFT);
    setEditorOpen(false);
    setShowFunctions(false);
  }, []);

  const handleSave = useCallback(() => {
    if (!canSave) return;
    const existingIndex = formulas.findIndex((f) => f.key === draftRef.key);
    const next =
      existingIndex >= 0
        ? formulas.map((f, i) => (i === existingIndex ? draftRef : f))
        : [...formulas, draftRef];
    onFormulasChange(next);

    if (existingIndex < 0) {
      onColumnVisibilityChange(
        visibleColumns.includes(draftRef.key) ? visibleColumns : [...visibleColumns, draftRef.key],
        hiddenColumns.filter((k) => k !== draftRef.key),
      );
    }
    resetDraft();
  }, [
    canSave,
    formulas,
    draftRef,
    onFormulasChange,
    onColumnVisibilityChange,
    visibleColumns,
    hiddenColumns,
    resetDraft,
  ]);

  const handleEdit = useCallback((ref: FormulaColumnRef) => {
    setDraft({
      editingKey: ref.key,
      label: ref.label,
      expression: ref.expression,
      resultType: ref.resultType,
    });
    setEditorOpen(true);
  }, []);

  const handleRemove = useCallback(
    (key: string) => {
      onFormulasChange(formulas.filter((f) => f.key !== key));
      onColumnVisibilityChange(
        visibleColumns.filter((k) => k !== key),
        hiddenColumns.filter((k) => k !== key),
      );
      if (draft.editingKey === key) resetDraft();
    },
    [formulas, onFormulasChange, onColumnVisibilityChange, visibleColumns, hiddenColumns, draft.editingKey, resetDraft],
  );

  const insert = useCallback((snippet: string) => {
    setDraft((prev) => ({
      ...prev,
      expression: prev.expression ? `${prev.expression.trimEnd()} ${snippet}` : snippet,
    }));
  }, []);

  /** A column key needs bracketing when it is not a bare identifier. */
  const fieldToken = (key: string) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? key : `[${key}]`);

  const typeLabel = (type: FormulaResultType) =>
    t(`dynamicTable.formula.type.${type}`, type);

  return (
    <div className="hot-config-section-body flex flex-col gap-3" data-testid="formula-section">
      <p className="text-body-regular-xs text-m3-on-surface-variant">
        {t(
          'dynamicTable.formula.displayOnlyNote',
          'Calculated columns are shown for the rows on this page. They cannot be sorted or filtered.',
        )}
      </p>

      {/* Existing calculated columns */}
      {formulas.length > 0 && (
        <ul className="flex flex-col gap-1.5" data-testid="formula-list">
          {formulas.map((ref) => (
            <li
              key={ref.key}
              data-testid={`formula-row-${ref.key}`}
              className="flex items-center gap-2 rounded-m3-md border border-m3-outline-variant px-2.5 py-2"
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-body-medium-sm truncate">{ref.label}</span>
                <span className="text-code-regular-sm truncate text-m3-on-surface-variant" data-testid={`formula-expression-${ref.key}`}>
                  {ref.expression}
                </span>
              </span>
              <span className="text-label-semibold-xs shrink-0 text-m3-on-surface-variant">
                {typeLabel(ref.resultType)}
              </span>
              {canManage && (
                <>
                  <button
                    type="button"
                    aria-label={t('dynamicTable.formula.edit', 'Edit')}
                    className="shrink-0 rounded-m3-xs p-1 text-m3-on-surface-variant hover:bg-[var(--m3-state-layer-hover)] hover:text-m3-on-surface"
                    style={{ transition: 'var(--m3-transition-state)' }}
                    onClick={() => handleEdit(ref)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={t('dynamicTable.formula.remove', 'Remove')}
                    className="shrink-0 rounded-m3-xs p-1 text-m3-on-surface-variant hover:bg-[var(--m3-state-layer-hover)] hover:text-m3-on-surface"
                    style={{ transition: 'var(--m3-transition-state)' }}
                    onClick={() => handleRemove(ref.key)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {formulas.length === 0 && !isEditorOpen && (
        <p className="hot-config-empty-hint text-body-regular-xs text-m3-on-surface-variant">
          {t('dynamicTable.formula.empty', 'No calculated columns yet.')}
        </p>
      )}

      {/* Inline add row — never a modal.

          `.hot-config-add-btn`, not an outline Button: the Configure View
          drawer has SEVEN "add" affordances (filter, sort, group, sum,
          highlighting rule, summarised column, calculated column) and six of
          them are this borderless accent link. This one was the odd one out —
          a bordered button sitting directly above "+ Add rule" in the very next
          section, so the drawer offered two different-looking controls for the
          same verb. Conforming to the majority keeps one idiom. */}
      {canManage && !isEditorOpen && (
        <button
          type="button"
          className="hot-config-add-btn"
          data-testid="formula-add"
          onClick={() => {
            setDraft(EMPTY_DRAFT);
            setEditorOpen(true);
          }}
        >
          <Plus className="w-3.5 h-3.5" aria-hidden />
          {t('dynamicTable.formula.addColumn', 'Add a calculated column')}
        </button>
      )}

      {canManage && isEditorOpen && (
        <div className="flex flex-col gap-2.5 rounded-m3-md border border-m3-outline-variant p-2.5" data-testid="formula-editor">
          <label className="text-label-semibold-xs text-m3-on-surface-variant" htmlFor="formula-label-input">
            {t('dynamicTable.formula.columnName', 'Column name')}
          </label>
          <Input
            id="formula-label-input"
            inputSize="sm"
            data-testid="formula-label"
            value={draft.label}
            placeholder={t('dynamicTable.formula.columnNamePlaceholder', 'e.g. Margin')}
            onChange={(e) => setDraft((prev) => ({ ...prev, label: e.target.value }))}
          />

          <label className="text-label-semibold-xs text-m3-on-surface-variant" htmlFor="formula-expression-input">
            {t('dynamicTable.formula.expression', 'Formula')}
          </label>
          <Input
            id="formula-expression-input"
            inputSize="sm"
            data-testid="formula-expression"
            className="text-code-regular-md"
            value={draft.expression}
            hasError={issues.length > 0}
            placeholder={t('dynamicTable.formula.expressionPlaceholder', 'revenue - cost')}
            onChange={(e) => setDraft((prev) => ({ ...prev, expression: e.target.value }))}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleSave();
              if (e.key === 'Escape') resetDraft();
            }}
          />

          {/* Field picker — clicking inserts the reference, so nobody has to
              guess how a column key is spelled. */}
          <div className="flex flex-wrap gap-1" data-testid="formula-fields">
            {referenceableColumns.map((col) => (
              <button
                key={col.data}
                type="button"
                className="text-code-regular-sm rounded-m3-xs border border-m3-outline-variant px-1.5 py-0.5 hover:bg-[var(--m3-state-layer-hover)]"
                style={{ transition: 'var(--m3-transition-state)' }}
                onClick={() => insert(fieldToken(col.data))}
                title={col.data}
              >
                {col.title ?? col.data}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-label-semibold-xs text-m3-on-surface-variant">
              {t('dynamicTable.formula.resultType', 'Result type')}
            </span>
            <div className="flex gap-1" role="radiogroup" aria-label={t('dynamicTable.formula.resultType', 'Result type')}>
              {RESULT_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  role="radio"
                  aria-checked={draft.resultType === type}
                  data-testid={`formula-type-${type}`}
                  /* Selected reads as ONE hue. It used to pair a TEAL border
                     (`--accent-v2`, the focus colour) with `text-primary`, so
                     the checked chip announced itself in two different colours
                     at once. Both halves now take `--m3-accent`, the selection
                     blue every other selected surface in the grid uses. */
                  className={`text-label-medium-md rounded-m3-md border px-2.5 py-1 ${
                    draft.resultType === type
                      ? 'border-m3-accent text-[var(--m3-accent)]'
                      : 'border-m3-outline-variant text-m3-on-surface-variant hover:bg-[var(--m3-state-layer-hover)]'
                  }`}
                  style={{ transition: 'var(--m3-transition-state)' }}
                  onClick={() => setDraft((prev) => ({ ...prev, resultType: type }))}
                >
                  {typeLabel(type)}
                </button>
              ))}
            </div>
          </div>

          {issues.length > 0 && (
            <ul className="flex flex-col gap-0.5" data-testid="formula-errors">
              {issues.map((issue, i) => (
                <li
                  key={`${issue.code}-${i}`}
                  className="text-body-regular-xs text-destructive-v2"
                  data-formula-error={issue.code}
                >
                  {translateIssue(issue)}
                </li>
              ))}
            </ul>
          )}

          {preview && (
            <p className="text-body-regular-xs text-m3-on-surface-variant" data-testid="formula-preview">
              {t('dynamicTable.formula.preview', 'First row: {value}', {
                value:
                  preview.state === 'empty'
                    ? t('dynamicTable.formula.previewEmpty', 'empty')
                    : formatFormulaValue(preview),
              })}
            </p>
          )}

          <button
            type="button"
            className="text-body-regular-xs self-start text-m3-on-surface-variant underline"
            onClick={() => setShowFunctions((v) => !v)}
            data-testid="formula-functions-toggle"
          >
            {t('dynamicTable.formula.functionList', 'Available functions')}
          </button>
          {showFunctions && (
            <ul className="flex flex-col gap-0.5" data-testid="formula-functions">
              {FORMULA_FUNCTION_SIGNATURES.map((fn) => (
                <li key={fn.name}>
                  <button
                    type="button"
                    className="text-code-regular-sm w-full rounded-m3-xs px-1 py-0.5 text-left hover:bg-[var(--m3-state-layer-hover)]"
                    style={{ transition: 'var(--m3-transition-state)' }}
                    onClick={() => insert(`${fn.name}(`)}
                  >
                    {fn.signature}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="flex-1" onClick={resetDraft}>
              {t('dynamicTable.formula.cancel', 'Cancel')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              className="flex-1"
              disabled={!canSave}
              data-testid="formula-save"
              onClick={handleSave}
            >
              {t('dynamicTable.formula.save', 'Save column')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ConfigureViewFormulas;
