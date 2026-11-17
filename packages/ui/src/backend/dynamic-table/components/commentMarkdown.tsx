import * as React from 'react';

/**
 * GEPARD-319 (owner 17.11: "prosty markdown, żeby dodać checkboxy") — the little markdown a cell comment reads in:
 *   - [ ] a task / - [x] a done task   (a checkbox; ticking it is the caller's — `onToggleTask`)
 *   - an item                          (a bullet)
 *   **bold**, _italic_, @[Name](id)    (inline)
 * Built as React nodes, never as HTML: a comment's text cannot inject markup. The task syntax is the one gt-fms
 * annotations ticks on the server (`lib/comment-tasks.ts`), so the two count tasks alike.
 */

export const TASK_LINE = /^(\s*)[-*] \[( |x|X)\]\s(.*)$/;
const BULLET_LINE = /^(\s*)[-*]\s(.*)$/;
const INLINE = /@\[([^\]]+)\]\(([^)]+)\)|\*\*([^*\n]+)\*\*|(?<![\w])_([^_\n]+)_(?![\w])/g;

/** The content with its `index`-th task (0-based, in reading order) ticked or unticked. */
export function toggleTaskInContent(content: string, index: number, done: boolean): string {
  let seen = -1;
  return content
    .split('\n')
    .map((line) => {
      const m = TASK_LINE.exec(line);
      if (!m) return line;
      seen += 1;
      if (seen !== index) return line;
      // Only the mark: the bullet, the indent and the words stay as written (as gt-fms annotations ticks it).
      return line.replace(/\[( |x|X)\]/, done ? '[x]' : '[ ]');
    })
    .join('\n');
}

/** How many tasks the content holds, and how many of them are done. */
export function taskCount(content: string): { total: number; done: number } {
  let total = 0;
  let done = 0;
  for (const line of content.split('\n')) {
    const m = TASK_LINE.exec(line);
    if (!m) continue;
    total += 1;
    if (m[2] !== ' ') done += 1;
  }
  return { total, done };
}

function inline(text: string, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = new RegExp(INLINE.source, 'g');
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = `${keyBase}-${m.index}`;
    if (m[1] !== undefined) out.push(<span key={key} className="hot-comment-mention">@{m[1]}</span>);
    else if (m[3] !== undefined) out.push(<strong key={key}>{m[3]}</strong>);
    else if (m[4] !== undefined) out.push(<em key={key}>{m[4]}</em>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export interface CommentMarkdownProps {
  content: string;
  /** Ticks or unticks the `index`-th task; absent = the checkboxes are read-only. */
  onToggleTask?: (index: number, done: boolean) => void;
  /** Labels the checkboxes for assistive tech ("Task", "Zadanie"). */
  taskLabel?: string;
}

export function CommentMarkdown({ content, onToggleTask, taskLabel = 'Task' }: CommentMarkdownProps) {
  let task = -1;
  const lines = content.split('\n');
  return (
    <div className="hot-comment-md">
      {lines.map((line, i) => {
        const key = `l${i}`;
        const taskMatch = TASK_LINE.exec(line);
        if (taskMatch) {
          task += 1;
          const index = task;
          const done = taskMatch[2] !== ' ';
          return (
            <label key={key} className="hot-comment-md-task" data-done={done || undefined} style={{ paddingLeft: `${Math.min(taskMatch[1].length, 8) * 4}px` }}>
              <input
                type="checkbox"
                checked={done}
                disabled={!onToggleTask}
                aria-label={`${taskLabel} ${index + 1}`}
                onChange={(e) => onToggleTask?.(index, e.target.checked)}
                data-comment-task={index}
              />
              <span>{inline(taskMatch[3], key)}</span>
            </label>
          );
        }
        const bullet = BULLET_LINE.exec(line);
        if (bullet) {
          return (
            <div key={key} className="hot-comment-md-bullet" style={{ paddingLeft: `${Math.min(bullet[1].length, 8) * 4}px` }}>
              <span aria-hidden="true">•</span>
              <span>{inline(bullet[2], key)}</span>
            </div>
          );
        }
        if (!line.trim()) return <div key={key} className="hot-comment-md-gap" aria-hidden="true" />;
        return <div key={key}>{inline(line, key)}</div>;
      })}
    </div>
  );
}

export default CommentMarkdown;
