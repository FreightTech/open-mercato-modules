'use client'

import * as React from 'react'
import { useState, useCallback, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Ship, Anchor, Calendar, Package } from 'lucide-react'
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
import { FacilityLocationInput, type FacilityLocationInputValue } from './FacilityLocationInput'
import type { FacilityLocation } from '../lib/location-types'

interface ShipmentFormData {
  carrierCode: string
  containerNumber: string
  bookingNumber: string
  bolNumber: string
  etd: string
  eta: string
  originLocation: FacilityLocationInputValue | null
  destinationLocation: FacilityLocationInputValue | null
  vesselName: string
  vesselImo: string
}

type TimestampEntry = {
  value: string
  offset: string | null
  source: string
  updatedAt: string
}

interface ShipmentData {
  id: string
  carrierCode?: string | null
  containerNumber?: string | null
  bookingNumber?: string | null
  bolNumber?: string | null
  // Multi-source timestamp arrays
  etdTimestamps?: TimestampEntry[] | null
  etaTimestamps?: TimestampEntry[] | null
  atdTimestamps?: TimestampEntry[] | null
  ataTimestamps?: TimestampEntry[] | null
  // Location data (JSONB)
  originLocation?: FacilityLocation | null
  destinationLocation?: FacilityLocation | null
  vesselName?: string | null
  vesselImo?: string | null
}

// Helper to get primary timestamp value from array (latest updatedAt wins)
function getPrimaryTimestamp(timestamps: TimestampEntry[] | null | undefined): string | null {
  if (!timestamps || timestamps.length === 0) return null
  const latest = timestamps.reduce((best, entry) =>
    entry.updatedAt > best.updatedAt ? entry : best
  )
  return latest.value
}

interface ShipmentDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'create' | 'edit'
  shipmentId?: string
  onSaved?: (shipment: { id: string }) => void
}

const initialFormData: ShipmentFormData = {
  carrierCode: '',
  containerNumber: '',
  bookingNumber: '',
  bolNumber: '',
  etd: '',
  eta: '',
  originLocation: null,
  destinationLocation: null,
  vesselName: '',
  vesselImo: '',
}

function formatDateForInput(dateString: string | null | undefined): string {
  if (!dateString) return ''
  const date = new Date(dateString)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().split('T')[0]
}

