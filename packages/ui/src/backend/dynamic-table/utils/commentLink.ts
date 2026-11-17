/**
 * GEPARD-309 — a link that names a cell. A mention's notification (gt-fms annotations `withCommentCell`) opens the page
 * with the table, the cell's record and column, the grid row the comment was written on and the comment's id; the
 * DynamicTable whose `commentsViewContext` is that table scrolls there, marks the cell and opens its comments.
 */

export const COMMENT_LINK_PARAMS = ['commentTable', 'commentEntity', 'commentRow', 'commentColumn', 'commentAt', 'comment'] as const

export interface CommentLink {
  table: string;
  entityType: string;
  rowId: string;
  columnKey: string;
  /** The grid row's own key (rowKeyColumn) the comment was written on, when known. */
  at: string | null;
  commentId: string | null;
  /** The link as a whole — one link opens the cell once. */
  signature: string;
}

export function readCommentLink(search: string): CommentLink | null {
  const params = new URLSearchParams(search);
  const table = params.get('commentTable');
  const entityType = params.get('commentEntity');
  const rowId = params.get('commentRow');
  const columnKey = params.get('commentColumn');
  if (!table || !entityType || !rowId || !columnKey) return null;
  const at = params.get('commentAt');
  const commentId = params.get('comment');
  return { table, entityType, rowId, columnKey, at, commentId, signature: [table, entityType, rowId, columnKey, at ?? '', commentId ?? ''].join('\u0001') };
}

/** The same address without the link's parameters, so a reload does not open the cell again. */
export function withoutCommentLink(href: string): string {
  const url = new URL(href);
  for (const key of COMMENT_LINK_PARAMS) url.searchParams.delete(key);
  return url.toString();
}
