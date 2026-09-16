import { z } from 'zod'

const uuid = () => z.string().uuid()

const scopedSchema = z.object({
  organizationId: uuid(),
  tenantId: uuid(),
})

// ─── Timestamp Schemas ───────────────────────────────────────

export const timestampSourceSchema = z.enum(['carrier_api', 'manual', 'ais', 'port', 'edi'])
export type TimestampSourceInput = z.infer<typeof timestampSourceSchema>

export const shipmentTimestampEntrySchema = z.object({
  value: z.string().datetime({ message: 'Must be ISO 8601 datetime' }),
  offset: z.string().regex(/^[+-]\d{2}:\d{2}$|^Z$/, 'Must be timezone offset like +08:00 or Z').nullable(),
  source: timestampSourceSchema,
  updatedAt: z.string().datetime({ message: 'Must be ISO 8601 datetime' }),
  sourceEventId: z.string().nullable().optional(),
})
export type ShipmentTimestampEntryInput = z.infer<typeof shipmentTimestampEntrySchema>

export const timestampEntryInputSchema = z.object({
  value: z.string().datetime({ message: 'Must be ISO 8601 datetime' }),
  offset: z.string().regex(/^[+-]\d{2}:\d{2}$|^Z$/, 'Must be timezone offset like +08:00 or Z').nullable().optional(),
  source: timestampSourceSchema,
  sourceEventId: z.string().nullable().optional(),
})
export type TimestampEntryInput = z.infer<typeof timestampEntryInputSchema>

// UN/LOCODE format: 2 uppercase letters (country) + 3 alphanumeric characters (location)
// Example: PLGDY (Poland, Gdynia), CRMOB (Costa Rica, Moín), BEANR (Belgium, Antwerp)
export const unLocodeSchema = z.string()
  .trim()
  .toUpperCase()
  .length(5, 'UN/LOCODE must be exactly 5 characters')
  .regex(/^[A-Z]{2}[A-Z0-9]{3}$/, 'Invalid UN/LOCODE format (expected: 2 letters + 3 alphanumeric)')

// Optional UN/LOCODE - will be auto-inferred from tracking events if not provided
export const optionalUnLocodeSchema = unLocodeSchema.optional()

// ─── Enums ───────────────────────────────────────────────────

export const shipmentStatusSchema = z.enum(['PENDING', 'BOOKED', 'DEPARTED', 'IN_TRANSIT', 'PRE_ARRIVAL', 'ARRIVED', 'DELIVERED'])
export type ShipmentStatus = z.infer<typeof shipmentStatusSchema>

export const trackingEventSourceSchema = z.enum(['dcsa', 'ais', 'port', 'edi', 'manual', 'shipsgo'])
export type TrackingEventSource = z.infer<typeof trackingEventSourceSchema>

export const trackingReferenceTypeSchema = z.enum(['container', 'booking', 'bol', 'awb'])
export type TrackingReferenceType = z.infer<typeof trackingReferenceTypeSchema>

export const trackingProviderSchema = z.enum(['carrier', 'shipsgo'])
export type TrackingProvider = z.infer<typeof trackingProviderSchema>

export const trackingModeSchema = z.enum(['ocean', 'air'])
export type TrackingMode = z.infer<typeof trackingModeSchema>

// ─── Facility Location (JSONB) ───────────────────────────────

export const facilityCodeListProviderSchema = z.enum(['BIC', 'SMDG'])
export type FacilityCodeListProvider = z.infer<typeof facilityCodeListProviderSchema>

export const facilityLocationSourceSchema = z.enum(['dcsa', 'bic', 'manual'])
export type FacilityLocationSource = z.infer<typeof facilityLocationSourceSchema>

export const coordsSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
})
export type Coords = z.infer<typeof coordsSchema>

/**
 * Rich location data for origin, destination, or transshipment points.
 * Combines port-level (UN/LOCODE) with facility-level (terminal) details.
 */
