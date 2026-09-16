/**
 * Response shapes for the INCOS API that fronts BCT (Bałtycki Terminal
 * Kontenerowy, Gdynia). INCOS is a plain REST/JSON platform on `https://incos.pl`
 * — unrelated to Navis N4 or the GCT FastAPI. Only the fields Phase 1
 * (read-only container tracking) consumes are typed here; the full container
 * payload is preserved verbatim into `rawData`.
 *
 * Source: "dokumentacja api INCOS" (BCT_INCOS_API_1, rev. 01.03.2021),
 * endpoint "Sprawdź kontener" — `GET /rest-container/container/{nbr}`.
 */

/**
 * One container as returned inside the `data` member of the container lookup.
 * INCOS emits every field, using `null` for what it has no value for. Dates are
 * `DD-MM-YYYY HH:MI` in terminal-local time (see `parseIncosDateTime`).
 */
export type IncosContainer = {
  /** Container number. */
  container_nbr?: string | null
  /** ISO type code, e.g. `22G1`. */
  container_iso_type?: string | null
  /**
   * Current location — free-form terminal text, inconsistent between the doc and
   * the live API: observed values include `Y` (yard) and `OFF DOCK` (the vendor
   * doc listed YARD/OFFDOCK/VESSEL/CFS). Stored verbatim into `transitState`;
   * nothing branches on it.
   */
  actual_location?: string | null
  /** Load status: E empty / F full. */
  status?: string | null
  /** Relation/category: E export / I,X import. */
  category?: string | null
  /** Shipping line code. */
  line_code?: string | null
  seal1?: string | null
  seal2?: string | null
  seal3?: string | null
  seal4?: string | null
  temp_min?: string | number | null
  temp_max?: string | number | null
  temp_set?: string | number | null
  /** EU status Y/N. */
  eu_status?: string | null
  /** Customs hold: empty, or `HOLD` when a customs hold is set. */
  customs_status?: string | null
  /** Other constraints, a `;`-separated list (e.g. `STOPUC`). */
  constraint?: string | null
  /** IMO classes, `;`-separated. */
  imo_class?: string | null
  /** UN codes, `;`-separated (aligned to the imo_class order). */
  un_code?: string | null
  vgm_weight?: number | null
  gross_weight?: number | null
  net_weight?: number | null
  /** Entry (gate-in / discharge) instant — `DD-MM-YYYY HH:MI`. */
  in_yard_date?: string | null
  /** How it entered: T truck / V vessel / R rail. */
  in_yard_type?: string | null
  /** Exit (gate-out / departure) instant — `DD-MM-YYYY HH:MI`. */
  out_yard_date?: string | null
  /** How it left: T truck / V vessel / R rail. */
  out_yard_type?: string | null
  vessel_code_in?: string | null
  vessel_name_in?: string | null
  vessel_visit_invoy?: string | null
  vessel_code_out?: string | null
  vessel_name_out?: string | null
  vessel_visit_outvoy?: string | null
  /** Whether a pre-advice already exists for the container in the terminal (Y/N). */
  prelodge?: string | null
  // Remaining fields are preserved via the index signature into rawData.
  [key: string]: unknown
}

/**
 * Vessel-visit data from `GET /rest-vesselvisit/vesselvisit/{code}/{voyage}`.
 * NOTE: the live API returns dates as `YYYY-MM-DD HH:MM:SS` (terminal-local, no
 * offset) — a DIFFERENT format from the container endpoint's `DD-MM-YYYY HH:MI`.
 */
export type IncosVesselVisit = {
  vessel_code?: string | null
  vessel_name?: string | null
  in_voy?: string | null
  out_voy?: string | null
  line_code?: string | null
  eta?: string | null
  etd?: string | null
  ata?: string | null
  atd?: string | null
  [key: string]: unknown
}

/** `GET /rest-vesselvisit/vesselvisit/{code}/{voyage}` response body. */
export type IncosVesselVisitResponse = {
  data?: IncosVesselVisit | null
  status?: string | null
}

/**
 * The INCOS envelope shared by reads and writes. For the container lookup,
 * `data` is a single container object (not an array); `status` is `SUCCESS` on
 * a hit and `ERROR` otherwise (the payload then carries an `error` block).
 */
export type IncosContainerResponse = {
  data?: IncosContainer | null
  status?: string | null
  error?: {
    type?: number | null
    message?: string | null
    fieldErrList?: string | null
    fieldName?: string | null
  } | null
}
