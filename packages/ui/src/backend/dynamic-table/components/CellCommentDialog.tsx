import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ListChecks, MapPin, Send, Truck } from 'lucide-react';
import ReactDOM from 'react-dom';
import { useT } from '@open-mercato/shared/lib/i18n/context';
import { apiCall } from '../../utils/apiCall';
import { flash } from '../../FlashMessages';
import { annotationIdBatches } from '../hooks/useAnnotations';
import MentionPopup from './MentionPopup';
import { CommentMarkdown, toggleTaskInContent } from './commentMarkdown';
import type { MentionPopupHandle } from './MentionPopup';

/**
 * The swatch picker. `bg` names the SAME token the annotated cell paints with
 * (`--m3-annotation-*`), so the swatch always shows exactly the colour the cell
 * will take.
 *
 * These used to be hardcoded light hexes, which meant the swatch was wrong in
 * dark mode and needed a parallel `.dark .hot-comment-color-btn[data-color=…]`
 * block in DynamicTable.css to re-tint all seven. That block is deleted: the
 * token already carries its own dark value, so one reference covers both themes
 * and there is no second list of colours to keep in sync with this one.
 */
const ANNOTATION_COLORS = [
  { value: null, label: 'None', bg: 'transparent' },
  { value: 'gray', label: 'Gray', bg: 'var(--m3-annotation-gray)' },
  { value: 'pink', label: 'Pink', bg: 'var(--m3-annotation-pink)' },
  { value: 'orange', label: 'Orange', bg: 'var(--m3-annotation-orange)' },
  { value: 'yellow', label: 'Yellow', bg: 'var(--m3-annotation-yellow)' },
  { value: 'green', label: 'Green', bg: 'var(--m3-annotation-green)' },
  { value: 'blue', label: 'Blue', bg: 'var(--m3-annotation-blue)' },
  { value: 'purple', label: 'Purple', bg: 'var(--m3-annotation-purple)' },
] as const;

/** The palette's colour names in the screen's language (FMS acc-v17 D2.05: 'None/Pink/Orange' showed in a Polish desk). */
function paletteLabel(t: ReturnType<typeof useT>, item: (typeof ANNOTATION_COLORS)[number]): string {
  return t(`dynamicTable.palette.${item.value ?? 'none'}`, item.label);
}

const MENTION_PATTERN = /@\[([^\]]+)\]\(([^)]+)\)/g;

/** Who the note is for — see `packages/annotations` (workshop B8c). */
type CommentAudience = 'internal' | 'carrier';

interface Comment {
  id: string;
  userId: string;
  userName?: string;
  content: string;
  createdAt: string;
  audience?: CommentAudience;
  cellLabel?: string;
  /** Owning annotation id — needed to delete a comment in bulk mode (each
      bulk comment can belong to a different cell's annotation). */
  annotationId?: string;
  /** The server's word on whether this person may delete it (its author, or annotations.delete — GEPARD-307).
      Absent from a server that predates it: the bin shows, as it always did. */
  canDelete?: boolean;
  /** GEPARD-310 — `where_added`: shown only in the table and on the grid row it was written on. */
  visibility?: 'everywhere' | 'where_added';
  originTableId?: string | null;
  originRowId?: string | null;
}

/** GEPARD-310 — a comment kept to its table and grid row shows only there; every other comment shows on every row. */
function showsHere(c: Pick<Comment, 'visibility' | 'originTableId' | 'originRowId'>, tableId: string | undefined, rowKeys: ReadonlySet<string>): boolean {
  if (c.visibility !== 'where_added' || !c.originRowId) return true;
  return !!tableId && c.originTableId === tableId && rowKeys.has(c.originRowId);
}

const commentPlace = (c: any) => ({
  visibility: c.visibility === 'where_added' ? ('where_added' as const) : ('everywhere' as const),
  originTableId: c.originTableId ?? null,
  originRowId: c.originRowId ?? null,
});

/** GEPARD-308 — how long the thread's re-read after a burst of ticks may take before the bubble falls back. */
export const COMMENT_REREAD_TIMEOUT_MS = 10_000;

/** A delete is refused with a message, never by a trip to the login page (GEPARD-307). */
const DELETE_INIT = { method: 'DELETE', headers: { 'x-om-forbidden-redirect': '0' } } as const;

const deletable = (c: Comment) => c.canDelete !== false;