export const facilityLocationSchema = z.object({
  // Display name (terminal or port name)
  name: z.string(),

  // Port-level identifiers
  unlocode: z.string().nullable(),          // UN/LOCODE (e.g., "PLGDN")
  countryCode: z.string().nullable(),       // ISO 3166-1 alpha-2 (e.g., "PL")

  // Facility/terminal identifiers (separate fields)
  facilityCode: z.string().nullable(),      // SMDG/BIC code (e.g., "DCT")
  facilityCodeListProvider: facilityCodeListProviderSchema.nullable(),
  facilityTypeCode: z.string().nullable(),  // POTE (port terminal), DEPO (depot), etc.

  // Address (from DCSA otherFacility or BIC API)
  address: z.string().nullable(),           // Full address string

  // Coordinates
  coords: coordsSchema.nullable(),

  // Operator (from BIC API enrichment only)
  operatorName: z.string().nullable(),

  // Source of the data
  source: facilityLocationSourceSchema,
})
export type FacilityLocationInput = z.infer<typeof facilityLocationSchema>

// ─── Route & Event Entries (JSONB) ───────────────────────────

export const routeStopEntrySchema = z.object({
  location: z.string(),
  unlocode: z.string().nullable().optional(),
  type: z.enum(['origin', 'transshipment', 'destination']),
  vesselName: z.string().nullable().optional(),
  ata: z.string().nullable().optional(),  // Actual arrival
  atd: z.string().nullable().optional(),  // Actual departure
  eta: z.string().nullable().optional(),  // Estimated arrival (for delay calculation)
  etd: z.string().nullable().optional(),  // Estimated departure (for delay calculation)
  // Facility/terminal details
  facilityCode: z.string().nullable().optional(),
  facilityCodeListProvider: facilityCodeListProviderSchema.nullable().optional(),
  facilityTypeCode: z.string().nullable().optional(),
  facilityAddress: z.string().nullable().optional(),
  coords: coordsSchema.nullable().optional(),
})
export type RouteStopEntryInput = z.infer<typeof routeStopEntrySchema>

// Seal information (from DCSA events)
export const sealInfoSchema = z.object({
  number: z.string(),
  source: z.string().nullable().optional(),  // CAR, SHI, TER, CUS
  type: z.string().nullable().optional(),
})
export type SealInfoInput = z.infer<typeof sealInfoSchema>

