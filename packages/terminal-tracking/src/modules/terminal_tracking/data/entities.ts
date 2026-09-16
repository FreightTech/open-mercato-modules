import { Collection, OptionalProps } from '@mikro-orm/core'
import { Entity, PrimaryKey, Property, Index, Unique, ManyToOne, OneToMany } from '@mikro-orm/decorators/legacy'

// ─── Enums / shared types ────────────────────────────────────
// Re-declared locally on purpose: terminal_tracking must NOT depend on
// shipment_tracking internals. The cross-module contract is the event payload.

export type TerminalEventType = 'EQUIPMENT' | 'TRANSPORT'
export type TerminalEventClassifierCode = 'ACT' | 'PLN' | 'EST'
export type TerminalEventSource = 'terminal'
export type FacilityCodeProvider = 'SMDG' | 'BIC'
export type TerminalModeOfTransport = 'VESSEL' | 'RAIL' | 'TRUCK' | 'BARGE'

export type TerminalAuthType = 'oauth2_password' | 'oauth2_client_credentials' | 'gct_token' | 'basic'

export type TerminalTrackingJobStatus = 'active' | 'paused' | 'deactivated' | 'failed' | 'completed'

export type TerminalEndpoints = {
  unit: string
  vessel?: string
  trainVisits?: string
}

export type TerminalSealInfo = {
  number: string
  type?: string | null
  source?: string | null
}

// ─── TerminalConfig ──────────────────────────────────────────
// Per (org, tenant, terminalCode) terminal definition + tenant credentials.
// `auth_config` is encrypted at rest (see encryption.ts). `client_id`,
// `token_url`, `scope` are NOT secrets and stay as plain columns.

@Entity({ tableName: 'terminal_tracking_terminal_configs' })
@Index({ name: 'tt_terminal_configs_org_tenant_idx', properties: ['organizationId', 'tenantId'] })
@Unique({ name: 'tt_terminal_configs_code_uniq', properties: ['organizationId', 'tenantId', 'terminalCode'] })
export class TerminalConfig {
  [OptionalProps]?:
    | 'isActive'
    | 'createdAt'
    | 'updatedAt'
    | 'deletedAt'
    | 'rateLimitRequests'
    | 'rateLimitWindowSeconds'
    | 'vesselCacheTtlSeconds'
    | 'proxyUrl'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  // Lowercase terminal identifier, e.g. 'bct'
  @Property({ name: 'terminal_code', type: 'text' })
  terminalCode!: string

  // Selects the adapter implementation from the registry, e.g. 'n4'
  @Property({ name: 'adapter_type', type: 'text' })
  adapterType!: string

  @Property({ name: 'display_name', type: 'text' })
  displayName!: string

  @Property({ name: 'base_url', type: 'text' })
  baseUrl!: string

  // Optional HTTP(S) forward-proxy URL for this terminal's API calls (used to
  // egress from a whitelisted IP). Null = direct. No embedded credentials —
  // secure the proxy by IP allowlist.
  @Property({ name: 'proxy_url', type: 'text', nullable: true })
  proxyUrl?: string | null

  @Property({ name: 'endpoints', type: 'jsonb' })
  endpoints!: TerminalEndpoints

  @Property({ name: 'auth_type', type: 'text' })
  authType!: TerminalAuthType

  // OAuth token endpoint (may include a policy query param, e.g. ?p=b2c_1_ropc_login)
  @Property({ name: 'token_url', type: 'text', nullable: true })
  tokenUrl?: string | null

  @Property({ name: 'scope', type: 'text', nullable: true })
  scope?: string | null

  // Public OAuth client id (NOT a secret)
  @Property({ name: 'client_id', type: 'text', nullable: true })
  clientId?: string | null

  // Encrypted at rest: { username, password } (ROPC) or { clientSecret }
  @Property({ name: 'auth_config', type: 'jsonb', nullable: true })
  authConfig?: Record<string, unknown> | null

  @Property({ name: 'rate_limit_requests', type: 'integer', default: 200 })
  rateLimitRequests: number = 200

  @Property({ name: 'rate_limit_window_seconds', type: 'integer', default: 60 })
  rateLimitWindowSeconds: number = 60

  // TTL (seconds) for the cached /VESSEL visit lookup; null = module default.
  @Property({ name: 'vessel_cache_ttl_seconds', type: 'integer', nullable: true })
  vesselCacheTtlSeconds?: number | null

  // ─── Matching fields (resolve a facility -> this terminal) ────
  @Property({ name: 'unlocode', type: 'text', length: 5, nullable: true })
  unlocode?: string | null

  @Property({ name: 'bic_codes', type: 'jsonb', nullable: true })
  bicCodes?: string[] | null

