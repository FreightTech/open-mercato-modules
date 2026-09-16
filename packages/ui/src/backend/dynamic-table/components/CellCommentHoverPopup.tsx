import React from 'react';
import ReactDOM from 'react-dom';
import { useT } from '@open-mercato/shared/lib/i18n/context';
import type { AnnotationComment } from '../hooks/useAnnotations';

const MENTION_PATTERN = /@\[([^\]]+)\]\(([^)]+)\)/g;

/** Render a comment body, turning `@[Name](id)` mentions into highlighted chips. */
function renderCommentContent(content: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  const regex = new RegExp(MENTION_PATTERN.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) parts.push(content.slice(lastIndex, match.index));
    parts.push(<span key={match.index} className="hot-comment-mention">@{match[1]}</span>);
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < content.length) parts.push(content.slice(lastIndex));
  return parts.length > 0 ? parts : content;
}

function formatTimeAgo(iso?: string): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const diff = Date.now() - then;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export interface CellCommentHoverPopupProps {
  comments: AnnotationComment[];
  columnTitle?: string;
  /** Rect of the hovered comment indicator — the popup anchors above/below it. */
  anchorRect: DOMRect;
}

/**
 * Read-only hover preview of a cell's comment thread. Rendered via a portal and
 * pointer-events:none so it never steals the hover from the indicator beneath it
 * (the table closes it on mouseout). Clicking the indicator opens the full
 * `CellCommentDialog` for editing — this popup is preview only.
 */
const CellCommentHoverPopup: React.FC<CellCommentHoverPopupProps> = ({ comments, columnTitle, anchorRect }) => {
  const t = useT();
  if (!comments.length) return null;

  const POPUP_WIDTH = 280;
  const MARGIN = 8;
  // Prefer below the indicator; flip above when it would overflow the viewport.
  const spaceBelow = window.innerHeight - anchorRect.bottom;
  const placeBelow = spaceBelow > 220 || spaceBelow > anchorRect.top;
  const top = placeBelow ? anchorRect.bottom + 6 : undefined;
  const bottom = placeBelow ? undefined : window.innerHeight - anchorRect.top + 6;
  let left = anchorRect.right - POPUP_WIDTH;
  if (left < MARGIN) left = MARGIN;
  if (left + POPUP_WIDTH > window.innerWidth - MARGIN) left = window.innerWidth - POPUP_WIDTH - MARGIN;

  return ReactDOM.createPortal(
    <div
      className="hot-comment-hover-popup hot-appearance-v2"
      style={{ position: 'fixed', top, bottom, left, width: POPUP_WIDTH }}
      role="tooltip"
    >
      <div className="hot-comment-hover-header">
        {columnTitle || t('dynamicTable.comments.title', 'Comments')}
        <span className="hot-comment-hover-count">{comments.length}</span>
      </div>
      <div className="hot-comment-hover-list">
        {comments.map((c) => (
          <div key={c.id} className="hot-comment-hover-item">
            <div className="hot-comment-hover-meta">
              <span className="hot-comment-hover-author">{c.userName || t('dynamicTable.comments.someone', 'Someone')}</span>
              {c.createdAt && <span className="hot-comment-hover-time">{formatTimeAgo(c.createdAt)}</span>}
            </div>
            <div className="hot-comment-hover-body">{renderCommentContent(c.content)}</div>
          </div>
        ))}
      </div>
    </div>,
    document.body
  );
};

CellCommentHoverPopup.displayName = 'CellCommentHoverPopup';

export default CellCommentHoverPopup;
