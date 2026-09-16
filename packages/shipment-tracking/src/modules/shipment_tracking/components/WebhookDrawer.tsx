'use client'

import * as React from 'react'
import { useState, useCallback, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Webhook, Link2, Bell, Shield } from 'lucide-react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@freighttech/ui/primitives/sheet'
import { Button } from '@freighttech/ui/primitives/button'
import { Input } from '@freighttech/ui/primitives/input'
import { Label } from '@freighttech/ui/primitives/label'
import { Switch } from '@freighttech/ui/primitives/switch'
import { Spinner } from '@freighttech/ui/primitives/spinner'
import { Checkbox } from '@freighttech/ui/primitives/checkbox'
import { apiCall } from '@freighttech/ui/backend/utils/apiCall'
import { flash } from '@freighttech/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'

// Available webhook events for subscription
const WEBHOOK_EVENTS = [
  // Shipment CRUD
  { id: 'shipment_tracking.shipment.created', label: 'Shipment Created', category: 'Shipment' },
  { id: 'shipment_tracking.shipment.updated', label: 'Shipment Updated', category: 'Shipment' },
  { id: 'shipment_tracking.shipment.deleted', label: 'Shipment Deleted', category: 'Shipment' },
  // Shipment Lifecycle
  { id: 'shipment_tracking.shipment.status_changed', label: 'Status Changed', category: 'Shipment' },
  { id: 'shipment_tracking.shipment.booked', label: 'Booked', category: 'Shipment' },
  { id: 'shipment_tracking.shipment.delivered', label: 'Delivered', category: 'Shipment' },
  // Transport (DCSA)
  { id: 'shipment_tracking.transport.departed', label: 'Departed', category: 'Transport' },
  { id: 'shipment_tracking.transport.arrived', label: 'Arrived', category: 'Transport' },
  { id: 'shipment_tracking.transport.eta_updated', label: 'ETA Updated', category: 'Transport' },
  { id: 'shipment_tracking.transport.etd_updated', label: 'ETD Updated', category: 'Transport' },
  { id: 'shipment_tracking.transport.omitted', label: 'Port Omitted', category: 'Transport' },
  // Equipment (DCSA)
  { id: 'shipment_tracking.equipment.loaded', label: 'Loaded', category: 'Equipment' },
  { id: 'shipment_tracking.equipment.discharged', label: 'Discharged', category: 'Equipment' },
  { id: 'shipment_tracking.equipment.gate_in', label: 'Gate In', category: 'Equipment' },
  { id: 'shipment_tracking.equipment.gate_out', label: 'Gate Out', category: 'Equipment' },
  { id: 'shipment_tracking.equipment.available_pickup', label: 'Available for Pickup', category: 'Equipment' },
  { id: 'shipment_tracking.equipment.customs_released', label: 'Customs Released', category: 'Equipment' },
  { id: 'shipment_tracking.equipment.inspected', label: 'Inspected', category: 'Equipment' },
  // Tracking Events
  { id: 'shipment_tracking.tracking_event.created', label: 'Event Created', category: 'Tracking' },
  // Tracking Jobs
  { id: 'shipment_tracking.tracking_job.created', label: 'Job Created', category: 'Jobs' },
  { id: 'shipment_tracking.tracking_job.updated', label: 'Job Updated', category: 'Jobs' },
  { id: 'shipment_tracking.tracking_job.failed', label: 'Job Failed', category: 'Jobs' },
  { id: 'shipment_tracking.tracking_job.completed', label: 'Job Completed', category: 'Jobs' },
] as const

interface WebhookFormData {
  url: string
  eventsSubscribed: string[]
  hmacSecret: string
  isActive: boolean
}

interface WebhookData {
  id: string
  url: string
  eventsSubscribed: string[]
  hmacSecret?: string | null
  isActive: boolean
}

interface WebhookDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'create' | 'edit'
  webhookId?: string
  onSaved?: (webhook: { id: string }) => void
}

const initialFormData: WebhookFormData = {
  url: '',
  eventsSubscribed: [],
  hmacSecret: '',
  isActive: true,
}