  @Property({ name: 'smdg_codes', type: 'jsonb', nullable: true })
  smdgCodes?: string[] | null

  @Property({ name: 'name_aliases', type: 'jsonb', nullable: true })
  nameAliases?: string[] | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, defaultRaw: 'now()' })
  createdAt!: Date

  @Property({ name: 'updated_at', type: Date, defaultRaw: 'now()', onUpdate: () => new Date() })
  updatedAt!: Date

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

// ─── TerminalTrackingJob ─────────────────────────────────────
// A module-owned watchlist unit: a container number tracked at one terminal.

@Entity({ tableName: 'terminal_tracking_jobs' })
@Index({ name: 'tt_jobs_org_tenant_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'tt_jobs_status_idx', properties: ['status'] })
@Index({ name: 'tt_jobs_next_poll_idx', properties: ['nextPollAt'] })
@Index({ name: 'tt_jobs_container_idx', properties: ['containerNumber'] })
export class TerminalTrackingJob {
  [OptionalProps]?:
    | 'createdAt'
    | 'updatedAt'
    | 'deletedAt'
    | 'status'
    | 'retryCount'
    | 'emptyReadyAt'
    | 'holdsClearedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'terminal_code', type: 'text' })
  terminalCode!: string

  @Property({ name: 'container_number', type: 'text' })
  containerNumber!: string

  @Property({ type: 'text', default: 'active' })
  status: TerminalTrackingJobStatus = 'active'

  // JSON array of scheduled poll dates (ISO); null = follow the module default cadence
  @Property({ type: 'jsonb', nullable: true })
  schedule?: string[] | null

  @Property({ name: 'next_poll_at', type: Date, nullable: true })
  nextPollAt?: Date | null

  @Property({ name: 'last_poll_at', type: Date, nullable: true })
  lastPollAt?: Date | null

  @Property({ name: 'retry_count', type: 'integer', default: 0 })
  retryCount: number = 0

  @Property({ name: 'error_history', type: 'jsonb', nullable: true })
  errorHistory?: Array<{ date: string; message: string }> | null

  // One-shot availability markers. Set the first time this container satisfies
  // the availability rule at the terminal, so the corresponding notification
  // fires exactly once. `empty_ready` = export empty collectable;
  // `holds_cleared` = import container's blocking holds removed.
  @Property({ name: 'empty_ready_at', type: Date, nullable: true })
  emptyReadyAt?: Date | null

  @Property({ name: 'holds_cleared_at', type: Date, nullable: true })
  holdsClearedAt?: Date | null

  @Property({ name: 'created_at', type: Date, defaultRaw: 'now()' })
  createdAt!: Date

  @Property({ name: 'updated_at', type: Date, defaultRaw: 'now()', onUpdate: () => new Date() })
  updatedAt!: Date

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null

  @OneToMany(() => TerminalEvent, (e) => e.job)
  events = new Collection<TerminalEvent>(this)
}

// ─── TerminalEvent ───────────────────────────────────────────
// A normalized terminal event. `source_event_id` embeds the N4 Ufv_Gkey so
// that multiple Unit Facility Visits per container (import + export legs)
// remain distinct under the unique constraint.

@Entity({ tableName: 'terminal_tracking_events' })
@Index({ name: 'tt_events_org_tenant_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'tt_events_job_idx', properties: ['job'] })
@Index({ name: 'tt_events_container_idx', properties: ['containerNumber'] })
@Index({ name: 'tt_events_event_date_idx', properties: ['eventDateTime'] })
@Unique({ name: 'tt_events_source_event_uniq', properties: ['job', 'source', 'sourceEventId'] })
export class TerminalEvent {
  [OptionalProps]?: 'createdAt' | 'source'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @ManyToOne(() => TerminalTrackingJob, { fieldName: 'job_id' })
  job!: TerminalTrackingJob

  @Property({ type: 'text', default: 'terminal' })
  source: TerminalEventSource = 'terminal'

  // '{terminalCode}:{ufvGkey}:{eventCode}'
  @Property({ name: 'source_event_id', type: 'text' })
  sourceEventId!: string

  @Property({ name: 'event_type', type: 'text' })
  eventType!: TerminalEventType

  @Property({ name: 'event_code', type: 'text' })
  eventCode!: string

  @Property({ name: 'event_classifier_code', type: 'text', nullable: true })
  eventClassifierCode?: TerminalEventClassifierCode | null

  @Property({ name: 'event_date_time', type: Date })
  eventDateTime!: Date

  @Property({ name: 'container_number', type: 'text' })
  containerNumber!: string

  @Property({ name: 'ufv_gkey', type: 'text' })
  ufvGkey!: string

  @Property({ name: 'transit_state', type: 'text', nullable: true })
  transitState?: string | null

  @Property({ name: 'visit_state', type: 'text', nullable: true })
  visitState?: string | null

  // ─── Location ─────────────────────────────────────────────
  @Property({ name: 'facility_code', type: 'text', nullable: true })
  facilityCode?: string | null

  @Property({ name: 'facility_code_list_provider', type: 'text', nullable: true })
  facilityCodeListProvider?: FacilityCodeProvider | null

  @Property({ name: 'unlocode', type: 'text', length: 5, nullable: true })
  unlocode?: string | null

  // ─── Visit references (for vessel/train enrichment) ───────
  @Property({ name: 'visit_ref_in', type: 'text', nullable: true })
  visitRefIn?: string | null

  @Property({ name: 'visit_ref_out', type: 'text', nullable: true })
  visitRefOut?: string | null

  // ─── Transport ────────────────────────────────────────────
  @Property({ name: 'vessel_name', type: 'text', nullable: true })
  vesselName?: string | null

  @Property({ name: 'voyage_number', type: 'text', nullable: true })
  voyageNumber?: string | null

  @Property({ name: 'mode_of_transport', type: 'text', nullable: true })
  modeOfTransport?: TerminalModeOfTransport | null

  // ─── Cargo extras ─────────────────────────────────────────
  @Property({ name: 'seals', type: 'jsonb', nullable: true })
  seals?: TerminalSealInfo[] | null

  @Property({ name: 'vgm_weight_kg', type: 'float', nullable: true })
  vgmWeightKg?: number | null

  @Property({ name: 'impediments', type: 'jsonb', nullable: true })
  impediments?: string[] | null

  // When the container was loaded onto its transport (N4 `Loaded` column),
  // parsed regardless of current transit state. Export = onto vessel; import =
  // onto road/rail.
  @Property({ name: 'loaded_at', type: Date, nullable: true })
  loadedAt?: Date | null

  @Property({ name: 'raw_data', type: 'jsonb', nullable: true })
  rawData?: Record<string, unknown> | null

  @Property({ name: 'created_at', type: Date, defaultRaw: 'now()' })
  createdAt!: Date
}

// ─── TerminalVesselVisit ─────────────────────────────────────
// A resolved N4 vessel visit (from /VESSEL), keyed by visit ref and shared by
// every container on that visit. Doubles as a TTL cache: `updatedAt` is the
// freshness signal. Upsert-only (no soft delete); no FK to job.

@Entity({ tableName: 'terminal_tracking_vessel_visits' })
@Index({ name: 'tt_vessel_visits_org_tenant_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'tt_vessel_visits_visit_ref_idx', properties: ['visitRef'] })
@Unique({ name: 'tt_vessel_visits_uniq', properties: ['organizationId', 'tenantId', 'terminalCode', 'visitRef'] })
export class TerminalVesselVisit {
  [OptionalProps]?: 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'terminal_code', type: 'text' })
  terminalCode!: string

  // The N4 visit ref (the `Visit` column); equals an event's visitRefIn/Out.
  @Property({ name: 'visit_ref', type: 'text' })
  visitRef!: string

  @Property({ name: 'vessel_name', type: 'text', nullable: true })
  vesselName?: string | null

  @Property({ name: 'ib_voyage', type: 'text', nullable: true })
  ibVoyage?: string | null

  @Property({ name: 'ob_voyage', type: 'text', nullable: true })
  obVoyage?: string | null

  @Property({ name: 'line', type: 'text', nullable: true })
  line?: string | null

  @Property({ name: 'phase', type: 'text', nullable: true })
  phase?: string | null

  @Property({ name: 'eta', type: Date, nullable: true })
  eta?: Date | null

  @Property({ name: 'etd', type: Date, nullable: true })
  etd?: Date | null

  @Property({ name: 'ata', type: Date, nullable: true })
  ata?: Date | null

  @Property({ name: 'atd', type: Date, nullable: true })
  atd?: Date | null

  @Property({ name: 'begin_receive', type: Date, nullable: true })
  beginReceive?: Date | null

  @Property({ name: 'dry_cutoff', type: Date, nullable: true })
  dryCutoff?: Date | null

  @Property({ name: 'raw_data', type: 'jsonb', nullable: true })
  rawData?: Record<string, unknown> | null

  @Property({ name: 'created_at', type: Date, defaultRaw: 'now()' })
  createdAt!: Date

  @Property({ name: 'updated_at', type: Date, defaultRaw: 'now()', onUpdate: () => new Date() })
  updatedAt!: Date
}
