import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Lock, Truck } from 'lucide-react';
import ReactDOM from 'react-dom';
import { useT } from '@open-mercato/shared/lib/i18n/context';
import { apiCall } from '../../utils/apiCall';
import MentionPopup from './MentionPopup';
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
}

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
}

function renderCommentContent(content: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  const regex = new RegExp(MENTION_PATTERN.source, 'g');
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push(content.slice(lastIndex, match.index));
    }
    parts.push(
      <span key={match.index} className="hot-comment-mention">@{match[1]}</span>
    );
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < content.length) {
    parts.push(content.slice(lastIndex));
  }

  return parts.length > 0 ? parts : content;
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
}) => {
  const t = useT();
  const isBulkMode = bulkCells && bulkCells.length > 1;
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [selectedColor, setSelectedColor] = useState<string | null>(initialColor || null);
  const [annotationId, setAnnotationId] = useState<string | null>(initialAnnotationId || null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // B8c — who this note is for. Resets to `internal` on every open: the safe
  // default is "stays inside", never "goes to the carrier".
  const [audience, setAudience] = useState<CommentAudience>('internal');
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
      setAudience('internal');
    }
  }, [isOpen]);

  // Fetch comments when dialog opens (single-cell mode)
  useEffect(() => {
    if (!isOpen || isBulkMode || !annotationId) {
      if (!isBulkMode) setComments([]);
      return;
    }

    const fetchComments = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ entityType, rowIds: rowId });
        const { ok, result } = await apiCall<any>(`/api/annotations/annotations?${params}`);
        if (ok && result) {
          const items: any[] = result.items || result.data || result || [];
          const annotation = items.find((a: any) =>
            (a.columnKey || a.column_key) === columnKey
          );
          if (annotation?.comments) {
            setComments(annotation.comments.map((c: any) => ({
              id: c.id,
              userId: c.userId || c.user_id,
              userName: c.userName || c.user_name || 'User',
              content: c.content,
              audience: (c.audience as CommentAudience) ?? 'internal',
              createdAt: c.createdAt || c.created_at,
            })));
          }
        }
      } catch (error) {
        console.error('Failed to fetch comments:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchComments();
  }, [isOpen, isBulkMode, annotationId, entityType, rowId, columnKey]);

  // Fetch comments for all selected cells (bulk mode)
  const fetchBulkComments = useCallback(async () => {
    if (!bulkCells || bulkCells.length === 0) return;

    setLoading(true);
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
      const responses = await Promise.all(
        Array.from(groups.entries()).map(async ([type, rowIds]) => {
          const params = new URLSearchParams({ entityType: type, rowIds: Array.from(rowIds).join(',') });
          const { ok, result } = await apiCall<any>(`/api/annotations/annotations?${params}`);
          if (!ok || !result) return [] as any[];
          const items: any[] = result.items || result.data || result || [];
          return items.map((item) => ({ ...item, entityType: item.entityType ?? type }));
        }),
      );
      {
        const items = responses.flat();
        const allComments: Comment[] = [];
        for (const annotation of items) {
          const aType = annotation.entityType || annotation.entity_type || '';
          const aRowId = annotation.rowId || annotation.row_id;
          const aColKey = annotation.columnKey || annotation.column_key;
          if (!cellKeySet.has(`${aType}:${aRowId}:${aColKey}`)) continue;
          const cellLabel = aColKey;
          for (const c of (annotation.comments || [])) {
            allComments.push({
              id: c.id,
              userId: c.userId || c.user_id,
              userName: c.userName || c.user_name || 'User',
              content: c.content,
              audience: (c.audience as CommentAudience) ?? 'internal',
              createdAt: c.createdAt || c.created_at,
              cellLabel,
              annotationId: annotation.id || annotation.annotationId,
            });
          }
        }
        allComments.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        setComments(allComments);
      }
    } catch (error) {
      console.error('Failed to fetch bulk comments:', error);
    } finally {
      setLoading(false);
    }
  }, [bulkCells]);

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
            audience,
            ...(mentionedUserIds.length > 0 ? { mentionedUserIds } : {}),
          }),
        },
      );

      if (commentOk && commentResult) {
        const newCommentObj: Comment = {
          id: commentResult.id || commentResult.data?.id,
          userId: commentResult.userId || commentResult.user_id || '',
          userName: commentResult.userName || commentResult.user_name || 'You',
          content: wireContent,
          audience,
          createdAt: new Date().toISOString(),
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
  }, [newComment, submitting, annotationId, entityType, viewContext, rowId, columnKey, selectedColor, onAnnotationChange, pendingMentions, buildWireContent, audience]);

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
              cells: cells.map((c) => ({ rowId: c.rowId, columnKey: c.columnKey })),
              comment: wireContent,
              audience,
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
  }, [bulkCells, viewContext, newComment, submitting, onAnnotationChange, fetchBulkComments, pendingMentions, buildWireContent, audience]);

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
      const { ok } = await apiCall(`/api/annotations/annotations/${annId}/comments?commentId=${commentId}`, {
        method: 'DELETE',
      });
      if (ok) {
        setComments(prev => prev.filter(c => c.id !== commentId));
        onAnnotationChange?.();
      }
    } catch (error) {
      console.error('Failed to delete comment:', error);
    }
  }, [annotationId, onAnnotationChange]);

  // Bulk: delete every comment shown across the selected cells.
  const handleDeleteAllComments = useCallback(async () => {
    const toDelete = comments.slice();
    for (const c of toDelete) {
      const annId = c.annotationId || annotationId;
      if (!annId) continue;
      try {
        await apiCall(`/api/annotations/annotations/${annId}/comments?commentId=${c.id}`, { method: 'DELETE' });
      } catch (error) {
        console.error('Failed to delete comment:', error);
      }
    }
    setComments([]);
    onAnnotationChange?.();
  }, [comments, annotationId, onAnnotationChange]);

  const formatTimeAgo = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour}h ago`;
    const diffDay = Math.floor(diffHour / 24);
    return `${diffDay}d ago`;
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
  const panelWidth = 420;
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
        <div className="hot-comment-popover-title-group">
          <span className="hot-comment-popover-subtitle">{isBulkMode ? t('annotations.dialog.setColorFor', 'Set color for') : t('annotations.dialog.commentsOn', 'Comments on')}</span>
          <span className="hot-comment-popover-title">{title}</span>
        </div>
        <button className="hot-comment-popover-close" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>

      {/* Comments Thread */}
      {(loading || comments.length > 0) && (
      <div className="hot-comment-thread">
        {loading ? (
          <div className="hot-comment-loading">{t('annotations.dialog.loading', 'Loading comments...')}</div>
        ) : (
          comments.map(comment => (
            <div key={comment.id} className="hot-comment-item">
              <div className="hot-comment-item-row">
                <span className="hot-comment-avatar">
                  {(comment.userName || 'U')[0].toUpperCase()}
                </span>
                <div className="hot-comment-item-body">
                  <div className="hot-comment-item-header">
                    <span className="hot-comment-author">{comment.userName || t('annotations.dialog.you', 'You')}</span>
                    <span className="hot-comment-action">{t('annotations.dialog.commented', 'commented')}{comment.cellLabel ? ` ${t('annotations.dialog.on', 'on')} ${comment.cellLabel}` : ''}</span>
                    {comment.audience === 'carrier' && (
                      <span className="hot-comment-audience-tag" title={t('annotations.dialog.audienceCarrierHint', 'Printed on the carrier document')}>
                        <Truck size={10} />
                        {t('annotations.dialog.audienceCarrierShort', 'carrier')}
                      </span>
                    )}
                    <span className="hot-comment-time">{formatTimeAgo(comment.createdAt)}</span>
                  </div>
                  <div className="hot-comment-content">{renderCommentContent(comment.content)}</div>
                </div>
                {(
                <button
                  className="hot-comment-delete"
                  onClick={() => handleDeleteComment(comment.id, comment.annotationId)}
                  title="Delete comment"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2.5 4h11M5.5 4V2.5a1 1 0 011-1h3a1 1 0 011 1V4M6.5 7v4M9.5 7v4M3.5 4l.5 9a1.5 1.5 0 001.5 1.5h5a1.5 1.5 0 001.5-1.5l.5-9" />
                  </svg>
                </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
      )}

      {isBulkMode && comments.length > 0 && (
        <div className="hot-comment-bulk-actions">
          <button className="hot-comment-delete-all" onClick={handleDeleteAllComments}>
            {t('annotations.dialog.deleteAll', 'Delete all comments')}
          </button>
        </div>
      )}

      {/* Bulk mode: color picker + comment input */}
      {isBulkMode ? (
        <div className="hot-comment-input-area">
          <div style={{ position: 'relative' }}>
            <textarea
              ref={textareaRef}
              value={newComment}
              onChange={handleTextareaChange}
              placeholder={t('annotations.dialog.bulkPlaceholder', 'Leave a comment on all selected cells (type @ to mention)')}
              className="hot-comment-textarea"
              rows={3}
              autoFocus
              onKeyDown={(e) => textareaKeyDown(e, handleBulkSubmitComment)}
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
          {/* B8c — who this note is for. Two mutually exclusive choices, never a
              native <select>: the distinction has to be visible while writing,
              not hidden behind a closed control. `internal` is the default and
              is what every note written before this flag existed was. */}
          <div className="hot-comment-audience" role="radiogroup" aria-label={t('annotations.dialog.audienceLabel', 'Who is this note for?')}>
            <button
              type="button"
              role="radio"
              aria-checked={audience === 'internal'}
              className="hot-comment-audience-option"
              data-selected={audience === 'internal' || undefined}
              onClick={() => setAudience('internal')}
            >
              <Lock size={12} />
              <span>{t('annotations.dialog.audienceInternal', 'Internal note')}</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={audience === 'carrier'}
              className="hot-comment-audience-option"
              data-selected={audience === 'carrier' || undefined}
              onClick={() => setAudience('carrier')}
            >
              <Truck size={12} />
              <span>{t('annotations.dialog.audienceCarrier', 'For the carrier')}</span>
            </button>
          </div>
          <div className="hot-comment-colors">
            {ANNOTATION_COLORS.map((item) => (
              <button
                key={item.value ?? 'none'}
                onClick={() => handleColorChange(item.value)}
                className={`hot-comment-color-btn ${selectedColor === item.value ? 'selected' : ''}`}
                data-color={item.value ?? 'none'}
                style={{
                  background: item.bg,
                  border: item.value === null ? '1px dashed var(--m3-outline-faint)' : undefined,
                }}
                title={item.label}
              >
                {item.value === null && selectedColor === null ? (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <path d="M2 2l8 8M10 2l-8 8" />
                  </svg>
                ) : null}
              </button>
            ))}
          </div>
          <div className="hot-comment-input-footer">
            <span className="hot-comment-hint">{t('annotations.dialog.press', 'Press')} <kbd>⌘+Enter</kbd> {t('annotations.dialog.toSendAll', 'to send to all cells')}</span>
            <button
              onClick={handleBulkSubmitComment}
              disabled={!newComment.trim() || submitting}
              className="hot-comment-send-btn"
            >
              {submitting ? t('annotations.dialog.sending', 'Sending...') : t('annotations.dialog.send', 'Send')}
            </button>
          </div>
        </div>
      ) : (
        /* Full comment input in single-cell mode */
        <div className="hot-comment-input-area">
          <div style={{ position: 'relative' }}>
            <textarea
              ref={textareaRef}
              value={newComment}
              onChange={handleTextareaChange}
              placeholder={t('annotations.dialog.placeholder', 'Leave a comment (type @ to mention)')}
              className="hot-comment-textarea"
              rows={3}
              autoFocus
              onKeyDown={(e) => textareaKeyDown(e, handleSubmitComment)}
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
          {/* Color Picker */}
          {/* B8c — who this note is for. Two mutually exclusive choices, never a
              native <select>: the distinction has to be visible while writing,
              not hidden behind a closed control. `internal` is the default and
              is what every note written before this flag existed was. */}
          <div className="hot-comment-audience" role="radiogroup" aria-label={t('annotations.dialog.audienceLabel', 'Who is this note for?')}>
            <button
              type="button"
              role="radio"
              aria-checked={audience === 'internal'}
              className="hot-comment-audience-option"
              data-selected={audience === 'internal' || undefined}
              onClick={() => setAudience('internal')}
            >
              <Lock size={12} />
              <span>{t('annotations.dialog.audienceInternal', 'Internal note')}</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={audience === 'carrier'}
              className="hot-comment-audience-option"
              data-selected={audience === 'carrier' || undefined}
              onClick={() => setAudience('carrier')}
            >
              <Truck size={12} />
              <span>{t('annotations.dialog.audienceCarrier', 'For the carrier')}</span>
            </button>
          </div>
          <div className="hot-comment-colors">
            {ANNOTATION_COLORS.map((item) => (
              <button
                key={item.value ?? 'none'}
                onClick={() => handleColorChange(item.value)}
                className={`hot-comment-color-btn ${selectedColor === item.value ? 'selected' : ''}`}
                data-color={item.value ?? 'none'}
                style={{
                  background: item.bg,
                  border: item.value === null ? '1px dashed var(--m3-outline-faint)' : undefined,
                }}
                title={item.label}
              >
                {item.value === null && selectedColor === null ? (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <path d="M2 2l8 8M10 2l-8 8" />
                  </svg>
                ) : null}
              </button>
            ))}
          </div>
          <div className="hot-comment-input-footer">
            <span className="hot-comment-hint">{t('annotations.dialog.press', 'Press')} <kbd>⌘+Enter</kbd> {t('annotations.dialog.toSend', 'to send')}</span>
            <button
              onClick={handleSubmitComment}
              disabled={!newComment.trim() || submitting}
              className="hot-comment-send-btn"
            >
              {submitting ? t('annotations.dialog.sending', 'Sending...') : t('annotations.dialog.send', 'Send')}
            </button>
          </div>
        </div>
      )}
    </div>
  );

  return ReactDOM.createPortal(panel, document.body);
};

export default CellCommentDialog;