export const cargoEventEntrySchema = z.object({
  id: z.string(),
  eventType: z.string(),
  eventCode: z.string(),
  eventClassifierCode: z.enum(['ACT', 'PLN', 'EST']).nullable().optional(),
  eventDateTime: z.string(),
  description: z.string().nullable().optional(),
  locationName: z.string().nullable().optional(),
  locationUnlocode: z.string().nullable().optional(),
  vesselName: z.string().nullable().optional(),
  vesselImo: z.string().nullable().optional(),
  voyageNumber: z.string().nullable().optional(),
  isTransshipmentMove: z.boolean().nullable().optional(),
  // Facility/terminal details
  facilityCode: z.string().nullable().optional(),
  facilityCodeListProvider: facilityCodeListProviderSchema.nullable().optional(),
  facilityTypeCode: z.string().nullable().optional(),
  facilityAddress: z.string().nullable().optional(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  // Seal information
  seals: z.array(sealInfoSchema).nullable().optional(),
})
export type CargoEventEntryInput = z.infer<typeof cargoEventEntrySchema>

// ─── Shipment ────────────────────────────────────────────────

export const shipmentCreateSchema = scopedSchema.extend({
  // Optional: link to existing tracking job
  trackingJobId: uuid().optional(),
  carrierCode: z.string().trim().max(20).optional(),
  containerNumber: z.string().trim().max(50).optional(),
  bookingNumber: z.string().trim().max(100).optional(),
  bolNumber: z.string().trim().max(100).optional(),
  // Multi-source timestamps (JSONB arrays)
  etdTimestamps: z.array(shipmentTimestampEntrySchema).optional(),
  etaTimestamps: z.array(shipmentTimestampEntrySchema).optional(),
  atdTimestamps: z.array(shipmentTimestampEntrySchema).optional(),
  ataTimestamps: z.array(shipmentTimestampEntrySchema).optional(),
  // Location data (JSONB)
  originLocation: facilityLocationSchema.optional(),
  destinationLocation: facilityLocationSchema.optional(),
  vesselName: z.string().trim().max(200).optional(),
  vesselImo: z.string().trim().max(20).optional(),
  voyageNumber: z.string().trim().max(50).optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
})

export const shipmentUpdateSchema = z.object({
  id: uuid(),
}).merge(
  scopedSchema.extend({
    trackingJobId: uuid().optional().nullable(),
    carrierCode: z.string().trim().max(20).optional().nullable(),
    containerNumber: z.string().trim().max(50).optional().nullable(),
    bookingNumber: z.string().trim().max(100).optional().nullable(),
    bolNumber: z.string().trim().max(100).optional().nullable(),
    status: shipmentStatusSchema.optional(),
    // Multi-source timestamps - can replace entire arrays or add entries
    etdTimestamps: z.array(shipmentTimestampEntrySchema).optional().nullable(),
    etaTimestamps: z.array(shipmentTimestampEntrySchema).optional().nullable(),
    atdTimestamps: z.array(shipmentTimestampEntrySchema).optional().nullable(),
    ataTimestamps: z.array(shipmentTimestampEntrySchema).optional().nullable(),
    // Add single timestamp entries (convenience for manual updates)
    addEtdTimestamp: timestampEntryInputSchema.optional(),
    addEtaTimestamp: timestampEntryInputSchema.optional(),
    addAtdTimestamp: timestampEntryInputSchema.optional(),
    addAtaTimestamp: timestampEntryInputSchema.optional(),
    // Location data (JSONB)
    originLocation: facilityLocationSchema.optional().nullable(),
    destinationLocation: facilityLocationSchema.optional().nullable(),
    vesselName: z.string().trim().max(200).optional().nullable(),
    vesselImo: z.string().trim().max(20).optional().nullable(),
    voyageNumber: z.string().trim().max(50).optional().nullable(),
    extra: z.record(z.string(), z.unknown()).optional().nullable(),
  }).partial(),
)

export const shipmentListSchema = z.object({
  id: z.string().uuid().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  search: z.string().optional(),
  status: z.string().optional(),
  carrierCode: z.string().optional(),
  sortField: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
}).passthrough()

export type ShipmentCreateInput = z.infer<typeof shipmentCreateSchema>
export type ShipmentUpdateInput = z.infer<typeof shipmentUpdateSchema>

// ─── TrackingJob ─────────────────────────────────────────────

export const trackingJobCreateSchema = scopedSchema.extend({
  carrierCode: z.string().trim().min(1).max(50),
  referenceType: trackingReferenceTypeSchema,
  referenceValue: z.string().trim().min(1).max(100),
  // Origin/destination are optional - will be auto-inferred from tracking events if not provided
  originUnlocode: optionalUnLocodeSchema,
  destinationUnlocode: optionalUnLocodeSchema,
  schedule: z.array(z.string()).optional(),
})

export const trackingJobUpdateSchema = z.object({
  id: uuid(),
}).merge(
  scopedSchema.extend({
    status: z.enum(['active', 'paused', 'deactivated', 'failed', 'completed']).optional(),
    schedule: z.array(z.string()).optional().nullable(),
    nextPollAt: z.coerce.date().optional().nullable(),
  }).partial(),
)

export const trackingJobListSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  status: z.string().optional(),
  carrierCode: z.string().optional(),
  referenceType: z.string().optional(),
  referenceValue: z.string().optional(),
  sortField: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
}).passthrough()

export type TrackingJobCreateInput = z.infer<typeof trackingJobCreateSchema>
export type TrackingJobUpdateInput = z.infer<typeof trackingJobUpdateSchema>

// ─── TrackingEvent ───────────────────────────────────────────

export const trackingEventListSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  trackingJobId: uuid().optional(),
  equipmentReference: z.string().optional(),
  source: trackingEventSourceSchema.optional(),
  eventType: z.string().optional(),
  eventCode: z.string().optional(),
  sortField: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
}).passthrough()

/** @deprecated Use trackingEventListSchema instead */
export const cargoEventListSchema = trackingEventListSchema

// ─── CarrierConfig ───────────────────────────────────────────

export const carrierConfigCreateSchema = scopedSchema.extend({
  carrierCode: z.string().trim().min(1).max(50),
  apiEndpoint: z.string().trim().url().max(500).optional(),
  authConfig: z.record(z.string(), z.unknown()).optional(),
  rateLimitRequests: z.coerce.number().int().min(1).max(10000).default(60),
  rateLimitWindowSeconds: z.coerce.number().int().min(1).max(86400).default(60),
  isActive: z.boolean().default(true),
})