interface BulkCell {
  /**
   * B8a — a range can span two scopes. On the transport list a selection that
   * covers `containerNumber` and `truckPlate` targets the CONTAINER for one and
   * the LEG for the other, so the batch write is grouped by `entityType` rather
   * than assuming one for the whole rectangle.
   */
  entityType: string;
  rowId: string;
  columnKey: string;
  /** GEPARD-310 — the grid row this cell of the range is on. */
  originRowId?: string;
}

interface PendingMention {
  id: string;
  name: string;
}

interface MentionState {
  active: boolean;
  startIndex: number;
  query: string;
}

interface CellCommentDialogProps {
  isOpen: boolean;
  onClose: () => void;
  entityType: string;
  viewContext?: string;
  rowId: string;
  columnKey: string;
  columnTitle: string;
  rowLabel?: string;
  annotationId?: string | null;
  currentColor?: string | null;
  onAnnotationChange?: () => void;
  /** Position the popover near this rect (from the clicked cell) */
  anchorRect?: DOMRect | null;
  /** When provided, dialog operates in bulk mode — color picker only, no comments */
  bulkCells?: BulkCell[];
  /**
   * GEPARD-310 — the grid row the dialog was opened on (the row's own key). A comment written here records it, with
   * the table (`viewContext`), so that one kept to where it was added shows on this row only.
   */
  originRowId?: string;
}

function extractMentionIds(text: string): string[] {
  const ids: string[] = [];
  const regex = new RegExp(MENTION_PATTERN.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    ids.push(match[2]);
  }
  return ids;
}

