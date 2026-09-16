'use client'

import * as React from 'react'
import { useState, useCallback, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Radar, Ship, Package, FileText, MapPin } from 'lucide-react'
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
import { Spinner } from '@freighttech/ui/primitives/spinner'
import { apiCall } from '@freighttech/ui/backend/utils/apiCall'
import { flash } from '@freighttech/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'

// Reference type options
const REFERENCE_TYPES = [
  { id: 'container', label: 'Container Number', icon: Package },
  { id: 'booking', label: 'Booking Number', icon: FileText },
  { id: 'bol', label: 'Bill of Lading', icon: FileText },
] as const

type ReferenceType = typeof REFERENCE_TYPES[number]['id']

interface CarrierOption {
  carrierCode: string
  isActive: boolean
}

interface TrackingJobFormData {
  carrierCode: string
  referenceType: ReferenceType
  referenceValue: string
  originUnlocode: string
  destinationUnlocode: string
}

interface TrackingJobData {
  id: string
  carrierCode: string
  referenceType: ReferenceType
  referenceValue: string
  originUnlocode: string
  destinationUnlocode: string
  status: string
}

interface TrackingJobDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'create' | 'edit'
  trackingJobId?: string
  onSaved?: (trackingJob: { id: string }) => void
}

const initialFormData: TrackingJobFormData = {
  carrierCode: '',
  referenceType: 'container',
  referenceValue: '',
  originUnlocode: '',
  destinationUnlocode: '',
}

