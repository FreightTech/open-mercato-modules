'use client';

/**
 * Import from a file: choose → inspect → commit → (undo).
 *
 * The panel is deliberately thin. It uploads bytes and renders whatever the
 * server made of them; it does NOT parse the file, because a client parse plus
 * a server parse is how a preview and its commit drift apart. `importParse.ts`
 * is server-only and is never imported here.
 *
 * The inspection point is mandatory, not a toggle: there is no code path from
 * "file chosen" to "records written" that skips the preview. Import is the
 * highest-blast-radius write in the product, and "nothing is saved yet" is the
 * property that makes it safe to use.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { AlertTriangle, FileSpreadsheet, Undo2, Upload } from 'lucide-react';
import { useT } from '@open-mercato/shared/lib/i18n/context';
import { Button } from '../../../primitives/button';
import { apiCall } from '../../utils/apiCall';
import { flash } from '../../FlashMessages';
import ImportPreviewGrid from './ImportPreviewGrid';
import type {
  ImportCommitResponse,
  ImportMapping,
  ImportMode,
  ImportPreviewResponse,
  ImportRevertResponse,
} from '../types/import';

export interface ImportPanelProps {
  /** `POST` multipart endpoint that returns an `ImportPreviewResponse`. */
  previewUrl: string;
  /** Given a batch id, the endpoint that commits it. */
  commitUrl: (importBatchId: string) => string;
  /** Given a batch id, the endpoint that reverts it. */
  revertUrl: (importBatchId: string) => string;
  /** Modes to offer. Defaults to both. */
  modes?: ImportMode[];
  /** Called after a successful commit (and after a revert) so the list refetches. */
  onChanged?: () => void;
  /** Called when the user cancels out of the panel. */
  onClose?: () => void;
}

type Phase = 'choose' | 'preview' | 'committed';

const ACCEPT = '.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

interface ServerError {
  error?: string;
  messageKey?: string;
  details?: Record<string, unknown>;
}

