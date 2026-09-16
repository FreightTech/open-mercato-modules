# @freighttech/terminal-tracking

Container-terminal tracking for the FreightTech FMS. Polls container terminal
APIs (Navis **N4** family; Baltic Hub / BCT Gdańsk first), normalizes the
results into events, and emits them — with per-terminal runtime configuration,
periodic polling, and terminal matching.

## Features

- **Per-terminal config** (`TerminalConfig`) — base URL, OAuth, encrypted
  credentials, rate limits, and matching identifiers (UN/LOCODE, BIC, SMDG,
  name aliases). One row per tenant per terminal. Optional `proxyUrl` routes
  that terminal's API calls through an HTTP forward proxy (to egress from a
  whitelisted IP); empty = direct.
- **Config-driven N4 adapter** — a single `N4TerminalAdapter` serves all N4
  terminals; endpoint paths default from the adapter. Auth via Azure B2C ROPC
  (password grant) or client-credentials.
- **GCT adapter** (`adapterType: 'gct'`) — Gdynia Container Terminal's bespoke
  FastAPI. Path-minted token replayed in the `Authorization` header; a container
  *snapshot* mapped to gate-in (`GTIN`) / departed (`DEPA`) milestones.
- **BCT adapter** (`adapterType: 'bct'`) — Bałtycki Terminal Kontenerowy (Gdynia)
  via the **INCOS** platform (`https://incos.pl`). Plain HTTP **Basic** auth
  (`authType: 'basic'`, `auth_config: { username, password }`). Read-only Phase 1:
  the `GET /rest-container/container/{nbr}` snapshot is mapped to the container's
  **current** milestone (mirroring N4's `/unit` current-state row). The arrival is
  refined by `in_yard_type` to match N4's vocabulary: a vessel arrival is a
  discharge (`in_yard_date` → `DISC` / `equipment.discharged`), a truck/rail
  arrival is a gate-in (→ `GTIN` / `equipment.gate_in`); once the box leaves,
  `out_yard_date` → `DEPA`. Emitting only the current milestone (not both arrival
  and departure every poll) lets a departed job reach `completed` and drop from
  the poll set — otherwise `isFullyDeparted` never trips and the box is polled
  forever, burning the daily budget. Each event carries an explicit import/export
  direction (`category`) and a real mode of transport (`in/out_yard_type`: T/V/R →
  TRUCK/VESSEL/RAIL). **Holds:** INCOS flags customs status binarily, so a
  customs `HOLD` is mapped by direction to the shared `lib/holds` catalogue code
  (`CUSTOMS IMPORT HOLD` / `CUSTOMS EXPORT HOLD` — both `critical`) instead of an
  unclassified raw string; the `;`-separated `constraint` codes (e.g. `STOPUC`)
  pass through and stay unclassified until INCOS documents them. This is coarser
  than N4 (which distinguishes ~20 impediment codes incl. permission-vs-hold),
  but flows through the same `impediments[]` field, availability logic, and hold
  badges.
  **Data parity with N4:** TimeIn (`in_yard_date`), TimeOut (`out_yard_date`),
  seals (`seal1..4`), holds (`customs_status`+`constraint`), and VGM are all
  present. The one gap is a separate **Loaded** timestamp — the INCOS container
  lookup has no dedicated load-onto-transport time (N4's "Loaded" column), so no
  `LOAD` event / `loadedAt` is emitted (it lives only in the rail endpoint).
  **Vessel ETA/ATA (Phase 2, done):** INCOS keys a visit by (vessel, voyage), so
  the mapping packs both into the visit ref (`CODE/VOY`) and `fetchVesselVisit`
  resolves it via `GET /rest-vesselvisit/vesselvisit/{code}/{voyage}` (dates there
  are `YYYY-MM-DD HH:MM:SS`, unlike the container endpoint). Enable it by setting
  `endpoints.vessel: /rest-vesselvisit/vesselvisit` on the config; the shared
  `TerminalVesselVisit` TTL cache then serves ETA/ETD/ATA/ATD per leg. Still
  deferred: the **rail** endpoints (and the Loaded time they carry). The dedup key
  is the container number (the lookup carries no per-visit gkey).
  **Rate limit:** INCOS caps BCT at **10 000 requests/day**. Set the config's
  `rateLimitRequests: 10000` + `rateLimitWindowSeconds: 86400` (the token bucket
  refills the full allowance over the window) — the entity defaults (200/60 s)
  do not model a daily cap. Because BCT has no batch endpoint, **each container
  poll costs one request**, so the daily budget bounds `containers × polls/day`
  (e.g. 100 containers every 15 min ≈ 9 600/day — near the ceiling).
  **⚠ TLS deployment prerequisite:** `incos.pl` serves an **incomplete
  certificate chain** — only the leaf, omitting its intermediate
  (`RapidSSL TLS RSA CA G1`, issued by the already-trusted DigiCert Global Root
  G2). Browsers (and Bruno) fetch the missing intermediate via AIA, but
  **Node/undici does not**, so the adapter fails with `fetch failed`
  (TLS "unable to get local issuer certificate") unless the intermediate is
  supplied via `NODE_EXTRA_CA_CERTS`. **This is already handled in production:**
  `apps/web/Dockerfile` fetches `RapidSSL TLS RSA CA G1` (and the GeoTrust
  intermediate for the Raiffeisen API) fresh at build time and bundles them into
  `/app/certs/extra-ca-bundle.pem`. For local dev outside Docker, build the same
  bundle yourself (see `apps/web/.env.example`). Verified live: with the
  intermediate present the adapter validates the chain and polls containers. The
  durable fix is for BCT/INCOS to serve the full chain.
- **Module-owned jobs** (`TerminalTrackingJob`) — track a container at a
  terminal; poll on a configurable schedule (`@open-mercato/scheduler`) or on
  demand. The scheduler **batches** due jobs per terminal into a single
  comma-separated `/unit` request (up to 100 containers) to minimise API calls.
  A job whose every current leg has **departed** moves to a terminal
  `completed` status (dropped from the poll set); `/VESSEL` is also skipped for
  departed legs (their visit is historic). A container that returns later is
  tracked as a **new** job with clean history.
- **Vessel visits** (`TerminalVesselVisit`) — resolves the leg's vessel via
  `/VESSEL` (Import → I/B visit, Export → O/B visit) and stores ETA/ETD/ATA/ATD,
  phase, voyages, and the receive/cutoff window. The table doubles as a
  TTL cache (default 1h, per-config override) so containers sharing a vessel
  cost one lookup. Exposed at `GET /api/terminal_tracking/vessel-visits` and
  shown per leg in the container details drawer.
- **Events** — emits `terminal_tracking.terminal_event.created` (and
  `…​.updated` when an existing event's container or vessel data changes on a
  re-poll) plus semantic `equipment.*` / `transport.*` events. Dedup keyed on
  `{terminalCode}:{Ufv_Gkey}:{eventCode}` so multiple Unit Facility Visits
  (import/export legs) per container stay distinct. The payload carries the
  nested `vesselVisit` (ETA/ATA/…) when resolved.
- **Terminal matching** — `TerminalMatcherService` resolves a facility to a
  configured terminal by exact BIC / SMDG / UN/LOCODE, or fuzzy name (fuse.js).
- **Admin UI** — Settings → Terminal Tracking: Terminals (CRUD + Test
  connection) and Tracked Containers (with a container details drawer showing
  milestones, holds, and vessel ETA/ATA).

## Module id

`terminal_tracking` — enable in the host app's `src/modules.ts`:

```ts
{ id: 'terminal_tracking', from: '@freighttech/terminal-tracking' }
```

## Timeline bridge

A subscriber in `@freighttech/shipment-tracking` consumes
`terminal_tracking.terminal_event.created` and surfaces terminal events on the
existing shipment Journey Timeline as `source:'port'` events (event-string
coupling only — no cross-module imports).

## Notes

- IP-whitelisted terminals must be reached from a whitelisted egress IP
  (deployment prerequisite; for local dev, route through a SOCKS tunnel).
- The OAuth token endpoint is public and stays direct.

See the spec: `.ai/specs/2026-06-08-n4-terminal-tracking-adapter.md`.
