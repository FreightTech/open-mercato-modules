'use client';

import React, { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import ReactDOM from 'react-dom';
import { apiFetch } from '../../utils/api';

interface MentionUser {
  id: string;
  name: string;
  email: string;
}

interface MentionPopupProps {
  query: string;
  anchorEl: HTMLElement;
  onSelect: (user: MentionUser) => void;
  onClose: () => void;
  visible: boolean;
}

export interface MentionPopupHandle {
  getElement: () => HTMLDivElement | null;
}

/**
 * Avatar fills, picked deterministically from a name hash.
 *
 * A third palette again — identity colours, like the saved-view swatches and
 * unlike the annotation washes: full saturation, theme-independent, and chosen
 * to be told apart from one another rather than to sit behind text. Declared in
 * m3.css with the others so there is one place a colour lives; referenced by
 * `var()` so nothing here can drift from it.
 */
const AVATAR_COLORS = [
  'var(--m3-avatar-1)', 'var(--m3-avatar-2)', 'var(--m3-avatar-3)',
  'var(--m3-avatar-4)', 'var(--m3-avatar-5)', 'var(--m3-avatar-6)',
  'var(--m3-avatar-7)', 'var(--m3-avatar-8)', 'var(--m3-avatar-9)',
  'var(--m3-avatar-10)',
];

/**
 * Diacritic-folded lower-case form, for the local fallback match.
 *
 * `NFD` splits "ś" into "s" + U+0301, which the combining-mark range then
 * drops. "ł" survives that (it is a single codepoint with a stroke, not a
 * base+mark pair), so it is folded explicitly — which matters here because the
 * FMS user list is Polish.
 */
function foldForMatch(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L')
    .toLowerCase();
}

function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

const MentionPopup = forwardRef<MentionPopupHandle, MentionPopupProps>(({ query, anchorEl, onSelect, onClose, visible }, ref) => {
  const [users, setUsers] = useState<MentionUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const popupRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useImperativeHandle(ref, () => ({
    getElement: () => popupRef.current,
  }));

  const fetchUsers = useCallback(async (searchQuery: string) => {
    setLoading(true);
    const query = searchQuery.trim();
    try {
      const toUsers = (data: any): MentionUser[] =>
        (data?.items || []).map((item: any) => ({
          id: item.id,
          name: item.name || '',
          email: item.email || '',
        }));

      // `name=`, NOT `search=` (ledger 8.7). Both params exist on
      // /api/auth/users and they do completely different things:
      //   search= → search_tokens (encrypted email), organization name, role name
      //   name=   → ILIKE on the user's display name + its name search-tokens
      // Typing "Daria" for the user "Daria Nowak" therefore returned "No users
      // found" — the human's own name was the one field `search=` never looked
      // at. Verified against the live API: search=Daria → 0, name=Daria → 1.
      // The route is upstream (@open-mercato/core, read-only here), and the two
      // params are ANDed when both are sent, so this is a choice, not a merge.
      const params = new URLSearchParams({ pageSize: '10' });
      if (query) params.set('name', query);
      const response = await apiFetch(`/api/auth/users?${params}`);
      if (!response.ok) {
        setUsers([]);
        return;
      }
      let results = toUsers(await response.json());

      // FALLBACK — one extra request, only when the server found nothing.
      // `ILIKE` is case-insensitive but NOT diacritic-insensitive, so "Lukasz"
      // misses "Łukasz" and "wisniewski" misses "Wiśniewski"; the same query
      // also cannot match an email. Rather than leave a dead end, pull one page
      // of users and match locally on a diacritic-folded name OR email. Bounded
      // (≤50 rows, and only on a miss), so the common path is still one query.
      if (query && results.length === 0) {
        const all = await apiFetch('/api/auth/users?pageSize=50');
        if (all.ok) {
          const needle = foldForMatch(query);
          results = toUsers(await all.json()).filter(
            (u) => foldForMatch(u.name).includes(needle) || foldForMatch(u.email).includes(needle),
          ).slice(0, 10);
        }
      }

      setUsers(results);
      setHighlightedIndex(0);
    } catch {
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchUsers(query), 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, visible, fetchUsers]);

  useEffect(() => {
    if (!visible) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightedIndex((prev) => Math.min(prev + 1, users.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' && users.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        onSelect(users[highlightedIndex]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [visible, users, highlightedIndex, onSelect, onClose]);

  if (!visible) return null;

  const rect = anchorEl.getBoundingClientRect();

  const popup = (
    <div
      ref={popupRef}
      className="hot-mention-popup"
      style={{
        position: 'fixed',
        bottom: window.innerHeight - rect.top + 4,
        left: rect.left,
        pointerEvents: 'auto',
      }}
    >
      {loading && users.length === 0 ? (
        <div className="hot-mention-popup-item" style={{ justifyContent: 'center', color: 'var(--m3-on-surface-variant)' }}>
          Searching...
        </div>
      ) : users.length === 0 ? (
        <div className="hot-mention-popup-item" style={{ justifyContent: 'center', color: 'var(--m3-on-surface-variant)' }}>
          No users found
        </div>
      ) : (
        users.map((user, index) => (
          <div
            key={user.id}
            className={`hot-mention-popup-item ${index === highlightedIndex ? 'highlighted' : ''}`}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onSelect(user);
            }}
            onMouseEnter={() => setHighlightedIndex(index)}
          >
            <div
              className="hot-mention-popup-avatar"
              style={{ background: getAvatarColor(user.name || user.email) }}
            >
              {(user.name || user.email || '?')[0].toUpperCase()}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <span style={{ fontWeight: 500, fontSize: 'var(--text-body-regular-sm)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user.name || user.email}
              </span>
              {user.name && user.email && (
                <span style={{ fontSize: 'var(--text-body-regular-2xs)', color: 'var(--m3-on-surface-variant)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {user.email}
                </span>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );

  return ReactDOM.createPortal(popup, document.body);
});

MentionPopup.displayName = 'MentionPopup';

export default MentionPopup;