export function TrackingJobDrawer({
  open,
  onOpenChange,
  mode,
  trackingJobId,
  onSaved,
}: TrackingJobDrawerProps) {
  const t = useT()
  const queryClient = useQueryClient()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formData, setFormData] = useState<TrackingJobFormData>(initialFormData)
  const [carriers, setCarriers] = useState<CarrierOption[]>([])
  const [isLoadingCarriers, setIsLoadingCarriers] = useState(false)
  const [isLoadingJob, setIsLoadingJob] = useState(mode === 'edit' && !!trackingJobId)

  // Fetch available carriers on open
  useEffect(() => {
    if (!open) return

    setIsLoadingCarriers(true)
    apiCall<{ items: CarrierOption[] }>('/api/shipment_tracking/carrier-configs?isActive=true&pageSize=100')
      .then((response) => {
        if (response.ok && response.result?.items) {
          setCarriers(response.result.items)
        }
      })
      .catch(() => {
        // Silently fail - user will see empty carrier list
      })
      .finally(() => {
        setIsLoadingCarriers(false)
      })
  }, [open])

  // Fetch and populate form when opening in edit mode
  useEffect(() => {
    if (!open) return

    if (mode === 'create') {
      setFormData(initialFormData)
      setIsLoadingJob(false)
      return
    }

    // Edit mode - fetch the tracking job data
    if (mode === 'edit' && trackingJobId) {
      setIsLoadingJob(true)
      apiCall<{ items: TrackingJobData[] }>(`/api/shipment_tracking/tracking-jobs?id=${trackingJobId}`)
        .then((response) => {
          if (response.ok && response.result?.items?.[0]) {
            const data = response.result.items[0]
            setFormData({
              carrierCode: data.carrierCode || '',
              referenceType: data.referenceType || 'container',
              referenceValue: data.referenceValue || '',
              originUnlocode: data.originUnlocode || '',
              destinationUnlocode: data.destinationUnlocode || '',
            })
          }
        })
        .catch(() => {
          // Silently fail - form will show empty
        })
        .finally(() => {
          setIsLoadingJob(false)
        })
    }
  }, [open, mode, trackingJobId])

  // Handle form submission
  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      setIsSubmitting(true)

      try {
        // Validate carrier
        if (!formData.carrierCode) {
          flash(t('shipment_tracking.tracking_jobs.validation.carrierRequired', 'Carrier is required'), 'error')
          setIsSubmitting(false)
          return
        }

        // Validate reference value
        if (!formData.referenceValue.trim()) {
          flash(t('shipment_tracking.tracking_jobs.validation.referenceValueRequired', 'Reference value is required'), 'error')
          setIsSubmitting(false)
          return
        }

        // Validate UN/LOCODE format (2 letters + 3 alphanumeric) - only if provided
        const unLocodePattern = /^[A-Z]{2}[A-Z0-9]{3}$/
        const originValue = formData.originUnlocode.trim().toUpperCase()
        const destinationValue = formData.destinationUnlocode.trim().toUpperCase()

        if (originValue && !unLocodePattern.test(originValue)) {
          flash(t('shipment_tracking.tracking_jobs.validation.invalidOriginUnlocode', 'Invalid origin UN/LOCODE format (e.g., CNYTN)'), 'error')
          setIsSubmitting(false)
          return
        }
        if (destinationValue && !unLocodePattern.test(destinationValue)) {
          flash(t('shipment_tracking.tracking_jobs.validation.invalidDestinationUnlocode', 'Invalid destination UN/LOCODE format (e.g., PLGDN)'), 'error')
          setIsSubmitting(false)
          return
        }

        // Build payload - only include ports if provided
        const payload: Record<string, unknown> = {
          carrierCode: formData.carrierCode,
          referenceType: formData.referenceType,
          referenceValue: formData.referenceValue.trim().toUpperCase(),
        }
        if (originValue) payload.originUnlocode = originValue
        if (destinationValue) payload.destinationUnlocode = destinationValue

        let response: { ok: boolean; result?: { id: string; error?: string } | null }

        if (mode === 'edit' && trackingJobId) {
          // Edit mode is limited - can only update certain fields
          response = await apiCall<{ id: string; error?: string }>(
            `/api/shipment_tracking/tracking-jobs`,
            {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: trackingJobId, ...payload }),
            }
          )
        } else {
          response = await apiCall<{ id: string; error?: string }>(
            '/api/shipment_tracking/tracking-jobs',
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
              ? t('shipment_tracking.tracking_jobs.flash.updated', 'Tracking job updated successfully')
              : t('shipment_tracking.tracking_jobs.flash.created', 'Tracking job created successfully'),
            'success'
          )
          queryClient.invalidateQueries({ queryKey: ['shipment_tracking_tracking_jobs'] })
          queryClient.invalidateQueries({ queryKey: ['shipment_tracking_tracking_job', trackingJobId] })
          onSaved?.({ id: response.result.id })
          onOpenChange(false)
        } else {
          flash(response.result?.error || t('shipment_tracking.tracking_jobs.flash.saveFailed', 'Failed to save tracking job'), 'error')
        }
      } catch (error) {
        flash(error instanceof Error ? error.message : t('shipment_tracking.tracking_jobs.flash.saveFailed', 'Failed to save tracking job'), 'error')
      } finally {
        setIsSubmitting(false)
      }
    },
    [formData, mode, trackingJobId, queryClient, onSaved, onOpenChange, t]
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
    ? t('shipment_tracking.tracking_jobs.edit', 'Edit Tracking Job')
    : t('shipment_tracking.tracking_jobs.create', 'Create Tracking Job')

  const selectedReferenceType = REFERENCE_TYPES.find((rt) => rt.id === formData.referenceType)
  const ReferenceIcon = selectedReferenceType?.icon ?? Package

  if (mode === 'edit' && isLoadingJob) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          className="flex flex-col p-0"
          style={{ width: '450px', maxWidth: '450px' }}
          overlayClassName="backdrop-blur-none"
        >
          <div className="flex flex-col items-center justify-center h-48 gap-2">
            <Spinner className="h-6 w-6" />
            <span className="text-sm text-gray-500">{t('shipment_tracking.tracking_jobs.loading', 'Loading tracking job...')}</span>
          </div>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="flex flex-col p-0"
        style={{ width: '450px', maxWidth: '450px' }}
        overlayClassName="backdrop-blur-none"
        onKeyDown={handleKeyDown}
      >
        <div className="flex-shrink-0 p-6 pb-4 border-b">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Radar className="h-5 w-5" />
              {title}
            </SheetTitle>
            <SheetDescription>
              {t('shipment_tracking.tracking_jobs.drawer.description', 'Create a tracking job to monitor shipments. The system will automatically poll the carrier for updates and create shipments for discovered containers.')}
            </SheetDescription>
          </SheetHeader>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Carrier Selection */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Ship className="h-4 w-4" />
                {t('shipment_tracking.tracking_jobs.drawer.carrier', 'Carrier')}
              </div>
              <div className="space-y-2">
                <Label htmlFor="carrierCode">{t('shipment_tracking.tracking_jobs.fields.carrierCode', 'Carrier')} *</Label>
                <select
                  id="carrierCode"
                  value={formData.carrierCode}
                  onChange={(e) => setFormData({ ...formData, carrierCode: e.target.value })}
                  disabled={mode === 'edit'}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="">
                    {isLoadingCarriers ? t('common.loading', 'Loading...') : t('shipment_tracking.tracking_jobs.drawer.selectCarrier', 'Select a carrier')}
                  </option>
                  {carriers.map((carrier) => (
                    <option key={carrier.carrierCode} value={carrier.carrierCode}>
                      {carrier.carrierCode.toUpperCase()}
                    </option>
                  ))}
                </select>
                {carriers.length === 0 && !isLoadingCarriers && (
                  <p className="text-xs text-amber-600">
                    {t('shipment_tracking.tracking_jobs.drawer.noCarriers', 'No carriers configured. Add carrier configurations first.')}
                  </p>
                )}
              </div>
            </div>

            {/* Reference Section */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <ReferenceIcon className="h-4 w-4" />
                {t('shipment_tracking.tracking_jobs.drawer.reference', 'Reference')}
              </div>

              {/* Reference Type */}
              <div className="space-y-2">
                <Label htmlFor="referenceType">{t('shipment_tracking.tracking_jobs.fields.referenceType', 'Reference Type')} *</Label>
                <select
                  id="referenceType"
                  value={formData.referenceType}
                  onChange={(e) => setFormData({ ...formData, referenceType: e.target.value as ReferenceType })}
                  disabled={mode === 'edit'}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {REFERENCE_TYPES.map((refType) => (
                    <option key={refType.id} value={refType.id}>
                      {t(`shipment_tracking.tracking_jobs.referenceTypes.${refType.id}`, refType.label)}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  {formData.referenceType === 'container'
                    ? t('shipment_tracking.tracking_jobs.drawer.containerHint', 'Enter the container number (e.g., MSBU1234567).')
                    : formData.referenceType === 'booking'
                      ? t('shipment_tracking.tracking_jobs.drawer.bookingHint', 'Enter the booking number. Multiple containers may be discovered.')
                      : t('shipment_tracking.tracking_jobs.drawer.bolHint', 'Enter the Bill of Lading number.')}
                </p>
              </div>

              {/* Reference Value */}
              <div className="space-y-2">
                <Label htmlFor="referenceValue">{t('shipment_tracking.tracking_jobs.fields.referenceValue', 'Reference Value')} *</Label>
                <Input
                  id="referenceValue"
                  type="text"
                  placeholder={
                    formData.referenceType === 'container'
                      ? 'MSBU1234567'
                      : formData.referenceType === 'booking'
                        ? '123456789'
                        : 'MEDUN1234567'
                  }
                  value={formData.referenceValue}
                  onChange={(e) => setFormData({ ...formData, referenceValue: e.target.value.toUpperCase() })}
                  disabled={mode === 'edit'}
                  className="uppercase"
                  autoComplete="off"
                />
              </div>
            </div>

            {/* Route Section - Origin & Destination (Optional - auto-detected from events) */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <MapPin className="h-4 w-4" />
                {t('shipment_tracking.tracking_jobs.drawer.route', 'Route')}
                <span className="text-xs font-normal text-muted-foreground">
                  ({t('shipment_tracking.tracking_jobs.drawer.optional', 'optional')})
                </span>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Origin UN/LOCODE */}
                <div className="space-y-2">
                  <Label htmlFor="originUnlocode">{t('shipment_tracking.tracking_jobs.fields.originUnlocode', 'Origin Port')}</Label>
                  <Input
                    id="originUnlocode"
                    type="text"
                    placeholder="CNYTN"
                    value={formData.originUnlocode}
                    onChange={(e) => setFormData({ ...formData, originUnlocode: e.target.value.toUpperCase() })}
                    disabled={mode === 'edit'}
                    className="uppercase"
                    autoComplete="off"
                    maxLength={5}
                  />
                </div>

                {/* Destination UN/LOCODE */}
                <div className="space-y-2">
                  <Label htmlFor="destinationUnlocode">{t('shipment_tracking.tracking_jobs.fields.destinationUnlocode', 'Destination Port')}</Label>
                  <Input
                    id="destinationUnlocode"
                    type="text"
                    placeholder="PLGDN"
                    value={formData.destinationUnlocode}
                    onChange={(e) => setFormData({ ...formData, destinationUnlocode: e.target.value.toUpperCase() })}
                    disabled={mode === 'edit'}
                    className="uppercase"
                    autoComplete="off"
                    maxLength={5}
                  />
                </div>
              </div>

              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs text-amber-800">
                  {t('shipment_tracking.tracking_jobs.drawer.autoDetectHint', 'If not provided, origin and destination will be automatically detected from tracking events (EST/ACT arrivals and departures).')}
                </p>
              </div>
            </div>

            {/* Info box for booking/BOL tracking */}
            {formData.referenceType !== 'container' && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                <h4 className="text-sm font-medium text-blue-900 mb-1">
                  {t('shipment_tracking.tracking_jobs.drawer.multiContainerTitle', 'Multi-Container Tracking')}
                </h4>
                <p className="text-xs text-blue-700">
                  {t('shipment_tracking.tracking_jobs.drawer.multiContainerDescription', 'When tracking by booking or BOL, the system will automatically discover all containers associated with this reference and create individual shipment records for each one.')}
                </p>
              </div>
            )}
          </div>

          {/* Sticky footer */}
          <div className="flex-shrink-0 border-t bg-background p-6">
            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button type="submit" disabled={isSubmitting || carriers.length === 0}>
                {isSubmitting ? (
                  <>
                    <Spinner className="mr-2 h-4 w-4" />
                    {t('common.saving', 'Saving...')}
                  </>
                ) : mode === 'edit' ? (
                  t('common.saveChanges', 'Save Changes')
                ) : (
                  t('shipment_tracking.tracking_jobs.create', 'Create Tracking Job')
                )}
              </Button>
            </div>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  )
}

export type { TrackingJobDrawerProps, TrackingJobData }
