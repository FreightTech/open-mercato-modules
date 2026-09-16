'use client'

import * as React from 'react'
import { useState, useCallback } from 'react'
import { MapPin, Building2, Navigation, ChevronDown, ChevronUp } from 'lucide-react'
import { Input } from '@freighttech/ui/primitives/input'
import { Label } from '@freighttech/ui/primitives/label'
import { Button } from '@freighttech/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { FacilityLocation } from '../lib/location-types'

/**
 * Partial FacilityLocation for form input - all fields optional
 */
export type FacilityLocationInputValue = Partial<FacilityLocation>

interface FacilityLocationInputProps {
  value: FacilityLocationInputValue | null
  onChange: (value: FacilityLocationInputValue | null) => void
  label?: string
  disabled?: boolean
  /** Show facility code and coordinates by default (not collapsed) */
  showAdvanced?: boolean
}

/**
 * A form component for editing FacilityLocation data.
 * 
 * Primary fields (always visible):
 * - Port/Terminal Name
 * - UN/LOCODE
 * - Country Code
 * 
 * Advanced fields (collapsible):
 * - Facility Code + Provider (SMDG/BIC)
 * - Address
 * - Coordinates (lat/lng)
 */
export function FacilityLocationInput({
  value,
  onChange,
  label,
  disabled = false,
  showAdvanced = false,
}: FacilityLocationInputProps) {
  const t = useT()
  const [advancedOpen, setAdvancedOpen] = useState(showAdvanced)

  const updateField = useCallback(
    <K extends keyof FacilityLocation>(field: K, fieldValue: FacilityLocation[K]) => {
      onChange({
        ...value,
        [field]: fieldValue,
        source: 'manual',
      })
    },
    [value, onChange]
  )

  const updateCoord = useCallback(
    (coord: 'latitude' | 'longitude', numValue: number | null) => {
      const currentCoords = value?.coords
      const otherCoord = coord === 'latitude' ? currentCoords?.longitude : currentCoords?.latitude

      // If both are null/undefined, set coords to null
      if (numValue === null && (otherCoord === null || otherCoord === undefined)) {
        onChange({
          ...value,
          coords: null,
          source: 'manual',
        })
        return
      }

      onChange({
        ...value,
        coords: {
          latitude: coord === 'latitude' ? (numValue ?? 0) : (currentCoords?.latitude ?? 0),
          longitude: coord === 'longitude' ? (numValue ?? 0) : (currentCoords?.longitude ?? 0),
        },
        source: 'manual',
      })
    },
    [value, onChange]
  )

  return (
    <div className="space-y-4">
      {label && (
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <MapPin className="h-4 w-4" />
          {label}
        </div>
      )}

      {/* Primary fields: Name, UN/LOCODE, Country */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>{t('shipment_tracking.location.name', 'Port/Terminal Name')}</Label>
          <Input
            placeholder="Shanghai Port"
            value={value?.name || ''}
            onChange={(e) => updateField('name', e.target.value || '')}
            disabled={disabled}
          />
        </div>
        <div className="space-y-2">
          <Label>{t('shipment_tracking.location.unlocode', 'UN/LOCODE')}</Label>
          <Input
            placeholder="CNSHA"
            value={value?.unlocode || ''}
            onChange={(e) => updateField('unlocode', e.target.value.toUpperCase() || null)}
            disabled={disabled}
            maxLength={5}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>{t('shipment_tracking.location.country', 'Country Code')}</Label>
        <Input
          placeholder="CN"
          value={value?.countryCode || ''}
          onChange={(e) => updateField('countryCode', e.target.value.toUpperCase() || null)}
          disabled={disabled}
          maxLength={2}
        />
      </div>

      {/* Advanced fields toggle */}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="w-full justify-between"
        onClick={() => setAdvancedOpen(!advancedOpen)}
      >
        <span className="flex items-center gap-2">
          <Building2 className="h-4 w-4" />
          {t('shipment_tracking.location.advancedDetails', 'Facility & Coordinates')}
        </span>
        {advancedOpen ? (
          <ChevronUp className="h-4 w-4" />
        ) : (
          <ChevronDown className="h-4 w-4" />
        )}
      </Button>

      {/* Advanced fields: Facility, Address, Coordinates */}
      {advancedOpen && (
        <div className="space-y-4 pt-2">
          {/* Facility Code */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{t('shipment_tracking.location.facilityCode', 'Facility Code')}</Label>
              <Input
                placeholder="DCT"
                value={value?.facilityCode || ''}
                onChange={(e) =>
                  updateField('facilityCode', e.target.value.toUpperCase() || null)
                }
                disabled={disabled}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('shipment_tracking.location.facilityProvider', 'Provider')}</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                value={value?.facilityCodeListProvider || ''}
                onChange={(e) =>
                  updateField(
                    'facilityCodeListProvider',
                    (e.target.value as 'SMDG' | 'BIC') || null
                  )
                }
                disabled={disabled}
              >
                <option value="">-</option>
                <option value="SMDG">SMDG</option>
                <option value="BIC">BIC</option>
              </select>
            </div>
          </div>

          {/* Address */}
          <div className="space-y-2">
            <Label>{t('shipment_tracking.location.address', 'Address')}</Label>
            <Input
              placeholder="Terminal Road 123, Shanghai, China"
              value={value?.address || ''}
              onChange={(e) => updateField('address', e.target.value || null)}
              disabled={disabled}
            />
          </div>

          {/* Coordinates */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="flex items-center gap-1">
                <Navigation className="h-3 w-3" />
                {t('shipment_tracking.location.latitude', 'Latitude')}
              </Label>
              <Input
                type="number"
                step="0.000001"
                placeholder="31.2304"
                value={value?.coords?.latitude ?? ''}
                onChange={(e) =>
                  updateCoord('latitude', e.target.value ? parseFloat(e.target.value) : null)
                }
                disabled={disabled}
              />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-1">
                <Navigation className="h-3 w-3" />
                {t('shipment_tracking.location.longitude', 'Longitude')}
              </Label>
              <Input
                type="number"
                step="0.000001"
                placeholder="121.4737"
                value={value?.coords?.longitude ?? ''}
                onChange={(e) =>
                  updateCoord('longitude', e.target.value ? parseFloat(e.target.value) : null)
                }
                disabled={disabled}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
