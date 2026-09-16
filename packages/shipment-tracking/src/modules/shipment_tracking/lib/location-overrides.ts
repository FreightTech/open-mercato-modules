/**
 * Location Override Helpers
 *
 * Provides lookup and application of location overrides for BIC/SMDG facility data.
 * Overrides allow correcting incorrect terminal/facility information from BIC API.
 */

import type { EntityManager } from '@mikro-orm/postgresql'
import { LocationOverride, type FacilityLocation, type FacilityCodeListProvider } from '../data/entities'

export interface LocationOverrideMatch {
  unlocode: string
  facilityCode: string
  facilityCodeListProvider: FacilityCodeListProvider
  carrierCode?: string | null
}

export interface LocationOverrideScope {
  organizationId: string
  tenantId: string
}

/**
 * Finds the most specific location override for a given facility.
 *
 * Priority order:
 * 1. Carrier-specific override (carrierCode matches)
 * 2. Global override (carrierCode is null)
 *
 * @returns The override to apply, or null if no override exists
 */
export async function findLocationOverride(
  em: EntityManager,
  match: LocationOverrideMatch,
  scope: LocationOverrideScope
): Promise<LocationOverride | null> {
  if (!match.unlocode || !match.facilityCode || !match.facilityCodeListProvider) {
    return null
  }

  // Build query conditions - carrier-specific first, then global
  const conditions: Record<string, unknown> = {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    unlocode: match.unlocode.toUpperCase(),
    facilityCode: match.facilityCode,
    facilityCodeListProvider: match.facilityCodeListProvider,
    isActive: true,
    deletedAt: null,
  }

  // First try carrier-specific override (normalize to uppercase)
  if (match.carrierCode) {
    const carrierSpecific = await em.findOne(LocationOverride, {
      ...conditions,
      carrierCode: match.carrierCode.toUpperCase(),
    })
    if (carrierSpecific) {
      return carrierSpecific
    }
  }

  // Fall back to global override (carrierCode is null)
  const globalOverride = await em.findOne(LocationOverride, {
    ...conditions,
    carrierCode: null,
  })

  return globalOverride
}

/**
 * Applies override data to a FacilityLocation.
 * Only non-null fields from the override are applied.
 * Sets source to 'manual' to indicate the data was manually overridden.
 */
export function applyLocationOverride(
  location: FacilityLocation,
  overrideData: Partial<FacilityLocation>
): FacilityLocation {
  const result: FacilityLocation = { ...location }

  // Apply each override field if it's defined and not null
  if (overrideData.name != null) {
    result.name = overrideData.name
  }
  if (overrideData.address !== undefined) {
    result.address = overrideData.address
  }
  if (overrideData.operatorName !== undefined) {
    result.operatorName = overrideData.operatorName
  }
  if (overrideData.countryCode !== undefined) {
    result.countryCode = overrideData.countryCode
  }
  if (overrideData.facilityTypeCode !== undefined) {
    result.facilityTypeCode = overrideData.facilityTypeCode
  }
  if (overrideData.coords !== undefined) {
    result.coords = overrideData.coords
  }
  // Can also override unlocode/facilityCode if needed (rare)
  if (overrideData.unlocode !== undefined) {
    result.unlocode = overrideData.unlocode
  }
  if (overrideData.facilityCode !== undefined) {
    result.facilityCode = overrideData.facilityCode
  }
  if (overrideData.facilityCodeListProvider !== undefined) {
    result.facilityCodeListProvider = overrideData.facilityCodeListProvider
  }

  // Mark as manually overridden
  result.source = 'manual'

  return result
}

/**
 * Finds and applies location override to a FacilityLocation in one step.
 * Returns the original location if no override exists.
 */
export async function applyLocationOverrideIfExists(
  em: EntityManager,
  location: FacilityLocation | null | undefined,
  carrierCode: string | null | undefined,
  scope: LocationOverrideScope
): Promise<FacilityLocation | null> {
  if (!location) {
    return null
  }

  // Skip if location doesn't have required match fields
  if (!location.unlocode || !location.facilityCode || !location.facilityCodeListProvider) {
    return location
  }

  const override = await findLocationOverride(em, {
    unlocode: location.unlocode,
    facilityCode: location.facilityCode,
    facilityCodeListProvider: location.facilityCodeListProvider,
    carrierCode,
  }, scope)

  if (override) {
    return applyLocationOverride(location, override.overrideData)
  }

  return location
}
