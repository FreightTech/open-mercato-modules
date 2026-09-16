/**
 * Response shapes for the GCT (Gdynia Container Terminal) API. GCT is a bespoke
 * FastAPI JSON service (paths under `/gctapi/*`) — unrelated to Navis N4. Only
 * the fields Phase 1 (read-only tracking) consumes are typed here; the full
 * `Container` payload is preserved verbatim into `rawData`.
 *
 * Source: GCT DEV API OpenAPI 1.1.0 + Karta_kontenera_API.pdf.
 */

/** `GET /gctapi/Auth/{company}/{login}/{password}` → token envelope. */
export type GctToken = {
  token: string
  token_type: string
  /** ISO-8601 instant the token is valid until. */
  expires: string
}

/**
 * One container as returned by `POST /gctapi/GetContainerDetails`. Every field
 * is optional in practice; GCT omits what it has no value for. `CntrID` is the
 * only guaranteed member.
 */
export type GctContainer = {
  CntrID: string
  /** Per-visit terminal key — the dedup anchor (→ `ufvGkey`). */
  VisitNo?: string | null
  /** Container status: XF/EM/XM/IF/XI (export/import, full/empty). */
  CntrStatus?: string | null
  CntrSize?: string | null
  CntrType?: string | null
  /** Grounding (gate-in) instant — the container's arrival on the terminal. */
  GroundingDateTime?: string | null
  /** Pickup (gate-out) instant — the container left the terminal. */
  PickupDateTime?: string | null
  /** Impediment ("stopki") codes currently on the container. */
  HoldCodesList?: string[] | null
  /** Seals verified at GCT. */
  SealList?: string[] | null
  VGMWeight?: number | null
  VesselName?: string | null
  /** Voyage per GCT numbering. */
  GCTVoyage?: string | null
  /** Voyage per the line's own numbering. */
  OwnerVoyage?: string | null
  DischargePort?: string | null
  FinalDestinationPort?: string | null
  LoadingPort?: string | null
  OriginPort?: string | null
  Location?: string | null
  // Remaining fields are preserved via the index signature into rawData.
  [key: string]: unknown
}

/** `POST /gctapi/GetContainerDetails` response body. */
export type GctContainerDetailsResponse = {
  Total?: number
  Containers?: GctContainer[]
}
