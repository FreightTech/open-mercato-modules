'use client'

import * as React from 'react'
import { useState, useCallback, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { MapPin, Building2, Navigation } from 'lucide-react'
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
import { Textarea } from '@freighttech/ui/primitives/textarea'
import { apiCall } from '@freighttech/ui/backend/utils/apiCall'
import { flash } from '@freighttech/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'

interface LocationOverrideFormData {
  carrierCode: string
  unlocode: string
  facilityCode: string
  facilityCodeListProvider: 'BIC' | 'SMDG'
  overrideData: {
    name: string
    address: string
    operatorName: string
    countryCode: string
    facilityTypeCode: string
    latitude: string
    longitude: string
  }
  description: string
  isActive: boolean
}

interface LocationOverrideData {
  id: string
  carrierCode: string | null
  unlocode: string
  facilityCode: string
  facilityCodeListProvider: 'BIC' | 'SMDG'
  overrideData: {
    name?: string
    address?: string | null
    operatorName?: string | null
    countryCode?: string | null
    facilityTypeCode?: string | null
    coords?: { latitude: number; longitude: number } | null
  }
  description?: string | null
  isActive: boolean
}

interface LocationOverrideDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'create' | 'edit'
  overrideId?: string
  onSaved?: (override: { id: string }) => void
}

const initialFormData: LocationOverrideFormData = {
  carrierCode: '',
  unlocode: '',
  facilityCode: '',
  facilityCodeListProvider: 'SMDG',
  overrideData: {
    name: '',
    address: '',
    operatorName: '',
    countryCode: '',
    facilityTypeCode: '',
    latitude: '',
    longitude: '',
  },
  description: '',
  isActive: true,
}

const FACILITY_TYPE_CODES = [
  { value: '', label: 'Select type...' },
  { value: 'POTE', label: 'POTE - Port Terminal' },
  { value: 'DEPO', label: 'DEPO - Depot' },
  { value: 'CLOC', label: 'CLOC - Customer Location' },
  { value: 'COFS', label: 'COFS - Container Freight Station' },
  { value: 'INTE', label: 'INTE - Intermodal Terminal' },
  { value: 'PBPL', label: 'PBPL - Pilot Boarding Place' },
  { value: 'BRTH', label: 'BRTH - Berth' },
]

