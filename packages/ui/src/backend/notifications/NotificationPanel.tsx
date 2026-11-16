"use client"
import * as React from 'react'
import { X, Bell, CheckCheck, Loader2, RotateCcw } from 'lucide-react'
import { Tabs, TabsList, TabsTrigger } from '../../primitives/tabs'
import { NotificationItem } from './NotificationItem'
import type { NotificationDto, NotificationRendererProps } from '@open-mercato/shared/modules/notifications/types'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import type { ComponentType } from 'react'

/**
 * Map of notification type to custom renderer component.
 * Used to provide custom rendering for specific notification types.
 *
 * @example
 * ```tsx
 * const customRenderers = {
 *   'sales.order.created': SalesOrderCreatedRenderer,
 *   'sales.quote.created': SalesQuoteCreatedRenderer,
 * }
 * ```
 */
export type NotificationRenderers = Record<string, ComponentType<NotificationRendererProps>>

export type NotificationPanelProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  notifications: NotificationDto[]
  unreadCount: number
  onMarkAsRead: (id: string) => Promise<void>
  onExecuteAction: (id: string, actionId: string) => Promise<{ href?: string }>
  onDismiss: (id: string) => Promise<void>
  dismissUndo?: { notification: NotificationDto; previousStatus: 'read' | 'unread' } | null
  onUndoDismiss?: () => Promise<void>
  onMarkAllRead: () => Promise<void>
  t: TranslateFn
  /**
   * Optional map of notification type to custom renderer component.
   * When a notification's type matches a key in this map, the corresponding
   * renderer will be used instead of the default NotificationItem rendering.
   *
   * @example
   * ```tsx
   * import { salesNotificationTypes } from '@open-mercato/core/modules/sales/notifications.client'
   *
   * // Build renderers map from notification types
   * const renderers = Object.fromEntries(
   *   salesNotificationTypes
   *     .filter(t => t.Renderer)
   *     .map(t => [t.type, t.Renderer!])
   * )
   *
   * <NotificationPanel customRenderers={renderers} ... />
   * ```
   */
  customRenderers?: NotificationRenderers
}

export function NotificationPanel({
  open,
  onOpenChange,
  notifications,
  unreadCount,
  onMarkAsRead,
  onExecuteAction,
  onDismiss,
  dismissUndo,
  onUndoDismiss,
  onMarkAllRead,
  t,
  customRenderers,
}: NotificationPanelProps) {
  const [filter, setFilter] = React.useState<'all' | 'unread' | 'action'>('all')
  const [markingAllRead, setMarkingAllRead] = React.useState(false)

  const filteredNotifications = React.useMemo(() => {
    switch (filter) {
      case 'unread':
        return notifications.filter((n) => n.status === 'unread')
      case 'action':
        return notifications.filter(
          (n) => n.actions && n.actions.length > 0 && n.status !== 'actioned'
        )
      default:
        return notifications
    }
  }, [notifications, filter])

  const handleMarkAllRead = async () => {
    setMarkingAllRead(true)
    try {
      await onMarkAllRead()
    } finally {
      setMarkingAllRead(false)
    }
  }

  React.useEffect(() => {
    if (!open) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
    }
  }, [open])

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && open) {
        onOpenChange(false)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, onOpenChange])

  if (!open) return null

  // The app's look (FMS visual language: one frame, no card shadow, the M3 tokens and the named type scale) — the
  // panel's chrome only; each item is the renderer's (a host may draw its own per type).
  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/20"
        onClick={() => onOpenChange(false)}
        aria-hidden="true"
      />

      <div
        className="theme-m3-freighttech fixed right-0 top-0 z-50 h-full w-full max-w-md border-l border-m3ft-outline-variant bg-m3ft-surface text-m3ft-on-surface"
        role="dialog"
        aria-modal="true"
        aria-label={t('notifications.title', 'Notifications')}
        data-testid="notification-panel"
      >
        <div className="flex h-full flex-col">
          <div className="flex min-h-14 items-center justify-between gap-2 px-4">
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="truncate text-heading-semibold-md">{t('notifications.title', 'Notifications')}</h2>
              {unreadCount > 0 && (
                <span className="rounded-full bg-m3ft-primary px-2 py-0.5 text-label-semibold-2xs tabular-nums text-m3ft-on-primary" data-testid="notification-panel-unread">
                  {unreadCount}
                </span>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={handleMarkAllRead}
                  disabled={markingAllRead}
                  className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-body-medium-xs text-m3ft-on-surface hover:bg-m3ft-surface-container-low disabled:opacity-50"
                  data-testid="notification-panel-mark-all"
                >
                  {markingAllRead ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <CheckCheck className="size-4" aria-hidden />}
                  {t('notifications.markAllRead', 'Mark all read')}
                </button>
              )}
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                aria-label={t('notifications.actions.close', 'Close')}
                className="inline-flex size-9 items-center justify-center rounded-full text-m3ft-on-surface-variant hover:bg-m3ft-surface-container-low hover:text-m3ft-on-surface"
              >
                <X className="size-5" aria-hidden />
              </button>
            </div>
          </div>

          <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
            <TabsList className="h-10 w-full justify-start gap-5 rounded-none border-b border-m3ft-outline-variant bg-transparent p-0 px-4 text-m3ft-on-surface-variant">
              {(
                [
                  ['all', t('notifications.filters.all', 'All')],
                  ['unread', t('notifications.filters.unread', 'Unread')],
                  ['action', t('notifications.filters.actionRequired', 'Action Required')],
                ] as const
              ).map(([value, label]) => (
                <TabsTrigger
                  key={value}
                  value={value}
                  className="h-10 rounded-none border-b-2 border-transparent bg-transparent px-0 text-body-medium-sm text-m3ft-on-surface-variant shadow-none hover:bg-transparent hover:text-m3ft-on-surface aria-selected:border-m3ft-on-surface aria-selected:bg-transparent aria-selected:text-m3ft-on-surface aria-selected:shadow-none"
                >
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          {dismissUndo && onUndoDismiss && (
            <div className="flex items-center justify-between gap-3 border-b border-m3ft-outline-variant bg-m3ft-surface-container-low px-4 py-2 text-body-regular-sm">
              <span>{t('notifications.toast.dismissed', 'Notification dismissed')}</span>
              <button type="button" onClick={() => onUndoDismiss()} className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-body-medium-xs text-m3ft-on-surface hover:bg-m3ft-surface-container">
                <RotateCcw className="size-3.5" aria-hidden />
                {t('notifications.actions.undo', 'Undo')}
              </button>
            </div>
          )}

          <div className="flex-1 overflow-y-auto overscroll-contain">
            {filteredNotifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-m3ft-on-surface-variant" data-testid="notification-panel-empty">
                <span className="inline-flex size-12 items-center justify-center rounded-full bg-m3ft-surface-container-high">
                  <Bell className="size-5" aria-hidden />
                </span>
                <p className="text-body-regular-sm">{t('notifications.empty', 'No notifications')}</p>
              </div>
            ) : (
              <div className="divide-y divide-m3ft-outline-variant">
                {filteredNotifications.map((notification) => (
                  <NotificationItem
                    key={notification.id}
                    notification={notification}
                    onMarkAsRead={() => onMarkAsRead(notification.id)}
                    onExecuteAction={(actionId) => onExecuteAction(notification.id, actionId)}
                    onDismiss={() => onDismiss(notification.id)}
                    t={t}
                    customRenderer={customRenderers?.[notification.type]}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