export function WebhookDrawer({
  open,
  onOpenChange,
  mode,
  webhookId,
  onSaved,
}: WebhookDrawerProps) {
  const t = useT()
  const queryClient = useQueryClient()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formData, setFormData] = useState<WebhookFormData>(initialFormData)

  const [isLoadingWebhook, setIsLoadingWebhook] = useState(mode === 'edit' && !!webhookId)

  // Fetch and populate form when opening in edit mode
  useEffect(() => {
    if (!open) return
    
    if (mode === 'create') {
      setFormData(initialFormData)
      setIsLoadingWebhook(false)
      return
    }
    
    // Edit mode - fetch the webhook data
    if (mode === 'edit' && webhookId) {
      setIsLoadingWebhook(true)
      apiCall<{ items: WebhookData[] }>(`/api/shipment_tracking/webhooks?id=${webhookId}`)
        .then((response) => {
          if (response.ok && response.result?.items?.[0]) {
            const data = response.result.items[0]
            setFormData({
              url: data.url || '',
              eventsSubscribed: data.eventsSubscribed || [],
              hmacSecret: data.hmacSecret || '',
              isActive: data.isActive ?? true,
            })
          }
        })
        .catch(() => {
          // Silently fail - form will show empty
        })
        .finally(() => {
          setIsLoadingWebhook(false)
        })
    }
  }, [open, mode, webhookId])

  // Handle event checkbox change
  const handleEventChange = useCallback((eventId: string, checked: boolean) => {
    setFormData((prev) => ({
      ...prev,
      eventsSubscribed: checked
        ? [...prev.eventsSubscribed, eventId]
        : prev.eventsSubscribed.filter((e: string) => e !== eventId),
    }))
  }, [])

  // Select/deselect all events in a category
  const handleCategoryToggle = useCallback((category: string) => {
    const categoryEvents = WEBHOOK_EVENTS.filter((e) => e.category === category).map((e) => e.id as string)
    const allSelected = categoryEvents.every((e) => formData.eventsSubscribed.includes(e))
    
    setFormData((prev) => ({
      ...prev,
      eventsSubscribed: allSelected
        ? prev.eventsSubscribed.filter((e: string) => !categoryEvents.includes(e))
        : [...new Set([...prev.eventsSubscribed, ...categoryEvents])],
    }))
  }, [formData.eventsSubscribed])

  // Handle form submission
  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      setIsSubmitting(true)

      try {
        // Validate URL
        if (!formData.url.trim()) {
          flash(t('shipment_tracking.webhooks.validation.urlRequired', 'URL is required'), 'error')
          setIsSubmitting(false)
          return
        }

        // Validate events
        if (formData.eventsSubscribed.length === 0) {
          flash(t('shipment_tracking.webhooks.validation.eventsRequired', 'At least one event must be selected'), 'error')
          setIsSubmitting(false)
          return
        }

        const payload = {
          url: formData.url.trim(),
          eventsSubscribed: formData.eventsSubscribed,
          hmacSecret: formData.hmacSecret.trim() || undefined,
          isActive: formData.isActive,
        }

        let response: { ok: boolean; result?: { id: string; error?: string } | null }

        if (mode === 'edit' && webhookId) {
          response = await apiCall<{ id: string; error?: string }>(
            `/api/shipment_tracking/webhooks`,
            {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: webhookId, ...payload }),
            }
          )
        } else {
          response = await apiCall<{ id: string; error?: string }>(
            '/api/shipment_tracking/webhooks',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            }
          )
        }

        if (response.ok && response.result?.id) {
          flash(
            mode === 'edit'
              ? t('shipment_tracking.webhooks.flash.updated', 'Webhook updated successfully')
              : t('shipment_tracking.webhooks.flash.created', 'Webhook created successfully'),
            'success'
          )
          queryClient.invalidateQueries({ queryKey: ['shipment_tracking_webhooks'] })
          queryClient.invalidateQueries({ queryKey: ['shipment_tracking_webhook', webhookId] })
          onSaved?.({ id: response.result.id })
          onOpenChange(false)
        } else {
          flash(response.result?.error || t('shipment_tracking.webhooks.flash.saveFailed', 'Failed to save webhook'), 'error')
        }
      } catch (error) {
        flash(error instanceof Error ? error.message : t('shipment_tracking.webhooks.flash.saveFailed', 'Failed to save webhook'), 'error')
      } finally {
        setIsSubmitting(false)
      }
    },
    [formData, mode, webhookId, queryClient, onSaved, onOpenChange, t]
  )

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        handleSubmit(e as unknown as React.FormEvent)
      }
      if (e.key === 'Escape') {
        onOpenChange(false)
      }
    },
    [handleSubmit, onOpenChange]
  )

  const title = mode === 'edit'
    ? t('shipment_tracking.webhooks.edit', 'Edit Webhook')
    : t('shipment_tracking.webhooks.create', 'Create Webhook')

  // Group events by category
  const eventsByCategory = WEBHOOK_EVENTS.reduce((acc, event) => {
    if (!acc[event.category]) acc[event.category] = []
    acc[event.category].push(event)
    return acc
  }, {} as Record<string, typeof WEBHOOK_EVENTS[number][]>)

  if (mode === 'edit' && isLoadingWebhook) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          className="flex flex-col p-0"
          style={{ width: '500px', maxWidth: '500px' }}
          overlayClassName="backdrop-blur-none"
        >
          <div className="flex flex-col items-center justify-center h-48 gap-2">
            <Spinner className="h-6 w-6" />
            <span className="text-sm text-gray-500">{t('shipment_tracking.webhooks.loading', 'Loading webhook...')}</span>
          </div>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="flex flex-col p-0"
        style={{ width: '500px', maxWidth: '500px' }}
        overlayClassName="backdrop-blur-none"
        onKeyDown={handleKeyDown}
      >
        <div className="flex-shrink-0 p-6 pb-4 border-b">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Webhook className="h-5 w-5" />
              {title}
            </SheetTitle>
            <SheetDescription>
              {t('shipment_tracking.webhooks.drawer.description', 'Configure a webhook endpoint to receive shipment tracking events.')}
            </SheetDescription>
          </SheetHeader>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Endpoint URL Section */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Link2 className="h-4 w-4" />
                {t('shipment_tracking.webhooks.drawer.endpoint', 'Endpoint')}
              </div>
              <div className="space-y-2">
                <Label htmlFor="url">{t('shipment_tracking.webhooks.fields.url', 'URL')} *</Label>
                <Input
                  id="url"
                  type="url"
                  placeholder="https://example.com/webhooks/shipment-tracking"
                  value={formData.url}
                  onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  {t('shipment_tracking.webhooks.drawer.urlHint', 'The URL where webhook payloads will be sent via HTTP POST.')}
                </p>
              </div>
            </div>

            {/* Events Section */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Bell className="h-4 w-4" />
                {t('shipment_tracking.webhooks.drawer.events', 'Events to Subscribe')}
              </div>
              <p className="text-xs text-muted-foreground">
                {t('shipment_tracking.webhooks.drawer.eventsHint', 'Select which events should trigger this webhook.')}
              </p>
              
              <div className="space-y-4">
                {Object.entries(eventsByCategory).map(([category, events]) => {
                  const categoryEvents = events.map((e) => e.id)
                  const allSelected = categoryEvents.every((e) => formData.eventsSubscribed.includes(e))
                  const someSelected = categoryEvents.some((e) => formData.eventsSubscribed.includes(e))
                  
                  return (
                    <div key={category} className="rounded-lg border p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">{category}</span>
                        <button
                          type="button"
                          onClick={() => handleCategoryToggle(category)}
                          className="text-xs text-primary hover:underline"
                        >
                          {allSelected ? t('common.deselectAll', 'Deselect all') : t('common.selectAll', 'Select all')}
                        </button>
                      </div>
                      <div className="space-y-2">
                        {events.map((event) => (
                          <div key={event.id} className="flex items-center gap-2">
                            <Checkbox
                              id={event.id}
                              checked={formData.eventsSubscribed.includes(event.id)}
                              onCheckedChange={(checked) => handleEventChange(event.id, checked === true)}
                            />
                            <Label htmlFor={event.id} className="text-sm font-normal cursor-pointer">
                              {event.label}
                            </Label>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>

              {formData.eventsSubscribed.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {t('shipment_tracking.webhooks.drawer.selectedCount', '{{count}} event(s) selected', { count: formData.eventsSubscribed.length })}
                </p>
              )}
            </div>

            {/* Security Section */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Shield className="h-4 w-4" />
                {t('shipment_tracking.webhooks.drawer.security', 'Security')}
              </div>
              <div className="space-y-2">
                <Label htmlFor="hmacSecret">{t('shipment_tracking.webhooks.fields.hmacSecret', 'HMAC Secret')}</Label>
                <Input
                  id="hmacSecret"
                  type="password"
                  placeholder={t('shipment_tracking.webhooks.drawer.hmacPlaceholder', 'Optional signing secret')}
                  value={formData.hmacSecret}
                  onChange={(e) => setFormData({ ...formData, hmacSecret: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  {t('shipment_tracking.webhooks.drawer.hmacHint', 'If provided, webhook payloads will be signed with this secret using HMAC-SHA256.')}
                </p>
              </div>
            </div>

            {/* Status Section */}
            <div className="flex items-center justify-between pt-2">
              <div className="space-y-1">
                <Label htmlFor="isActive">{t('shipment_tracking.webhooks.fields.isActive', 'Active')}</Label>
                <p className="text-xs text-muted-foreground">
                  {t('shipment_tracking.webhooks.drawer.activeHint', 'Inactive webhooks will not receive events.')}
                </p>
              </div>
              <Switch
                id="isActive"
                checked={formData.isActive}
                onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked })}
              />
            </div>
          </div>

          {/* Sticky footer */}
          <div className="flex-shrink-0 border-t bg-background p-6">
            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <Spinner className="mr-2 h-4 w-4" />
                    {t('common.saving', 'Saving...')}
                  </>
                ) : mode === 'edit' ? (
                  t('common.saveChanges', 'Save Changes')
                ) : (
                  t('shipment_tracking.webhooks.create', 'Create Webhook')
                )}
              </Button>
            </div>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  )
}

export type { WebhookDrawerProps, WebhookData }