const CellCommentDialog: React.FC<CellCommentDialogProps> = ({
  isOpen,
  onClose,
  entityType,
  viewContext,
  rowId,
  columnKey,
  columnTitle,
  rowLabel,
  annotationId: initialAnnotationId,
  currentColor: initialColor,
  onAnnotationChange,
  anchorRect,
  bulkCells,
  originRowId,
}) => {
  const t = useT();
  const isBulkMode = bulkCells && bulkCells.length > 1;
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [selectedColor, setSelectedColor] = useState<string | null>(initialColor || null);
  const [annotationId, setAnnotationId] = useState<string | null>(initialAnnotationId || null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // GEPARD-319 — the colour row opens from one dot instead of standing in the bubble.
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mentionState, setMentionState] = useState<MentionState | null>(null);
  const [pendingMentions, setPendingMentions] = useState<PendingMention[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mentionRef = useRef<MentionPopupHandle>(null);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current && !panelRef.current.contains(target)) {
        // Don't close if clicking on the mention popup (it's portaled outside the panel)
        const mentionEl = mentionRef.current?.getElement();
        if (mentionEl && mentionEl.contains(target)) return;
        onClose();
      }
    };
    // Delay to avoid catching the triggering click
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  // Close on Escape (only when mention popup is not active)
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !mentionState?.active) onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, mentionState]);

  // Reset mention state when dialog closes
  useEffect(() => {
    if (!isOpen) {
      setMentionState(null);
      setPendingMentions([]);
      setPaletteOpen(false);
    }
  }, [isOpen]);

  // GEPARD-319 — the field grows with what is written (2 lines to 8), so the bubble stays small until it is needed.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [newComment]);

  // Read the cell's thread (single-cell mode). `quiet`: no loading state — a re-read after ticking a task (GEPARD-308).
  // Resolves true when the server answered.
  const loadThread = useCallback(async (quiet = false, signal?: AbortSignal): Promise<boolean> => {
    if (isBulkMode || !annotationId) return false;
    if (!quiet) setLoading(true);
    try {
      const params = new URLSearchParams({ entityType, rowIds: rowId });
      if (viewContext) params.set('tableId', viewContext);
      const { ok, result } = await apiCall<any>(`/api/annotations/annotations?${params}`, signal ? { signal } : undefined);
      if (ok && result) {
        const items: any[] = result.items || result.data || result || [];
        const annotation = items.find((a: any) =>
          (a.columnKey || a.column_key) === columnKey
        );
        if (annotation?.comments) {
          const here = new Set(originRowId ? [originRowId] : []);
          setComments(annotation.comments.filter((c: any) => showsHere(commentPlace(c), viewContext, here)).map((c: any) => ({
            id: c.id,
            userId: c.userId || c.user_id,
            userName: c.userName || c.user_name || 'User',
            content: c.content,
            audience: (c.audience as CommentAudience) ?? 'internal',
            createdAt: c.createdAt || c.created_at,
            canDelete: typeof c.canDelete === 'boolean' ? c.canDelete : undefined,
            ...commentPlace(c),
          })));
        }
        return ok;
      }
      return false;
    } catch (error) {
      console.error('Failed to fetch comments:', error);
      return false;
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [isBulkMode, annotationId, entityType, rowId, columnKey, viewContext, originRowId]);

  // Fetch comments when dialog opens (single-cell mode)
  useEffect(() => {
    if (!isOpen || isBulkMode || !annotationId) {
      if (!isBulkMode) setComments([]);
      return;
    }
    void loadThread();
  }, [isOpen, isBulkMode, annotationId, loadThread]);

  // Fetch comments for all selected cells (bulk mode). Resolves true when every part was read; a quiet re-read
  // (GEPARD-308) replaces the thread only then — a partial read would drop the comments of the part that failed.
  const fetchBulkComments = useCallback(async (quiet = false, signal?: AbortSignal): Promise<boolean> => {
    if (!bulkCells || bulkCells.length === 0) return false;

    if (!quiet) setLoading(true);
    try {
      // One request per SCOPE — a range may cover container-scoped and
      // leg-scoped columns at once (B8a).
      const groups = new Map<string, Set<string>>();
      for (const cell of bulkCells) {
        const existing = groups.get(cell.entityType);
        if (existing) existing.add(cell.rowId);
        else groups.set(cell.entityType, new Set([cell.rowId]));
      }
      const cellKeySet = new Set(bulkCells.map((c) => `${c.entityType}:${c.rowId}:${c.columnKey}`));
      let complete = true;
      const responses = await Promise.all(
        Array.from(groups.entries()).flatMap(([type, rowIds]) =>
          // A range over many rows: its ids in parts, as useAnnotations reads them (CR13).
          annotationIdBatches(rowIds).map(async (part) => {
            const params = new URLSearchParams({ entityType: type, rowIds: part.join(',') });
            if (viewContext) params.set('tableId', viewContext);
            const { ok, result } = await apiCall<any>(`/api/annotations/annotations?${params}`, signal ? { signal } : undefined);
            if (!ok || !result) {
              complete = false;
              return [] as any[];
            }
            const items: any[] = result.items || result.data || result || [];
            return items.map((item) => ({ ...item, entityType: item.entityType ?? type }));
          }),
        ),
      );
      {
        const items = responses.flat();
        const allComments: Comment[] = [];
        const rangeRows = new Set(bulkCells.map((c) => c.originRowId).filter((k): k is string => !!k));
        for (const annotation of items) {
          const aType = annotation.entityType || annotation.entity_type || '';
          const aRowId = annotation.rowId || annotation.row_id;
          const aColKey = annotation.columnKey || annotation.column_key;
          if (!cellKeySet.has(`${aType}:${aRowId}:${aColKey}`)) continue;
          const cellLabel = aColKey;
          for (const c of (annotation.comments || [])) {
            if (!showsHere(commentPlace(c), viewContext, rangeRows)) continue;
            allComments.push({
              id: c.id,
              userId: c.userId || c.user_id,
              userName: c.userName || c.user_name || 'User',
              content: c.content,
              audience: (c.audience as CommentAudience) ?? 'internal',
              createdAt: c.createdAt || c.created_at,
              cellLabel,
              annotationId: annotation.id || annotation.annotationId,
              canDelete: typeof c.canDelete === 'boolean' ? c.canDelete : undefined,
              ...commentPlace(c),
            });
          }
        }
        allComments.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        if (complete || !quiet) setComments(allComments);
      }
      return complete;
    } catch (error) {
      console.error('Failed to fetch bulk comments:', error);
      return false;
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [bulkCells, viewContext]);

  useEffect(() => {
    if (!isOpen || !isBulkMode) return;
    fetchBulkComments();
  }, [isOpen, isBulkMode, fetchBulkComments]);

  // Handle textarea changes — detect @ trigger and sync pending mentions
  const handleTextareaChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    const cursorPos = e.target.selectionStart ?? value.length;
    setNewComment(value);

    // Sync pending mentions: remove any whose display name (@name) is no longer in text
    setPendingMentions((prev) => prev.filter((m) => {
      const displayText = `@${m.name}`;
      return value.includes(displayText);
    }));

    // Detect @ trigger: look backwards from cursor for an unmatched @
    const textBeforeCursor = value.slice(0, cursorPos);
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');

    if (lastAtIndex >= 0) {
      const charBeforeAt = lastAtIndex > 0 ? textBeforeCursor[lastAtIndex - 1] : ' ';
      const isStartOfWord = lastAtIndex === 0 || /\s/.test(charBeforeAt);
      const textAfterAt = textBeforeCursor.slice(lastAtIndex + 1);

      if (isStartOfWord && (textAfterAt.length === 0 || !/\s/.test(textAfterAt.slice(0, 1)))) {
        const query = textAfterAt;
        if (query.length <= 30 && !/\n/.test(query)) {
          setMentionState({ active: true, startIndex: lastAtIndex, query });
          return;
        }
      }
    }

    setMentionState(null);
  }, []);

  // Build wire format from display text + pending mentions on submit
  const buildWireContent = useCallback((displayText: string): string => {
    let result = displayText;
    // Replace each @displayName with @[displayName](id) for pending mentions
    for (const m of pendingMentions) {
      const displayMention = `@${m.name}`;
      const wireMention = `@[${m.name}](${m.id})`;
      result = result.replace(displayMention, wireMention);
    }
    return result;
  }, [pendingMentions]);

  // Handle mention selection from popup
  const handleMentionSelect = useCallback((user: { id: string; name: string; email: string }) => {
    if (!mentionState || !textareaRef.current) return;

    const displayName = user.name || user.email;
    const before = newComment.slice(0, mentionState.startIndex);
    const after = newComment.slice(mentionState.startIndex + 1 + mentionState.query.length);
    const displayText = `@${displayName}`;
    const updatedComment = before + displayText + ' ' + after;

    setNewComment(updatedComment);
    setPendingMentions((prev) => {
      if (prev.some((m) => m.id === user.id)) return prev;
      return [...prev, { id: user.id, name: displayName }];
    });
    setMentionState(null);

    // Restore focus to textarea
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        const cursorPos = before.length + displayText.length + 1;
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(cursorPos, cursorPos);
      }
    });
  }, [mentionState, newComment]);

  // Ensure annotation exists, then add comment
  const handleSubmitComment = useCallback(async () => {
    if (!newComment.trim() || submitting) return;

    setSubmitting(true);
    try {
      let currentAnnotationId = annotationId;

      // Create annotation if it doesn't exist
      if (!currentAnnotationId) {
        const { ok, result: created } = await apiCall<any>('/api/annotations/annotations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            entityType,
            tableId: viewContext,
            rowId,
            columnKey,
            color: selectedColor,
          }),
        });
        if (ok && created) {
          currentAnnotationId = created.id || created.data?.id;
          setAnnotationId(currentAnnotationId);
        } else {
          return;
        }
      }

      const mentionedUserIds = pendingMentions.map((m) => m.id);
      const wireContent = buildWireContent(newComment.trim());

      // Add comment
      const { ok: commentOk, result: commentResult } = await apiCall<any>(
        `/api/annotations/annotations/${currentAnnotationId}/comments`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: wireContent,
            // GEPARD-310 — where it is written: the table's (or the system's) setting decides whether it shows only here.
            ...(viewContext ? { originTableId: viewContext } : {}),
            ...(originRowId ? { originRowId } : {}),
            // FMS messaging 1.4: the column's title and the row's name, so the mention says where it was written.
            ...(mentionedUserIds.length > 0 ? { mentionedUserIds, columnTitle: columnTitle || null, rowLabel: rowLabel || null } : {}),
          }),
        },
      );

      if (commentOk && commentResult) {
        const newCommentObj: Comment = {
          id: commentResult.id || commentResult.data?.id,
          userId: commentResult.userId || commentResult.user_id || '',
          userName: commentResult.userName || commentResult.user_name || 'You',
          content: wireContent,
          audience: 'internal',
          createdAt: new Date().toISOString(),
          canDelete: true,
          visibility: commentResult.visibility === 'where_added' ? 'where_added' : 'everywhere',
          originTableId: viewContext ?? null,
          originRowId: originRowId ?? null,
        };
        setComments(prev => [...prev, newCommentObj]);
        setNewComment('');
        setPendingMentions([]);
        onAnnotationChange?.();
      }
    } catch (error) {
      console.error('Failed to submit comment:', error);
    } finally {
      setSubmitting(false);
    }
  }, [newComment, submitting, annotationId, entityType, viewContext, rowId, columnKey, selectedColor, onAnnotationChange, pendingMentions, buildWireContent, originRowId]);

  // Bulk color change — calls PUT batch endpoint
  const handleBulkColorChange = useCallback(async (color: string | null) => {
    if (!bulkCells || bulkCells.length === 0) return;
    setSelectedColor(color);

    try {
      // One PUT per scope — the batch endpoint takes a single `entityType`, and
      // a range can legitimately span two (B8a).
      const groups = new Map<string, BulkCell[]>();
      for (const cell of bulkCells) {
        const existing = groups.get(cell.entityType);
        if (existing) existing.push(cell);
        else groups.set(cell.entityType, [cell]);
      }
      await Promise.all(
        Array.from(groups.entries()).map(([type, cells]) =>
          apiCall('/api/annotations/annotations', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              entityType: type,
              tableId: viewContext,
              cells: cells.map((c) => ({ rowId: c.rowId, columnKey: c.columnKey })),
              color,
            }),
          }),
        ),
      );
      onAnnotationChange?.();
    } catch (error) {
      console.error('Failed to batch update colors:', error);
    }
  }, [bulkCells, viewContext, onAnnotationChange]);

  // Bulk comment — sends comment to all selected cells via PUT batch endpoint
  const handleBulkSubmitComment = useCallback(async () => {
    if (!bulkCells || bulkCells.length === 0 || !newComment.trim() || submitting) return;

    setSubmitting(true);
    try {
      const mentionedUserIds = pendingMentions.map((m) => m.id);
      const wireContent = buildWireContent(newComment.trim());
      const groups = new Map<string, BulkCell[]>();
      for (const cell of bulkCells) {
        const existing = groups.get(cell.entityType);
        if (existing) existing.push(cell);
        else groups.set(cell.entityType, [cell]);
      }
      await Promise.all(
        Array.from(groups.entries()).map(([type, cells]) =>
          apiCall('/api/annotations/annotations', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              entityType: type,
              tableId: viewContext,
              cells: cells.map((c) => ({ rowId: c.rowId, columnKey: c.columnKey, ...(c.originRowId ? { originRowId: c.originRowId } : {}) })),
              comment: wireContent,
              ...(viewContext ? { originTableId: viewContext } : {}),
              ...(mentionedUserIds.length > 0 ? { mentionedUserIds } : {}),
            }),
          }),
        ),
      );
      setNewComment('');
      setPendingMentions([]);
      onAnnotationChange?.();
      fetchBulkComments();
    } catch (error) {
      console.error('Failed to batch add comment:', error);
    } finally {
      setSubmitting(false);
    }
  }, [bulkCells, viewContext, newComment, submitting, onAnnotationChange, fetchBulkComments, pendingMentions, buildWireContent]);

  // Update color
  const handleColorChange = useCallback(async (color: string | null) => {
    if (isBulkMode) {
      return handleBulkColorChange(color);
    }

    setSelectedColor(color);

    try {
      if (annotationId) {
        await apiCall(`/api/annotations/annotations?id=${annotationId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ color }),
        });
      } else if (color) {
        // Create annotation when picking a color on a cell that has none yet
        const { ok, result: created } = await apiCall<any>('/api/annotations/annotations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entityType, tableId: viewContext, rowId, columnKey, color }),
        });
        if (ok && created) {
          setAnnotationId(created.id || created.data?.id);
        }
      }
      onAnnotationChange?.();
    } catch (error) {
      console.error('Failed to update color:', error);
    }
  }, [isBulkMode, handleBulkColorChange, annotationId, entityType, viewContext, rowId, columnKey, onAnnotationChange]);

  // Delete one comment. In bulk mode each comment carries its own annotation id
  // (cells differ); in single mode it falls back to the dialog's annotationId.
  const handleDeleteComment = useCallback(async (commentId: string, commentAnnotationId?: string) => {
    const annId = commentAnnotationId || annotationId;
    if (!annId) return;

    try {
      const { ok, result } = await apiCall<{ error?: string }>(`/api/annotations/annotations/${annId}/comments?commentId=${commentId}`, DELETE_INIT);
      if (ok) {
        setComments(prev => prev.filter(c => c.id !== commentId));
        onAnnotationChange?.();
      } else {
        flash(result?.error || t('annotations.dialog.deleteFailed', 'The comment was not deleted'), 'error');
      }
    } catch (error) {
      console.error('Failed to delete comment:', error);
      flash(t('annotations.dialog.deleteFailed', 'The comment was not deleted'), 'error');
    }
  }, [annotationId, onAnnotationChange, t]);

  // Bulk: delete every comment shown across the selected cells. A refused one stays in the list (GEPARD-307).
  const handleDeleteAllComments = useCallback(async () => {
    const toDelete = comments.slice();
    const kept = new Set<string>();
    let refusal: string | null = null;
    for (const c of toDelete) {
      const annId = c.annotationId || annotationId;
      if (!annId) continue;
      try {
        const { ok, result } = await apiCall<{ error?: string }>(`/api/annotations/annotations/${annId}/comments?commentId=${c.id}`, DELETE_INIT);
        if (!ok) {
          kept.add(c.id);
          refusal = refusal ?? (result?.error || null);
        }
      } catch (error) {
        console.error('Failed to delete comment:', error);
        kept.add(c.id);
      }
    }
    setComments(prev => prev.filter(c => kept.has(c.id)));
    if (kept.size) flash(refusal || t('annotations.dialog.deleteFailed', 'The comment was not deleted'), 'error');
    onAnnotationChange?.();
  }, [comments, annotationId, onAnnotationChange, t]);

  // GEPARD-319 — a task in a comment ("- [ ] …") is ticked in place; the server flips that one mark, shown at once.
  // GEPARD-308 (CHECK #3238, p2B's re-check): ticks in quick succession queue on the server's row lock in an order the
  // bubble cannot know — the newer click may get the lock first — so no single answer is the stored text. While a tick
  // of the comment is still out, answers are held (the optimistic marks stay); when the last one settles, the thread is
  // read again from the server (its stored text), the grid refreshed once. Should that read fail: the answer that came
  // last, or — all refused — the text before the ticks.
  const ticks = useRef(new Map<string, { pending: number; last: string | null; before: string }>());
  const handleToggleTask = useCallback(async (comment: Comment, index: number, done: boolean) => {
    const annId = comment.annotationId || annotationId;
    if (!annId) return;
    let burst = ticks.current.get(comment.id);
    if (!burst) {
      burst = { pending: 0, last: null, before: comment.content };
      ticks.current.set(comment.id, burst);
    }
    burst.pending += 1;
    const setContent = (content: string) => setComments((prev) => prev.map((c) => (c.id === comment.id ? { ...c, content } : c)));
    // A click is a discrete event: the thread re-renders between two clicks, so `comment` already holds the last tick.
    setContent(toggleTaskInContent(comment.content, index, done));
    try {
      const { ok, result } = await apiCall<{ content?: string; error?: string }>(
        `/api/annotations/annotations/${annId}/comments?commentId=${comment.id}`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'x-om-forbidden-redirect': '0' }, body: JSON.stringify({ task: index, done }) },
      );
      if (!ok) flash(result?.error || t('annotations.dialog.taskFailed', 'The task was not saved'), 'error');
      else if (typeof result?.content === 'string') burst.last = result.content;
    } catch (error) {
      console.error('Failed to tick a task:', error);
      flash(t('annotations.dialog.taskFailed', 'The task was not saved'), 'error');
    } finally {
      burst.pending -= 1;
      if (burst.pending === 0) {
        ticks.current.delete(comment.id);
        // The re-read has 10 s; past that it counts as failed and the fallback below shows.
        const limit = new AbortController();
        const timer = setTimeout(() => limit.abort(), COMMENT_REREAD_TIMEOUT_MS);
        const read = isBulkMode ? fetchBulkComments(true, limit.signal) : loadThread(true, limit.signal);
        const stored = await read.catch(() => false);
        clearTimeout(timer);
        if (!stored) setContent(burst.last ?? burst.before);
        if (burst.last !== null) onAnnotationChange?.();
      }
    }
  }, [annotationId, onAnnotationChange, t, isBulkMode, fetchBulkComments, loadThread]);

  // GEPARD-319 — "- [ ] " at the start of the line the caret is on (a new line when that one has text).
  const insertTask = useCallback(() => {
    const el = textareaRef.current;
    const value = newComment;
    const at = el ? el.selectionStart ?? value.length : value.length;
    const lineStart = value.lastIndexOf('\n', at - 1) + 1;
    const lineEnd = value.indexOf('\n', at) === -1 ? value.length : value.indexOf('\n', at);
    const line = value.slice(lineStart, lineEnd);
    const next = line.trim()
      ? `${value.slice(0, lineEnd)}\n- [ ] ${value.slice(lineEnd)}`
      : `${value.slice(0, lineStart)}- [ ] ${value.slice(lineStart)}`;
    const caret = line.trim() ? lineEnd + 7 : lineStart + 6;
    setNewComment(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(caret, caret);
    });
  }, [newComment]);

  const formatTimeAgo = (dateStr: string) => {
    const date = new Date(dateStr);
    const diffMin = Math.floor((Date.now() - date.getTime()) / 60000);
    if (!Number.isFinite(diffMin) || diffMin < 1) return t('annotations.dialog.justNow', 'just now');
    if (diffMin < 60) return t('annotations.dialog.minutesAgo', '{count} min', { count: diffMin });
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return t('annotations.dialog.hoursAgo', '{count} h', { count: diffHour });
    return t('annotations.dialog.daysAgo', '{count} d', { count: Math.floor(diffHour / 24) });
  };

  if (!isOpen) return null;

  const title = isBulkMode
    ? `${bulkCells!.length} cells selected`
    : rowLabel
      ? `${rowLabel} - ${columnTitle}`
      : columnTitle;

  // Position: below the anchor when there's more room there, else above. Cap the
  // panel height to the available space so a long comment thread scrolls INSIDE
  // the panel instead of running off the bottom of the viewport.
  // GEPARD-319 — narrower: the thread is what the bubble is for.
  const panelWidth = 360;
  let top: number | undefined;
  let bottomPx: number | undefined;
  let left = 0;
  let panelMaxHeight = 520;
  if (anchorRect) {
    const spaceBelow = window.innerHeight - anchorRect.bottom;
    const spaceAbove = anchorRect.top;
    const spaceRight = window.innerWidth - anchorRect.left;
    if (spaceBelow >= spaceAbove) {
      top = anchorRect.bottom + 4;
      panelMaxHeight = Math.min(520, Math.max(180, spaceBelow - 12));
    } else {
      bottomPx = window.innerHeight - anchorRect.top + 4;
      panelMaxHeight = Math.min(520, Math.max(180, spaceAbove - 12));
    }
    left = spaceRight > panelWidth ? anchorRect.left : window.innerWidth - panelWidth - 12;
  }

  const textareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>, submitFn: () => void) => {
    if (mentionState?.active) return;
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      submitFn();
    }
    if (e.key === 'Escape') {
      onClose();
    }
  };

  const panel = (
    <div
      ref={panelRef}
      className="hot-comment-popover"
      style={{
        position: 'fixed',
        top: anchorRect ? top : '50%',
        bottom: anchorRect ? (bottomPx != null ? `${bottomPx}px` : undefined) : undefined,
        left: anchorRect ? left : '50%',
        transform: anchorRect ? undefined : 'translate(-50%, -50%)',
        width: panelWidth,
        maxHeight: anchorRect ? `${panelMaxHeight}px` : undefined,
        zIndex: 10000,
      }}
    >
      <div className="hot-comment-popover-header">
        <span className="hot-comment-popover-title" title={title}>{title}</span>
        <button type="button" className="hot-comment-popover-close" onClick={onClose} aria-label={t('annotations.dialog.close', 'Close')}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>

      {/* Comments Thread — the bubble's content first (GEPARD-319). */}
      {(loading || comments.length > 0) && (
      <div className="hot-comment-thread">
        {loading ? (
          <div className="hot-comment-loading">{t('annotations.dialog.loading', 'Loading comments...')}</div>
        ) : (
          comments.map(comment => (
            <div key={comment.id} className="hot-comment-item">
              <div className="hot-comment-item-header">
                <span className="hot-comment-author">{comment.userName || t('annotations.dialog.you', 'You')}</span>
                {comment.cellLabel ? <span className="hot-comment-action">{comment.cellLabel}</span> : null}
                {comment.audience === 'carrier' && (
                  <span className="hot-comment-audience-tag" title={t('annotations.dialog.audienceCarrierHint', 'Printed on the carrier document')}>
                    <Truck size={10} />
                    {t('annotations.dialog.audienceCarrierShort', 'carrier')}
                  </span>
                )}
                {comment.visibility === 'where_added' && (
                  <span
                    className="hot-comment-audience-tag"
                    data-comment-where-added=""
                    title={t('annotations.dialog.whereAddedHint', 'Shown only in this table, on this row')}
                  >
                    <MapPin size={10} />
                    {t('annotations.dialog.whereAddedShort', 'only here')}
                  </span>
                )}
                <span className="hot-comment-time">{formatTimeAgo(comment.createdAt)}</span>
                {deletable(comment) && (
                  <button
                    type="button"
                    className="hot-comment-delete"
                    onClick={() => handleDeleteComment(comment.id, comment.annotationId)}
                    title={t('annotations.dialog.delete', 'Delete comment')}
                    aria-label={t('annotations.dialog.delete', 'Delete comment')}
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2.5 4h11M5.5 4V2.5a1 1 0 011-1h3a1 1 0 011 1V4M6.5 7v4M9.5 7v4M3.5 4l.5 9a1.5 1.5 0 001.5 1.5h5a1.5 1.5 0 001.5-1.5l.5-9" />
                    </svg>
                  </button>
                )}
              </div>
              <div className="hot-comment-content">
                <CommentMarkdown
                  content={comment.content}
                  taskLabel={t('annotations.dialog.task', 'Task')}
                  onToggleTask={(index, done) => void handleToggleTask(comment, index, done)}
                />
              </div>
            </div>
          ))
        )}
      </div>
      )}

      {/* One field, one row of controls under it (GEPARD-319): a task, the colour, send. */}
      <div className="hot-comment-input-area">
        <div style={{ position: 'relative' }}>
          <textarea
            ref={textareaRef}
            value={newComment}
            onChange={handleTextareaChange}
            placeholder={isBulkMode
              ? t('annotations.dialog.bulkPlaceholder', 'Leave a comment on all selected cells (type @ to mention)')
              : t('annotations.dialog.placeholder', 'Leave a comment (type @ to mention)')}
            className="hot-comment-textarea"
            rows={2}
            autoFocus
            onKeyDown={(e) => textareaKeyDown(e, isBulkMode ? handleBulkSubmitComment : handleSubmitComment)}
          />
          {mentionState?.active && textareaRef.current && (
            <MentionPopup
              ref={mentionRef}
              query={mentionState.query}
              anchorEl={textareaRef.current}
              onSelect={handleMentionSelect}
              onClose={() => setMentionState(null)}
              visible
            />
          )}
        </div>
        <div className="hot-comment-input-footer">
          <button
            type="button"
            className="hot-comment-tool-btn"
            onClick={insertTask}
            title={t('annotations.dialog.addTask', 'Add a task (- [ ])')}
            aria-label={t('annotations.dialog.addTask', 'Add a task (- [ ])')}
            data-comment-add-task=""
          >
            <ListChecks size={14} />
          </button>
          <button
            type="button"
            className="hot-comment-tool-btn hot-comment-color-current"
            onClick={() => setPaletteOpen((open) => !open)}
            aria-expanded={paletteOpen}
            title={t('annotations.dialog.colour', 'Cell colour')}
            aria-label={t('annotations.dialog.colour', 'Cell colour')}
            data-comment-colour=""
          >
            <span
              className="hot-comment-color-dot"
              data-color={selectedColor ?? 'none'}
              style={{ background: ANNOTATION_COLORS.find((c) => c.value === selectedColor)?.bg ?? 'transparent' }}
            />
          </button>
          {paletteOpen && (
            <div className="hot-comment-colors" role="group" aria-label={t('annotations.dialog.colour', 'Cell colour')}>
              {ANNOTATION_COLORS.map((item) => (
                <button
                  type="button"
                  key={item.value ?? 'none'}
                  onClick={() => { handleColorChange(item.value); setPaletteOpen(false); }}
                  className={`hot-comment-color-btn ${selectedColor === item.value ? 'selected' : ''}`}
                  data-color={item.value ?? 'none'}
                  style={{
                    background: item.bg,
                    border: item.value === null ? '1px dashed var(--m3-outline-faint)' : undefined,
                  }}
                  title={paletteLabel(t, item)}
                  aria-label={paletteLabel(t, item)}
                />
              ))}
            </div>
          )}
          {isBulkMode && comments.length > 0 && comments.every(deletable) && (
            <button type="button" className="hot-comment-delete-all" onClick={handleDeleteAllComments}>
              {t('annotations.dialog.deleteAll', 'Delete all comments')}
            </button>
          )}
          <span className="hot-comment-footer-spacer" />
          <button
            type="button"
            onClick={isBulkMode ? handleBulkSubmitComment : handleSubmitComment}
            disabled={!newComment.trim() || submitting}
            className="hot-comment-send-btn"
            title={isBulkMode
              ? t('annotations.dialog.sendAllHint', 'Send to all cells (⌘/Ctrl+Enter)')
              : t('annotations.dialog.sendHint', 'Send (⌘/Ctrl+Enter)')}
          >
            <Send size={12} />
            {submitting ? t('annotations.dialog.sending', 'Sending...') : t('annotations.dialog.send', 'Send')}
          </button>
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(panel, document.body);
};

export default CellCommentDialog;