export const carrierConfigUpdateSchema = z.object({
  id: uuid(),
}).merge(
  scopedSchema.extend({
    apiEndpoint: z.string().trim().url().max(500).optional().nullable(),
    authConfig: z.record(z.string(), z.unknown()).optional().nullable(),
    rateLimitRequests: z.coerce.number().int().min(1).max(10000).optional(),
    rateLimitWindowSeconds: z.coerce.number().int().min(1).max(86400).optional(),
    isActive: z.boolean().optional(),
  }).partial(),
)

export const carrierConfigListSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  carrierCode: z.string().optional(),
  isActive: z.string().optional(),
  sortField: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
}).passthrough()

export type CarrierConfigCreateInput = z.infer<typeof carrierConfigCreateSchema>
export type CarrierConfigUpdateInput = z.infer<typeof carrierConfigUpdateSchema>

// ─── BicConfig ───────────────────────────────────────────────

export const bicConfigUpsertSchema = scopedSchema.extend({
  isEnabled: z.boolean().default(false),
  username: z.string().trim().min(1, 'Username is required').max(200),
  password: z.string().trim().min(1, 'Password is required').max(500),
  baseUrl: z.string().trim().url().max(500).default('https://api.bic-code.org'),
})

export const bicConfigResponseSchema = z.object({
  id: uuid(),
  organizationId: uuid(),
  tenantId: uuid(),
  isEnabled: z.boolean(),
  username: z.string(),
  // Password is NOT included in response for security
  baseUrl: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const bicConfigTestSchema = scopedSchema.extend({
  username: z.string().trim().min(1),
  password: z.string().trim().min(1),
  baseUrl: z.string().trim().url().default('https://api.bic-code.org'),
})

export type BicConfigUpsertInput = z.infer<typeof bicConfigUpsertSchema>
export type BicConfigResponse = z.infer<typeof bicConfigResponseSchema>
export type BicConfigTestInput = z.infer<typeof bicConfigTestSchema>

// ─── ShipsGoConfig ───────────────────────────────────────────
// One row per organization/tenant. Upsert semantics (like BicConfig). The API
// token is write-only in responses; on update the sentinel '__UNCHANGED__'
// leaves the stored token intact.

export const shipsGoConfigUpsertSchema = scopedSchema.extend({
  isEnabled: z.boolean().default(false),
  apiToken: z.string().trim().min(1, 'API token is required').max(500),
  baseUrl: z.string().trim().url().max(500).default('https://api.shipsgo.com/v2'),
  oceanEnabled: z.boolean().default(true),
  airEnabled: z.boolean().default(true),
  rateLimitRequests: z.coerce.number().int().min(1).max(10000).default(60),
  rateLimitWindowSeconds: z.coerce.number().int().min(1).max(86400).default(60),
})

export const shipsGoConfigResponseSchema = z.object({
  id: uuid(),
  organizationId: uuid(),
  tenantId: uuid(),
  isEnabled: z.boolean(),
  // apiToken is NOT included in responses for security
  baseUrl: z.string(),
  oceanEnabled: z.boolean(),
  airEnabled: z.boolean(),
  rateLimitRequests: z.number(),
  rateLimitWindowSeconds: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type ShipsGoConfigUpsertInput = z.infer<typeof shipsGoConfigUpsertSchema>
export type ShipsGoConfigResponse = z.infer<typeof shipsGoConfigResponseSchema>

// ─── Webhook ─────────────────────────────────────────────────

export const webhookCreateSchema = scopedSchema.extend({
  url: z.string().trim().url().max(500),
  eventsSubscribed: z.array(z.string().trim().min(1)).min(1),
  hmacSecret: z.string().trim().max(256).optional(),
  isActive: z.boolean().default(true),
})

export const webhookUpdateSchema = z.object({
  id: uuid(),
}).merge(
  scopedSchema.extend({
    url: z.string().trim().url().max(500).optional(),
    eventsSubscribed: z.array(z.string().trim().min(1)).min(1).optional(),
    hmacSecret: z.string().trim().max(256).optional().nullable(),
    isActive: z.boolean().optional(),
  }).partial(),
)

export const webhookListSchema = z.object({
  id: z.string().uuid().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  isActive: z.string().optional(),
  sortField: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
}).passthrough()

export type WebhookCreateInput = z.infer<typeof webhookCreateSchema>
export type WebhookUpdateInput = z.infer<typeof webhookUpdateSchema>

// ─── WebhookDelivery ─────────────────────────────────────────

export const webhookDeliveryListSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  webhookId: uuid().optional(),
  status: z.string().optional(),
  eventType: z.string().optional(),
  sortField: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
}).passthrough()

// ─── LocationOverride ────────────────────────────────────────

export const locationOverrideDataSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  address: z.string().trim().max(500).nullable().optional(),
  operatorName: z.string().trim().max(200).nullable().optional(),
  countryCode: z.string().trim().length(2, 'Country code must be 2 characters').toUpperCase().nullable().optional(),
  facilityTypeCode: z.string().trim().max(20).nullable().optional(),
  coords: coordsSchema.nullable().optional(),
})
export type LocationOverrideData = z.infer<typeof locationOverrideDataSchema>