const ImportPanel: React.FC<ImportPanelProps> = ({
  previewUrl,
  commitUrl,
  revertUrl,
  modes = ['create', 'upsert_id'],
  onChanged,
  onClose,
}) => {
  const t = useT();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [phase, setPhase] = useState<Phase>('choose');
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<ImportMode>(modes[0] ?? 'create');
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null);
  const [commitResult, setCommitResult] = useState<ImportCommitResponse | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  const modeLabels: Record<ImportMode, string> = useMemo(
    () => ({
      create: t('dynamicTable.import.modeCreate', 'Add new rows'),
      upsert_id: t('dynamicTable.import.modeUpsertId', 'Update rows matched by id'),
    }),
    [t],
  );

  /** Turn a server error body into something a person can act on. */
  const describeError = useCallback(
    (body: ServerError | null, fallback: string): string => {
      if (!body) return fallback;
      if (body.messageKey === 'dynamicTable.import.tooManyRows') {
        return t(
          'dynamicTable.import.tooManyRows',
          'This file has {count} rows; the limit is {limit}. Split it and import in parts.',
          body.details as Record<string, string | number> | undefined,
        );
      }
      if (body.messageKey) {
        return t(
          body.messageKey,
          body.error ?? fallback,
          body.details as Record<string, string | number> | undefined,
        );
      }
      return body.error ?? fallback;
    },
    [t],
  );

  const runPreview = useCallback(
    async (nextFile: File, nextMode: ImportMode, mapping?: ImportMapping) => {
      setBusy(true);
      setErrorText(null);
      try {
        const form = new FormData();
        form.append('file', nextFile);
        form.append('mode', nextMode);
        if (mapping) form.append('mapping', JSON.stringify(mapping));

        const { ok, result } = await apiCall<ImportPreviewResponse & ServerError>(previewUrl, {
          method: 'POST',
          body: form,
        });
        if (!ok || !result || !('importBatchId' in result)) {
          setErrorText(
            describeError(
              result as ServerError | null,
              t('dynamicTable.import.previewFailed', 'The file could not be read'),
            ),
          );
          return;
        }
        setPreview(result as ImportPreviewResponse);
        setPhase('preview');
      } finally {
        setBusy(false);
      }
    },
    [previewUrl, describeError, t],
  );

  const onFileChosen = useCallback(
    (chosen: File | null) => {
      if (!chosen) return;
      setFile(chosen);
      setCommitResult(null);
      void runPreview(chosen, mode);
    },
    [mode, runPreview],
  );

  const onModeChange = useCallback(
    (next: ImportMode) => {
      setMode(next);
      // Re-previewing is the whole point: a different mode is a different set
      // of decisions, and showing the old preview beside the new mode would be
      // a lie.
      if (file) void runPreview(file, next, preview?.mapping);
    },
    [file, preview, runPreview],
  );

  const onCommit = useCallback(async () => {
    if (!preview) return;
    setBusy(true);
    setErrorText(null);
    try {
      const { ok, result } = await apiCall<ImportCommitResponse & ServerError>(
        commitUrl(preview.importBatchId),
        { method: 'POST' },
      );
      if (!ok || !result || !('created' in result)) {
        setErrorText(
          describeError(
            result as ServerError | null,
            t('dynamicTable.import.commitFailed', 'The import could not be completed'),
          ),
        );
        return;
      }
      setCommitResult(result as ImportCommitResponse);
      setPhase('committed');
      flash(
        t('dynamicTable.import.summary', '{created} new, {updated} updated, {skipped} skipped, {failed} with errors', {
          created: result.created,
          updated: result.updated,
          skipped: preview.summary.skipped,
          failed: result.failed,
        }),
        'success',
      );
      onChanged?.();
    } finally {
      setBusy(false);
    }
  }, [preview, commitUrl, describeError, onChanged, t]);

  const onRevert = useCallback(async () => {
    if (!commitResult) return;
    setBusy(true);
    setErrorText(null);
    try {
      const { ok, result } = await apiCall<ImportRevertResponse & ServerError>(
        revertUrl(commitResult.importBatchId),
        { method: 'POST' },
      );
      if (!ok || !result || !('restored' in result)) {
        setErrorText(
          describeError(
            result as ServerError | null,
            t('dynamicTable.import.revertFailed', 'The import could not be undone'),
          ),
        );
        return;
      }
      const reverted = result.restored + result.deleted;
      flash(t('dynamicTable.import.reverted', 'Reverted {count} rows', { count: reverted }), 'success');
      if (result.refused.length) {
        // Refusals are surfaced, never swallowed: a partial revert the user
        // does not know about is worse than no revert.
        flash(
          t(
            'dynamicTable.import.revertRefused',
            '{count} rows were changed since the import and were left alone',
            { count: result.refused.length },
          ),
          'error',
        );
      }
      onChanged?.();
      onClose?.();
    } finally {
      setBusy(false);
    }
  }, [commitResult, revertUrl, describeError, onChanged, onClose, t]);

  const reset = useCallback(() => {
    setPhase('choose');
    setFile(null);
    setPreview(null);
    setCommitResult(null);
    setErrorText(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  return (
    <div className="flex flex-col gap-4" data-testid="import-panel">
      <div>
        <h3 className="text-heading-bold-lg">{t('dynamicTable.import.title', 'Import from file')}</h3>
      </div>

      {errorText ? (
        <div
          className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3"
          role="alert"
          data-testid="import-error"
        >
          <AlertTriangle className="mt-0.5 size-4 text-destructive" aria-hidden />
          <p className="text-body-regular-sm text-destructive">{errorText}</p>
        </div>
      ) : null}

      {/* ── Choose ─────────────────────────────────────────────────── */}
      {phase === 'choose' ? (
        <div className="flex flex-col gap-3">
          {/* A `<span>`, not a `<label htmlFor>`. `htmlFor` only binds to a form
              control, and the target here is a `<div>` of buttons — so the
              caption was announced as loose text and the group had no name at
              all. `aria-labelledby` on a `role="group"` is the binding that
              actually works. */}
          <span className="text-label-medium-md" id="import-mode-label">
            {t('dynamicTable.import.mode', 'What should this file do?')}
          </span>
          <div
            className="flex flex-wrap gap-2"
            role="group"
            aria-labelledby="import-mode-label"
          >
            {modes.map((m) => (
              <Button
                key={m}
                type="button"
                size="sm"
                variant={m === mode ? 'default' : 'outline'}
                // Which mode is chosen was carried by fill colour alone, so it
                // did not survive a screen reader (or greyscale). `aria-pressed`
                // states it.
                aria-pressed={m === mode}
                onClick={() => setMode(m)}
                data-testid={`import-mode-${m}`}
              >
                {modeLabels[m]}
              </Button>
            ))}
          </div>

          <button
            type="button"
            className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border p-8 hover:bg-accent"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
            data-testid="import-dropzone"
          >
            <Upload className="size-6 text-muted-foreground" aria-hidden />
            <span className="text-body-regular-sm text-muted-foreground">
              {t('dynamicTable.import.dropFile', 'Drop a CSV or Excel file, or browse')}
            </span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT}
            className="sr-only"
            data-testid="import-file-input"
            onChange={(e) => onFileChosen(e.target.files?.[0] ?? null)}
          />
        </div>
      ) : null}

      {/* ── Preview — nothing is written yet ───────────────────────── */}
      {phase === 'preview' && preview ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <FileSpreadsheet className="size-4 text-muted-foreground" aria-hidden />
            <span className="text-body-medium-sm">{preview.sourceFileName}</span>
            <span className="text-body-regular-xs text-muted-foreground">{modeLabels[preview.mode]}</span>
          </div>

          <h4 className="text-heading-semibold-md" data-testid="import-preview-heading">
            {t('dynamicTable.import.previewHeading', 'Review {count} rows before importing', {
              count: preview.rows.length,
            })}
          </h4>
          <p className="text-body-regular-sm text-muted-foreground" data-testid="import-summary">
            {t(
              'dynamicTable.import.summary',
              '{created} new, {updated} updated, {skipped} skipped, {failed} with errors',
              {
                created: preview.summary.created,
                updated: preview.summary.updated,
                skipped: preview.summary.skipped,
                failed: preview.summary.failed,
              },
            )}
          </p>

          {preview.mappingIssues.length ? (
            <ul className="flex flex-col gap-1" data-testid="import-mapping-issues">
              {preview.mappingIssues.map((issue, i) => (
                <li key={`${issue.code}-${issue.label}-${i}`} className="text-body-regular-xs text-muted-foreground">
                  {issue.code === 'relation_unsupported'
                    ? t(
                        'dynamicTable.import.relationUnsupported',
                        '{column} links to another record and cannot be imported here',
                        { column: issue.label },
                      )
                    : issue.code === 'missing_required'
                      ? t('dynamicTable.import.missingRequired', '{column} is required and is not in this file', {
                          column: issue.label,
                        })
                      : issue.code === 'duplicate_field'
                        ? t('dynamicTable.import.duplicateField', 'Two columns both map to {column}', {
                            column: issue.label,
                          })
                        : t('dynamicTable.import.unknownField', '{column} does not match any field', {
                            column: issue.label,
                          })}
                </li>
              ))}
            </ul>
          ) : null}

          <ImportPreviewGrid rows={preview.rows} fields={preview.fields} mapping={preview.mapping} />

          <p className="text-body-regular-xs text-muted-foreground" data-testid="import-cancel-safe">
            {t('dynamicTable.import.cancelSafe', 'Nothing has been saved yet')}
          </p>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={onCommit}
              disabled={busy || preview.summary.created + preview.summary.updated === 0}
              data-testid="import-commit"
            >
              {t('dynamicTable.import.commit', 'Import {count} rows', {
                count: preview.summary.created + preview.summary.updated,
              })}
            </Button>
            <Button type="button" variant="outline" onClick={reset} disabled={busy} data-testid="import-cancel">
              {t('dynamicTable.import.cancel', 'Cancel')}
            </Button>
            {modes.length > 1
              ? modes
                  .filter((m) => m !== preview.mode)
                  .map((m) => (
                    <Button
                      key={m}
                      type="button"
                      variant="ghost"
                      onClick={() => onModeChange(m)}
                      disabled={busy}
                      data-testid={`import-switch-mode-${m}`}
                    >
                      {modeLabels[m]}
                    </Button>
                  ))
              : null}
          </div>
        </div>
      ) : null}

      {/* ── Committed — undo is offered right here, while it still matters ── */}
      {phase === 'committed' && commitResult ? (
        <div className="flex flex-col gap-3" data-testid="import-result">
          <p className="text-body-regular-sm">
            {t(
              'dynamicTable.import.summary',
              '{created} new, {updated} updated, {skipped} skipped, {failed} with errors',
              {
                created: commitResult.created,
                updated: commitResult.updated,
                skipped: preview?.summary.skipped ?? 0,
                failed: commitResult.failed,
              },
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onRevert}
              disabled={busy}
              data-testid="import-revert"
            >
              <Undo2 className="size-4" aria-hidden />
              {t('dynamicTable.import.revert', 'Undo this import')}
            </Button>
            <Button type="button" variant="ghost" onClick={() => { reset(); onClose?.(); }} disabled={busy}>
              {t('dynamicTable.import.done', 'Done')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default ImportPanel;