export function ShipmentDrawer({
  open,
  onOpenChange,
  mode,
  shipmentId,
  onSaved,
}: ShipmentDrawerProps) {
  const t = useT()
  const queryClient = useQueryClient()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formData, setFormData] = useState<ShipmentFormData>(initialFormData)

  // Fetch shipment data for edit mode
  const { data: shipmentData, isLoading: isLoadingShipment } = useQuery({
    queryKey: ['shipment_tracking_shipment', shipmentId],
    queryFn: async () => {
      if (!shipmentId) return null
      const response = await apiCall<{ items: Record<string, unknown>[] }>(`/api/shipment_tracking/shipments?id=${shipmentId}`)
      if (!response.ok) throw new Error('Failed to load shipment')
      const items = response.result?.items ?? []
      // Find the item matching the requested ID (API may return multiple items)
      const item = items.find((i) => i.id === shipmentId) ?? items[0]
      if (!item) return null
      
      // Normalize API response (handle both camelCase and snake_case)
      return {
        id: item.id as string,
        carrierCode: (item.carrierCode ?? item.carrier_code) as string | null,
        containerNumber: (item.containerNumber ?? item.container_number) as string | null,
        bookingNumber: (item.bookingNumber ?? item.booking_number) as string | null,
        bolNumber: (item.bolNumber ?? item.bol_number) as string | null,
        etdTimestamps: (item.etdTimestamps ?? item.etd_timestamps) as TimestampEntry[] | null,
        etaTimestamps: (item.etaTimestamps ?? item.eta_timestamps) as TimestampEntry[] | null,
        atdTimestamps: (item.atdTimestamps ?? item.atd_timestamps) as TimestampEntry[] | null,
        ataTimestamps: (item.ataTimestamps ?? item.ata_timestamps) as TimestampEntry[] | null,
        originLocation: (item.originLocation ?? item.origin_location) as FacilityLocation | null,
        destinationLocation: (item.destinationLocation ?? item.destination_location) as FacilityLocation | null,
        vesselName: (item.vesselName ?? item.vessel_name) as string | null,
        vesselImo: (item.vesselImo ?? item.vessel_imo) as string | null,
      } as ShipmentData
    },
    enabled: mode === 'edit' && !!shipmentId && open,
  })

  // Reset form when drawer opens/closes or mode changes
  useEffect(() => {
    if (!open) return
    
    if (mode === 'edit') {
      // In edit mode, only set form data once we have the shipment data
      // Don't reset to initial while loading
      if (shipmentData) {
        // Extract primary timestamp values from arrays
        const primaryEtd = getPrimaryTimestamp(shipmentData.etdTimestamps)
        const primaryEta = getPrimaryTimestamp(shipmentData.etaTimestamps)
        
        setFormData({
          carrierCode: shipmentData.carrierCode || '',
          containerNumber: shipmentData.containerNumber || '',
          bookingNumber: shipmentData.bookingNumber || '',
          bolNumber: shipmentData.bolNumber || '',
          etd: formatDateForInput(primaryEtd),
          eta: formatDateForInput(primaryEta),
          originLocation: shipmentData.originLocation || null,
          destinationLocation: shipmentData.destinationLocation || null,
          vesselName: shipmentData.vesselName || '',
          vesselImo: shipmentData.vesselImo || '',
        })
      }
      // If shipmentData is null/undefined, we're still loading - don't reset
    } else {
      // In create mode, always reset to initial
      setFormData(initialFormData)
    }
  }, [open, mode, shipmentData])

  // Handle form submission
  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      setIsSubmitting(true)

      try {
        // Validate that at least one reference number is provided
        if (!formData.containerNumber && !formData.bookingNumber && !formData.bolNumber) {
          flash(t('shipment_tracking.errors.referenceRequired', 'At least one of container number, booking number, or BOL number is required'), 'error')
          setIsSubmitting(false)
          return
        }

        // Build timestamp entries for ETD/ETA if provided
        // For create: include full timestamp arrays
        // For edit: use addEtdTimestamp/addEtaTimestamp to append manual entries
        const buildManualTimestamp = (dateStr: string) => {
          if (!dateStr) return undefined
          // Convert date input (YYYY-MM-DD) to ISO datetime at midnight UTC
          const isoValue = new Date(dateStr + 'T00:00:00Z').toISOString()
          return {
            value: isoValue,
            offset: 'Z' as const,
            source: 'manual' as const,
          }
        }

        const etdEntry = buildManualTimestamp(formData.etd)
        const etaEntry = buildManualTimestamp(formData.eta)

        // Clean up location objects - only include if they have meaningful data
        const cleanLocation = (loc: FacilityLocationInputValue | null): FacilityLocation | null => {
          if (!loc) return null
          // A location is meaningful if it has a name or unlocode
          if (!loc.name && !loc.unlocode) return null
          return {
            name: loc.name || loc.unlocode || 'Unknown',
            unlocode: loc.unlocode || null,
            countryCode: loc.countryCode || (loc.unlocode?.slice(0, 2) ?? null),
            facilityCode: loc.facilityCode || null,
            facilityCodeListProvider: loc.facilityCodeListProvider || null,
            facilityTypeCode: loc.facilityTypeCode || null,
            address: loc.address || null,
            coords: loc.coords || null,
            operatorName: loc.operatorName || null,
            source: 'manual',
          }
        }

        const payload: Record<string, unknown> = {
          carrierCode: formData.carrierCode || undefined,
          containerNumber: formData.containerNumber || undefined,
          bookingNumber: formData.bookingNumber || undefined,
          bolNumber: formData.bolNumber || undefined,
          originLocation: cleanLocation(formData.originLocation),
          destinationLocation: cleanLocation(formData.destinationLocation),
          vesselName: formData.vesselName || undefined,
          vesselImo: formData.vesselImo || undefined,
        }

        if (mode === 'edit') {
          // For updates, use addEtdTimestamp/addEtaTimestamp to append manual entries
          if (etdEntry) payload.addEtdTimestamp = etdEntry
          if (etaEntry) payload.addEtaTimestamp = etaEntry
        } else {
          // For create, build full timestamp arrays with updatedAt
          const now = new Date().toISOString()
          if (etdEntry) {
            payload.etdTimestamps = [{ ...etdEntry, updatedAt: now }]
          }
          if (etaEntry) {
            payload.etaTimestamps = [{ ...etaEntry, updatedAt: now }]
          }
        }

        let response: { ok: boolean; result?: { id: string; error?: string } | null }

        if (mode === 'edit' && shipmentId) {
          response = await apiCall<{ id: string; error?: string }>(
            `/api/shipment_tracking/shipments`,
            {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: shipmentId, ...payload }),
            }
          )
        } else {
          response = await apiCall<{ id: string; error?: string }>(
            '/api/shipment_tracking/shipments',
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
              ? t('shipment_tracking.shipments.flash.updated', 'Shipment updated successfully')
              : t('shipment_tracking.shipments.flash.created', 'Shipment created successfully'),
            'success'
          )
          queryClient.invalidateQueries({ queryKey: ['shipment_tracking_shipments'] })
          queryClient.invalidateQueries({ queryKey: ['shipment_tracking_shipment', shipmentId] })
          onSaved?.({ id: response.result.id })
          onOpenChange(false)
        } else {
          flash(response.result?.error || t('shipment_tracking.shipments.flash.saveFailed', 'Failed to save shipment'), 'error')
        }
      } catch (error) {
        flash(error instanceof Error ? error.message : t('shipment_tracking.shipments.flash.saveFailed', 'Failed to save shipment'), 'error')
      } finally {
        setIsSubmitting(false)
      }
    },
    [formData, mode, shipmentId, queryClient, onSaved, onOpenChange, t]
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
    ? t('shipment_tracking.shipments.edit', 'Edit Shipment')
    : t('shipment_tracking.shipments.create', 'Create Shipment')

  if (mode === 'edit' && isLoadingShipment) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          className="flex flex-col p-0"
          style={{ width: '550px', maxWidth: '550px' }}
          overlayClassName="backdrop-blur-none"
        >
          <div className="flex flex-col items-center justify-center h-48 gap-2">
            <Spinner className="h-6 w-6" />
            <span className="text-sm text-gray-500">{t('shipment_tracking.shipments.loading', 'Loading shipment...')}</span>
          </div>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="flex flex-col p-0"
        style={{ width: '550px', maxWidth: '550px' }}
        overlayClassName="backdrop-blur-none"
        onKeyDown={handleKeyDown}
      >
        <div className="flex-shrink-0 p-6 pb-4 border-b">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Ship className="h-5 w-5" />
              {title}
            </SheetTitle>
            <SheetDescription>
              {t('shipment_tracking.shipments.drawer.description', 'Enter shipment details for tracking. At least one reference number is required.')}
            </SheetDescription>
          </SheetHeader>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Reference Numbers Section */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Package className="h-4 w-4" />
                {t('shipment_tracking.shipments.drawer.referenceNumbers', 'Reference Numbers')}
              </div>
              <div className="grid grid-cols-1 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="containerNumber">{t('shipment_tracking.shipments.fields.containerNumber', 'Container Number')}</Label>
                  <Input
                    id="containerNumber"
                    placeholder="ABCD1234567"
                    value={formData.containerNumber}
                    onChange={(e) => setFormData({ ...formData, containerNumber: e.target.value.toUpperCase() })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="bookingNumber">{t('shipment_tracking.shipments.fields.bookingNumber', 'Booking Number')}</Label>
                    <Input
                      id="bookingNumber"
                      placeholder="BKG123456"
                      value={formData.bookingNumber}
                      onChange={(e) => setFormData({ ...formData, bookingNumber: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="bolNumber">{t('shipment_tracking.shipments.fields.bolNumber', 'BOL Number')}</Label>
                    <Input
                      id="bolNumber"
                      placeholder="BOL123456"
                      value={formData.bolNumber}
                      onChange={(e) => setFormData({ ...formData, bolNumber: e.target.value })}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Carrier & Vessel Section */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Anchor className="h-4 w-4" />
                {t('shipment_tracking.shipments.drawer.carrierVessel', 'Carrier & Vessel')}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="carrierCode">{t('shipment_tracking.shipments.fields.carrierCode', 'Carrier Code')}</Label>
                  <Input
                    id="carrierCode"
                    placeholder="MAEU"
                    value={formData.carrierCode}
                    onChange={(e) => setFormData({ ...formData, carrierCode: e.target.value.toUpperCase() })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="vesselName">{t('shipment_tracking.shipments.fields.vesselName', 'Vessel Name')}</Label>
                  <Input
                    id="vesselName"
                    placeholder="Ever Given"
                    value={formData.vesselName}
                    onChange={(e) => setFormData({ ...formData, vesselName: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="vesselImo">{t('shipment_tracking.shipments.fields.vesselImo', 'Vessel IMO')}</Label>
                <Input
                  id="vesselImo"
                  placeholder="9811000"
                  value={formData.vesselImo}
                  onChange={(e) => setFormData({ ...formData, vesselImo: e.target.value })}
                />
              </div>
            </div>

            {/* Origin Section */}
            <FacilityLocationInput
              label={t('shipment_tracking.shipments.drawer.origin', 'Origin')}
              value={formData.originLocation}
              onChange={(loc) => setFormData({ ...formData, originLocation: loc })}
            />

            {/* Destination Section */}
            <FacilityLocationInput
              label={t('shipment_tracking.shipments.drawer.destination', 'Destination')}
              value={formData.destinationLocation}
              onChange={(loc) => setFormData({ ...formData, destinationLocation: loc })}
            />

            {/* Schedule Section */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Calendar className="h-4 w-4" />
                {t('shipment_tracking.shipments.drawer.schedule', 'Schedule')}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="etd">{t('shipment_tracking.shipments.fields.etd', 'ETD')}</Label>
                  <Input
                    id="etd"
                    type="date"
                    value={formData.etd}
                    onChange={(e) => setFormData({ ...formData, etd: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="eta">{t('shipment_tracking.shipments.fields.eta', 'ETA')}</Label>
                  <Input
                    id="eta"
                    type="date"
                    value={formData.eta}
                    onChange={(e) => setFormData({ ...formData, eta: e.target.value })}
                  />
                </div>
              </div>
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
                  t('shipment_tracking.shipments.create', 'Create Shipment')
                )}
              </Button>
            </div>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  )
}

export type { ShipmentDrawerProps, ShipmentData }