export const locationOverrideCreateSchema = scopedSchema.extend({
  carrierCode: z.string().trim().max(20).nullable().optional(),
  unlocode: unLocodeSchema,
  facilityCode: z.string().trim().min(1, 'Facility code is required').max(50),
  facilityCodeListProvider: facilityCodeListProviderSchema,
  overrideData: locationOverrideDataSchema,
  description: z.string().trim().max(500).nullable().optional(),
  isActive: z.boolean().default(true),
})

export const locationOverrideUpdateSchema = z.object({
  id: uuid(),
}).merge(
  scopedSchema.extend({
    carrierCode: z.string().trim().max(20).nullable().optional(),
    unlocode: unLocodeSchema.optional(),
    facilityCode: z.string().trim().min(1).max(50).optional(),
    facilityCodeListProvider: facilityCodeListProviderSchema.optional(),
    overrideData: locationOverrideDataSchema.optional(),
    description: z.string().trim().max(500).nullable().optional(),
    isActive: z.boolean().optional(),
  }).partial(),
)

export const locationOverrideListSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  carrierCode: z.string().optional(),
  unlocode: z.string().optional(),
  facilityCode: z.string().optional(),
  isActive: z.string().optional(),
  search: z.string().optional(),
  sortField: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
}).passthrough()

export type LocationOverrideCreateInput = z.infer<typeof locationOverrideCreateSchema>
export type LocationOverrideUpdateInput = z.infer<typeof locationOverrideUpdateSchema>

// ─── Ships Map Dashboard Widget ──────────────────────────────

/** Optional scope filter for the ships-map aggregation route. */
export const shipsMapQuerySchema = z.object({
  scope: z.enum(['in_transit', 'at_port', 'all']).optional().default('all'),
})
export type ShipsMapQueryInput = z.infer<typeof shipsMapQuerySchema>

/** A single shipment grouped under a map marker. */
export const shipsMapShipmentSchema = z.object({
  id: z.string(),
  containerNumber: z.string().nullable(),
  status: z.string(),
  eta: z.string().nullable(),
  destinationLocation: z.string().nullable(),
})

/**
 * Map marker discriminated by `kind`:
 * - `vessel`: a live AIS position for a vessel actually carrying in-transit cargo.
 * - `port`: a port where at-rest cargo is waiting (the planned onward vessel's AIS is unrelated).
 */
export const shipsMapMarkerSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('vessel'),
    imo: z.string(),
    name: z.string().nullable(),
    position: z.object({ lat: z.number(), lng: z.number() }),
    heading: z.number().nullable(),
    destination: z.string().nullable(),
    updatedAt: z.string().nullable(),
    shipments: z.array(shipsMapShipmentSchema),
  }),
  z.object({
    kind: z.literal('port'),
    portName: z.string().nullable(),
    unlocode: z.string().nullable(),
    position: z.object({ lat: z.number(), lng: z.number() }),
    shipments: z.array(shipsMapShipmentSchema),
  }),
])

export const shipsMapResponseSchema = z.object({
  markers: z.array(shipsMapMarkerSchema),
  /** Active shipments with no plottable position (no IMO/coords, or a vessel-api miss). */
  unresolvedCount: z.number(),
  generatedAt: z.string(),
})

export type ShipsMapShipment = z.infer<typeof shipsMapShipmentSchema>
export type ShipsMapMarker = z.infer<typeof shipsMapMarkerSchema>
export type ShipsMapResponse = z.infer<typeof shipsMapResponseSchema>
