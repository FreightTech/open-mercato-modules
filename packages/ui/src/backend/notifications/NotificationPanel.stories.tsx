import * as React from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import type { NotificationDto } from '@open-mercato/shared/modules/notifications/types'
import { NotificationPanel } from './NotificationPanel'
import { FlashMessages, flash } from '../FlashMessages'

/*
  The bell's panel in the app's look (FMS ledger D39): header with the unread count and "Mark all read", underline
  tabs, the M3 surfaces and type scale, an empty state; and the flash toast at the bottom centre, where it never
  covers a header's actions (D47).
*/

const t = ((_key: string, fallback?: string) => fallback ?? _key) as never
const now = Date.now()
const item = (id: string, title: string, status: 'unread' | 'read', minutesAgo: number, extra: Partial<NotificationDto> = {}): NotificationDto => ({
  id,
  type: 'tasks.task.assigned',
  title,
  severity: 'info',
  status,
  actions: [],
  createdAt: new Date(now - minutesAgo * 60_000).toISOString(),
  ...extra,
})

const notifications: NotificationDto[] = [
  item('n1', 'Fiona Finance (QA): potwierdź saldo do piątku', 'unread', 3, { body: 'Windykacja: ZZ-CORE-VOL-0002', type: 'communication.rule' }),
  item('n2', 'Przypisano Ci zadanie: J10 Weryfikacja klienta', 'unread', 42, { body: 'OFF-IS Sp. z o.o.' }),
  item('n3', 'Wniosek ponowiony: Zielona Wine', 'read', 180, { type: 'credit_control.request_updated' }),
]

const noop = async () => undefined

const meta: Meta<typeof NotificationPanel> = {
  title: 'Backend/Notifications/NotificationPanel',
  component: NotificationPanel,
  parameters: { layout: 'fullscreen' },
}
export default meta

type Story = StoryObj<typeof NotificationPanel>

export const WithNotifications: Story = {
  render: () => (
    <NotificationPanel
      open
      onOpenChange={() => undefined}
      notifications={notifications}
      unreadCount={2}
      onMarkAsRead={noop}
      onExecuteAction={async () => ({})}
      onDismiss={noop}
      onMarkAllRead={noop}
      t={t}
    />
  ),
}

export const Empty: Story = {
  render: () => (
    <NotificationPanel open onOpenChange={() => undefined} notifications={[]} unreadCount={0} onMarkAsRead={noop} onExecuteAction={async () => ({})} onDismiss={noop} onMarkAllRead={noop} t={t} />
  ),
}

/** An error stays until dismissed — at the bottom centre, clear of the header's actions. */
export const ErrorToast: Story = {
  render: () => {
    React.useEffect(() => {
      flash('Nie zapisano — typ zadania zmienił ktoś inny. Odśwież i spróbuj ponownie.', 'error')
    }, [])
    return (
      <div className="min-h-screen">
        <div className="flex h-14 items-center justify-end gap-2 border-b px-4">
          <button type="button" className="h-9 rounded-full border px-4">Publish</button>
          <button type="button" className="size-9 rounded-full border">✕</button>
        </div>
        <FlashMessages />
      </div>
    )
  },
}
