import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { apiCall } from '../../utils/apiCall';

/** Who a comment is written for — see `packages/annotations` (workshop B8c). */
export type CellCommentAudience = 'internal' | 'carrier';

export interface AnnotationComment {
  id: string;
  content: string;
  userName?: string;
  userId?: string;
  createdAt?: string;
  /** `carrier` = printed on the waybill; `internal` = a note between colleagues. */
  audience?: CellCommentAudience;
  /** GEPARD-310 — `where_added`: shown only in the table and on the grid row it was written on. */
  visibility?: CellCommentVisibility;
  originTableId?: string | null;
  originRowId?: string | null;
}

/** Where a comment shows (gt-fms annotations, GEPARD-310): everywhere its information shows, or only where written. */
export type CellCommentVisibility = 'everywhere' | 'where_added';

/** A comment kept to the grid row it was written on — it belongs to that row's entry, not the cell's shared one. */
export function isRowBoundComment(c: Pick<AnnotationComment, 'visibility' | 'originRowId'>): boolean {
  return c.visibility === 'where_added' && !!c.originRowId;
}

/**
 * The map key of one grid row's own view of a cell (GEPARD-310). Present only where the row has comments kept to it;
 * a cell reads it first and falls back to the shared `annotationKey`. `\u0002` never occurs in an id.
 */
export function rowAnnotationKey(key: string, rowKey: string): string {
  return `${key}\u0002${rowKey}`;
}

/** The annotation one grid row shows for a cell: its own entry when it has comments kept to it, else the shared one. */
export function annotationForRow<T>(map: Map<string, T>, key: string | null, rowKey: string | null | undefined): T | undefined {
  if (!key) return undefined;
  if (rowKey) {
    const own = map.get(rowAnnotationKey(key, rowKey));
    if (own) return own;
  }
  return map.get(key);
}

export interface CellAnnotationInfo {
  id: string;
  color: string | null;
  commentCount: number;
  /** The comment thread for this cell — used by the hover preview popup. */
  comments: AnnotationComment[];
  assignees: Array<{ userId: string }>;
}

export type AnnotationMap = Map<string, CellAnnotationInfo>;

/**
 * The most row ids one annotations GET carries (FMS CR13). All of a table's ids in one query string ran past Node's
 * 16 KiB request-header limit on a large desk (a UUID and its comma are 37 bytes); in parts of 300 (about 11 KB) a
 * server's default limit holds.
 */
export const ANNOTATION_IDS_PER_REQUEST = 300;

/** `ids` in parts of at most `size`, in order. */
export function annotationIdBatches(ids: Iterable<string>, size: number = ANNOTATION_IDS_PER_REQUEST): string[][] {
  const all = Array.from(ids);
  const parts: string[][] = [];
  for (let i = 0; i < all.length; i += size) parts.push(all.slice(i, i + size));
  return parts;
}

/**
 * One cell's annotation target (workshop B8a).
 *
 * A grid row is not always one record. On the transport list a row is a
 * unit-LEG: the truck plate belongs to the leg, the container number belongs to
 * the container that travels on both legs. Keying every comment by the row's id
 * column made a container note appear on both legs — "on się teraz powiela w
 * innych miejscach". A cell therefore names its own target.
 */
export interface AnnotationTarget {
  entityType: string;
  rowId: string;
}

/** Map key. `entityType` is part of it precisely so two scopes cannot collide. */
export function annotationKey(target: AnnotationTarget, columnKey: string): string {
  return `${target.entityType}:${target.rowId}:${columnKey}`;
}

interface UseAnnotationsOptions {
  enabled: boolean;
  /**
   * GEPARD-310 — the table asking (the grid's view context). The server sends it no comment kept to another table; a
   * comment kept to THIS table lands in its row's own entry (`rowAnnotationKey`). Without it, kept comments are left out.
   */
  tableId?: string;
  /**
   * Every (entityType, rowId) pair on screen, already de-duplicated by the
   * caller. One request per distinct `entityType`.
   */
  targets?: AnnotationTarget[];
  /**
   * @deprecated Pass `targets` instead. Still read so a consumer compiled
   * against the pre-`targets` signature keeps its annotations — see the note
   * on `resolvedTargets` below.
   */
  entityType?: string;
  /** @deprecated Pass `targets` instead. */
  data?: Array<Record<string, unknown>>;
  /** @deprecated Pass `targets` instead. Defaults to `id`, as it always did. */
  idColumnName?: string;
}

/** Stable identity, so "nothing to annotate" does not re-key the fetch memo. */
const NO_TARGETS: AnnotationTarget[] = [];