export function LocationOverrideDrawer({
  open,
  onOpenChange,
  mode,
  overrideId,
  onSaved,
}: LocationOverrideDrawerProps) {
  const t = useT()
  const queryClient = useQueryClient()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formData, setFormData] = useState<LocationOverrideFormData>(initialFormData)
  const [isLoadingOverride, setIsLoadingOverride] = useState(mode === 'edit' && !!overrideId)

  // Fetch and populate form when opening in edit mode
  useEffect(() => {
    if (!open) return
    
    if (mode === 'create') {
      setFormData(initialFormData)
      setIsLoadingOverride(false)
      return
    }
    
    // Edit mode - fetch the override data
    if (mode === 'edit' && overrideId) {
      setIsLoadingOverride(true)
      apiCall<{ items: LocationOverrideData[] }>(`/api/shipment_tracking/location-overrides?id=${overrideId}`)
        .then((response) => {
          if (response.ok && response.result?.items?.[0]) {
            const data = response.result.items[0]
            setFormData({
              carrierCode: data.carrierCode || '',
              unlocode: data.unlocode || '',
              facilityCode: data.facilityCode || '',
              facilityCodeListProvider: data.facilityCodeListProvider || 'SMDG',
              overrideData: {
                name: data.overrideData?.name || '',
                address: data.overrideData?.address || '',
                operatorName: data.overrideData?.operatorName || '',
                countryCode: data.overrideData?.countryCode || '',
                facilityTypeCode: data.overrideData?.facilityTypeCode || '',
                latitude: data.overrideData?.coords?.latitude?.toString() || '',
                longitude: data.overrideData?.coords?.longitude?.toString() || '',
              },
              description: data.description || '',
              isActive: data.isActive ?? true,
            })
          }
        })
        .catch(() => {
          // Silently fail - form will show empty
        })
        .finally(() => {
          setIsLoadingOverride(false)
        })
    }
  }, [open, mode, overrideId])

  // Handle form submission
  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      setIsSubmitting(true)

      try {
        // Validate required fields
        if (!formData.unlocode.trim()) {
          flash(t('shipment_tracking.location_overrides.validation.unlocodeRequired', 'UNLOCODE is required'), 'error')
          setIsSubmitting(false)
          return
        }

        if (!formData.facilityCode.trim()) {
          flash(t('shipment_tracking.location_overrides.validation.facilityCodeRequired', 'Facility code is required'), 'error')
          setIsSubmitting(false)
          return
        }

        if (!formData.overrideData.name.trim()) {
          flash(t('shipment_tracking.location_overrides.validation.nameRequired', 'Override name is required'), 'error')
          setIsSubmitting(false)
          return
        }

        // Build payload
        const coords = formData.overrideData.latitude && formData.overrideData.longitude
          ? {
              latitude: parseFloat(formData.overrideData.latitude),
              longitude: parseFloat(formData.overrideData.longitude),
            }
          : null

        const payload = {
          carrierCode: formData.carrierCode.trim() || null,
          unlocode: formData.unlocode.trim().toUpperCase(),
          facilityCode: formData.facilityCode.trim(),
          facilityCodeListProvider: formData.facilityCodeListProvider,
          overrideData: {
            name: formData.overrideData.name.trim(),
            address: formData.overrideData.address.trim() || null,
            operatorName: formData.overrideData.operatorName.trim() || null,
            countryCode: formData.overrideData.countryCode.trim().toUpperCase() || null,
            facilityTypeCode: formData.overrideData.facilityTypeCode || null,
            coords,
          },
          description: formData.description.trim() || null,
          isActive: formData.isActive,
        }

        let response: { ok: boolean; result?: { id: string; error?: string } | null }

        if (mode === 'edit' && overrideId) {
          response = await apiCall<{ id: string; error?: string }>(
            `/api/shipment_tracking/location-overrides`,
            {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: overrideId, ...payload }),
            }
          )
        } else {
          response = await apiCall<{ id: string; error?: string }>(
            '/api/shipment_tracking/location-overrides',
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
              ? t('shipment_tracking.location_overrides.flash.updated', 'Location override updated successfully')
              : t('shipment_tracking.location_overrides.flash.created', 'Location override created successfully'),
            'success'
          )
          queryClient.invalidateQueries({ queryKey: ['shipment_tracking_location_overrides'] })
          onSaved?.({ id: response.result.id })
          onOpenChange(false)
        } else {
          flash(response.result?.error || t('shipment_tracking.location_overrides.flash.saveFailed', 'Failed to save location override'), 'error')
        }
      } catch (error) {
        flash(error instanceof Error ? error.message : t('shipment_tracking.location_overrides.flash.saveFailed', 'Failed to save location override'), 'error')
      } finally {
        setIsSubmitting(false)
      }
    },
    [formData, mode, overrideId, queryClient, onSaved, onOpenChange, t]
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
    ? t('shipment_tracking.location_overrides.edit', 'Edit Location Override')
    : t('shipment_tracking.location_overrides.create', 'Create Location Override')

  if (mode === 'edit' && isLoadingOverride) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          className="flex flex-col p-0"
          style={{ width: '550px', maxWidth: '550px' }}
          overlayClassName="backdrop-blur-none"
        >
          <div className="flex flex-col items-center justify-center h-48 gap-2">
            <Spinner className="h-6 w-6" />
            <span className="text-sm text-gray-500">{t('shipment_tracking.location_overrides.loading', 'Loading...')}</span>
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
              <MapPin className="h-5 w-5" />
              {title}
            </SheetTitle>
            <SheetDescription>
              {t('shipment_tracking.location_overrides.drawer.description', 'Override BIC/SMDG facility data for specific carriers or globally.')}
            </SheetDescription>
          </SheetHeader>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Match Criteria Section */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Navigation className="h-4 w-4" />
                {t('shipment_tracking.location_overrides.drawer.matchCriteria', 'Match Criteria')}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="carrierCode">
                    {t('shipment_tracking.location_overrides.fields.carrierCode', 'Carrier Code')}
                  </Label>
                  <Input
                    id="carrierCode"
                    placeholder={t('shipment_tracking.location_overrides.placeholder.carrierCode', 'e.g., MSC (empty = all)')}
                    value={formData.carrierCode}
                    onChange={(e) => setFormData({ ...formData, carrierCode: e.target.value.toUpperCase() })}
                    className="font-mono"
                  />
                  <p className="text-xs text-muted-foreground">
                    {t('shipment_tracking.location_overrides.hint.carrierCode', 'Leave empty for all carriers')}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="unlocode">
                    {t('shipment_tracking.location_overrides.fields.unlocode', 'UNLOCODE')} *
                  </Label>
                  <Input
                    id="unlocode"
                    placeholder="PLGDN"
                    value={formData.unlocode}
                    onChange={(e) => setFormData({ ...formData, unlocode: e.target.value.toUpperCase() })}
                    maxLength={5}
                    className="font-mono tracking-wider"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="facilityCode">
                    {t('shipment_tracking.location_overrides.fields.facilityCode', 'Facility Code')} *
                  </Label>
                  <Input
                    id="facilityCode"
                    placeholder="PLGDA"
                    value={formData.facilityCode}
                    onChange={(e) => setFormData({ ...formData, facilityCode: e.target.value })}
                    className="font-mono tracking-wider"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="provider">
                    {t('shipment_tracking.location_overrides.fields.provider', 'Code Provider')} *
                  </Label>
                  <div className="flex gap-4 pt-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="provider"
                        value="SMDG"
                        checked={formData.facilityCodeListProvider === 'SMDG'}
                        onChange={() => setFormData({ ...formData, facilityCodeListProvider: 'SMDG' })}
                        className="w-4 h-4"
                      />
                      <span className="text-sm font-medium">SMDG</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="provider"
                        value="BIC"
                        checked={formData.facilityCodeListProvider === 'BIC'}
                        onChange={() => setFormData({ ...formData, facilityCodeListProvider: 'BIC' })}
                        className="w-4 h-4"
                      />
                      <span className="text-sm font-medium">BIC</span>
                    </label>
                  </div>
                </div>
              </div>
            </div>

            {/* Override Data Section */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Building2 className="h-4 w-4" />
                {t('shipment_tracking.location_overrides.drawer.overrideData', 'Override Data')}
              </div>

              <div className="space-y-2">
                <Label htmlFor="name">
                  {t('shipment_tracking.location_overrides.fields.name', 'Terminal/Facility Name')} *
                </Label>
                <Input
                  id="name"
                  placeholder={t('shipment_tracking.location_overrides.placeholder.name', 'e.g., Baltic Hub Terminal (DCT Gdansk)')}
                  value={formData.overrideData.name}
                  onChange={(e) => setFormData({
                    ...formData,
                    overrideData: { ...formData.overrideData, name: e.target.value }
                  })}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="operatorName">
                  {t('shipment_tracking.location_overrides.fields.operatorName', 'Operator Name')}
                </Label>
                <Input
                  id="operatorName"
                  placeholder={t('shipment_tracking.location_overrides.placeholder.operatorName', 'e.g., DCT Gdansk S.A.')}
                  value={formData.overrideData.operatorName}
                  onChange={(e) => setFormData({
                    ...formData,
                    overrideData: { ...formData.overrideData, operatorName: e.target.value }
                  })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="address">
                  {t('shipment_tracking.location_overrides.fields.address', 'Address')}
                </Label>
                <Textarea
                  id="address"
                  placeholder={t('shipment_tracking.location_overrides.placeholder.address', 'e.g., ul. Kontenerowa 7, 80-601 Gdansk')}
                  value={formData.overrideData.address}
                  onChange={(e) => setFormData({
                    ...formData,
                    overrideData: { ...formData.overrideData, address: e.target.value }
                  })}
                  rows={2}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="countryCode">
                    {t('shipment_tracking.location_overrides.fields.countryCode', 'Country Code')}
                  </Label>
                  <Input
                    id="countryCode"
                    placeholder="PL"
                    value={formData.overrideData.countryCode}
                    onChange={(e) => setFormData({
                      ...formData,
                      overrideData: { ...formData.overrideData, countryCode: e.target.value.toUpperCase() }
                    })}
                    maxLength={2}
                    className="font-mono"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="facilityTypeCode">
                    {t('shipment_tracking.location_overrides.fields.facilityTypeCode', 'Facility Type')}
                  </Label>
                  <select
                    id="facilityTypeCode"
                    value={formData.overrideData.facilityTypeCode}
                    onChange={(e) => setFormData({
                      ...formData,
                      overrideData: { ...formData.overrideData, facilityTypeCode: e.target.value }
                    })}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    {FACILITY_TYPE_CODES.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="latitude">
                    {t('shipment_tracking.location_overrides.fields.latitude', 'Latitude')}
                  </Label>
                  <Input
                    id="latitude"
                    type="number"
                    step="any"
                    placeholder="54.3961"
                    value={formData.overrideData.latitude}
                    onChange={(e) => setFormData({
                      ...formData,
                      overrideData: { ...formData.overrideData, latitude: e.target.value }
                    })}
                    className="font-mono"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="longitude">
                    {t('shipment_tracking.location_overrides.fields.longitude', 'Longitude')}
                  </Label>
                  <Input
                    id="longitude"
                    type="number"
                    step="any"
                    placeholder="18.6596"
                    value={formData.overrideData.longitude}
                    onChange={(e) => setFormData({
                      ...formData,
                      overrideData: { ...formData.overrideData, longitude: e.target.value }
                    })}
                    className="font-mono"
                  />
                </div>
              </div>
            </div>

            {/* Metadata Section */}
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="description">
                  {t('shipment_tracking.location_overrides.fields.description', 'Description / Notes')}
                </Label>
                <Textarea
                  id="description"
                  placeholder={t('shipment_tracking.location_overrides.placeholder.description', 'Why this override exists...')}
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={2}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="isActive">
                    {t('shipment_tracking.location_overrides.fields.isActive', 'Active')}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {t('shipment_tracking.location_overrides.hint.isActive', 'Inactive overrides are ignored')}
                  </p>
                </div>
                <Switch
                  id="isActive"
                  checked={formData.isActive}
                  onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked })}
                />
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex-shrink-0 p-6 pt-4 border-t bg-background">
            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isSubmitting}
              >
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Spinner className="mr-2 h-4 w-4" />}
                {mode === 'edit'
                  ? t('common.save', 'Save')
                  : t('common.create', 'Create')}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-2 text-right">
              {t('common.keyboardShortcuts.cmdEnter', 'Cmd+Enter to save, Escape to cancel')}
            </p>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  )
}