export function useAnnotations({
  enabled,
  tableId,
  targets,
  entityType,
  data,
  idColumnName,
}: UseAnnotationsOptions) {
  const [annotations, setAnnotations] = useState<AnnotationMap>(new Map());
  const [loading, setLoading] = useState(false);
  /** How many reads have finished (GEPARD-309: a link to a cell waits for the first before it opens the comments). */
  const [settled, setSettled] = useState(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  /**
   * Walkthrough 2026-08-27 bug 27 — why the legacy option shape is still read.
   *
   * `targets` replaced `{ entityType, data, idColumnName }` (workshop B8a: a
   * grid row is not always one record). The rename shipped on a PUBLISHED
   * surface with no bridge, and `targets.map(...)` below ran unguarded — so a
   * consumer built against the old signature did not lose its comments, it
   * threw a TypeError on the FIRST render, before any request was made.
   *
   * That is not hypothetical. `@freighttech/invoicing` declares
   * `"@freighttech/ui": "0.13.0"` as a peer, so the INF deployment resolved ui
   * 0.13.15 alongside invoicing 0.13.2 — old caller, new hook. Every
   * `/backend/invoicing/<id>/allocate` answered 500, for every id, including
   * ids that match no invoice: the crash is in the render, not the data. Cost
   * allocation was unreachable and the release walkthrough stopped there.
   *
   * A missing or renamed option must cost the annotations, never the page. An
   * absent `targets` therefore resolves to "nothing to annotate", and the
   * legacy trio is mapped forward rather than dropped so an un-republished
   * consumer keeps working until it is rebuilt.
   */
  const resolvedTargets = useMemo(() => {
    if (targets) return targets;
    if (!entityType || !data) return NO_TARGETS;
    const idKey = idColumnName || 'id';
    return data
      .map((row) => ({ entityType, rowId: String(row?.[idKey] ?? '') }))
      .filter((target) => target.rowId);
  }, [targets, entityType, data, idColumnName]);

  // Refetch on CONTENT, not identity: `targets` is rebuilt whenever the data
  // page or the column set changes, and a column reorder must not re-request
  // every annotation on the page.
  const targetsKey = useMemo(
    () => resolvedTargets.map((t) => `${t.entityType}\u0000${t.rowId}`).sort().join('\u0001'),
    [resolvedTargets],
  );
  const targetsRef = useRef(resolvedTargets);
  targetsRef.current = resolvedTargets;

  const fetchAnnotations = useCallback(async () => {
    const current = targetsRef.current;
    if (!enabled || current.length === 0) {
      setAnnotations(new Map());
      return;
    }

    // Abort previous request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    setLoading(true);
    try {
      const groups = new Map<string, Set<string>>();
      for (const target of current) {
        if (!target.entityType || !target.rowId) continue;
        const existing = groups.get(target.entityType);
        if (existing) existing.add(target.rowId);
        else groups.set(target.entityType, new Set([target.rowId]));
      }

      if (groups.size === 0) {
        setAnnotations(new Map());
        return;
      }

      const fetches = Array.from(groups.entries()).flatMap(([entityType, rowIds]) =>
        annotationIdBatches(rowIds).map(async (part) => {
          const params = new URLSearchParams({
            entityType,
            rowIds: part.join(','),
          });
          if (tableId) params.set('tableId', tableId);
          const { ok, result } = await apiCall<any>(`/api/annotations/annotations?${params}`, { signal });
          if (!ok || !result) return [] as any[];
          const items: any[] = result.items || result.data || result || [];
          // The endpoint echoes `entityType`, but fall back to the group's key so
          // an older response shape still lands in the right bucket.
          return items.map((item) => ({ ...item, entityType: item.entityType ?? entityType }));
        }),
      );

      const results = await Promise.all(fetches);
      const allItems = results.flat();

      const map: AnnotationMap = new Map();
      for (const annotation of allItems) {
        const key = annotationKey(
          {
            entityType: annotation.entityType ?? annotation.entity_type ?? '',
            rowId: String(annotation.rowId ?? annotation.row_id ?? ''),
          },
          annotation.columnKey || annotation.column_key,
        );
        const comments: AnnotationComment[] = (annotation.comments || []).map((c: any) => ({
          id: c.id,
          content: c.content ?? '',
          userName: c.userName ?? c.user_name ?? undefined,
          userId: c.userId ?? c.user_id ?? undefined,
          createdAt: c.createdAt ?? c.created_at ?? undefined,
          audience: (c.audience as CellCommentAudience) ?? 'internal',
          visibility: c.visibility === 'where_added' ? 'where_added' : 'everywhere',
          originTableId: c.originTableId ?? null,
          originRowId: c.originRowId ?? null,
        }));
        const assignees = (annotation.assignees || []).map((a: any) => ({ userId: a.userId || a.user_id }));
        const entry = (list: AnnotationComment[]): CellAnnotationInfo => ({
          id: annotation.id,
          color: annotation.color || null,
          commentCount: list.length,
          comments: list,
          assignees,
        });
        // GEPARD-310 — the cell's shared entry holds the comments that show everywhere; a row with comments kept to it
        // gets its own entry with those added. A kept comment of another table (a server that did not filter) shows nowhere.
        const shared = comments.filter((c) => !isRowBoundComment(c));
        const rowBound = comments.filter((c) => isRowBoundComment(c) && !!tableId && c.originTableId === tableId);
        // An older response may carry a count without the thread; it is the shared entry's count then.
        map.set(key, { ...entry(shared), commentCount: comments.length ? shared.length : annotation.commentCount || 0 });
        for (const rowKey of new Set(rowBound.map((c) => String(c.originRowId)))) {
          map.set(rowAnnotationKey(key, rowKey), entry(comments.filter((c) => !isRowBoundComment(c) || (rowBound.includes(c) && String(c.originRowId) === rowKey))));
        }
      }
      setAnnotations(map);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      console.error('Failed to fetch annotations:', error);
      setAnnotations(new Map());
    } finally {
      setLoading(false);
      if (!signal.aborted) setSettled((n) => n + 1);
    }
    // `targetsKey` is the real dependency — see the note on the memo above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, targetsKey, tableId]);

  // Fetch when the target set changes
  useEffect(() => {
    fetchAnnotations();
    return () => {
      abortControllerRef.current?.abort();
    };
  }, [fetchAnnotations]);

  return {
    annotations,
    loading,
    settled,
    refresh: fetchAnnotations,
  };
}
