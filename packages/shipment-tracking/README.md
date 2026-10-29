# @freighttech/shipment-tracking

Carrier shipment tracking for the Open Mercato platform — DCSA carrier adapters
(Maersk, MSC, CMA CGM, Hapag-Lloyd, ZIM, COSCO, Evergreen), a
[Dockflow](#dockflow) adapter, a ShipsGo aggregator fallback, a Journey
Timeline, and an optional live vessel/POI map.

Most integration credentials are configured **in the UI** (Backend → Śledzenie
przesyłek → Autoryzacja śledzenia): per-carrier auth, the ShipsGo token, and the
BIC facility API. The settings below are **deployment/environment** config,
supplied as environment variables.

## Environment variables

### Vessel map (ships map / vessel trace / POI overlay)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NEXT_PUBLIC_VESSEL_API_URL` | For the vessel map only | _none_ | Base URL of the vessel-tracking API that powers `fetchVessel` / `fetchVesselTrace` / `fetchPois` (the ships-map widget, vessel trace, and POI overlay). It is a `NEXT_PUBLIC_*` value inlined into the client bundle at build time. When unset, those map features throw "Vessel API is not configured" and are effectively disabled; the rest of the module works normally. |

### POI proximity events (optional AIS → Journey Timeline crossings)

Consumed by the separate long-running worker
`mercato shipment_tracking poi:worker`, which subscribes to an AIS proximity
event stream over NATS JetStream. If you don't run that worker, none of these
are needed. Changes take effect when the worker (re)starts.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `POI_NATS_URL` | To enable POI ingestion | _none_ | NATS server URL (e.g. `nats://localhost:4222`). **POI ingestion is enabled only when this is set** — unset means the worker skips POI subscription. |
| `POI_NATS_STREAM` | No | `AIS_STREAM` | JetStream stream name to consume from. |
| `POI_NATS_SUBJECT` | No | `ais.ship.proximity.events` | Subject filter for POI proximity events. |
| `POI_NATS_INSTANCE_ID` | No | derived from `JWT_SECRET` (else random) | Unique per-installation id. The durable consumer is `shipment-tracking-poi-{instanceId}`, so multiple self-hosted instances each receive all messages independently. |
| `JWT_SECRET` | No (platform var) | _none_ | Reused only to derive a stable `POI_NATS_INSTANCE_ID` when that isn't set explicitly. Without either, a random (non-stable) instance id is used and a warning is logged. |

Run the worker with:

```bash
POI_NATS_URL=nats://localhost:4222 yarn mercato shipment_tracking poi:worker
```

### ShipsGo (aggregator fallback)

The ShipsGo token and base URL are normally configured **in the UI**. As a
fallback, `SHIPSGO_API_TOKEN` and `SHIPSGO_BASE_URL` (default
`https://api.shipsgo.com/v2`) are read from the environment when no UI config
is present.

## Dockflow

[Dockflow](https://dockflow.com) is a container visibility platform: it tracks
ocean containers across carriers, terminals and inland legs and combines those
sources into one timeline of milestones per shipment. The `dockflow` adapter
pulls that timeline as DCSA Track & Trace 2.2 events from Dockflow's
[Trident Upstream API](https://docs.dockflow.com/trident-api/upstream), so one
Dockflow key covers every carrier Dockflow supports.

### Getting an API key

The adapter needs **one Dockflow API key with both the `downstream` and the
`upstream` scope**:

- `downstream` registers a container, booking or bill of lading with Dockflow
  for tracking ([Downstream API](https://docs.dockflow.com/trident-api/downstream)).
- `upstream` reads its events back.

A key with only one of the two scopes cannot track new references. To obtain a
key with both scopes, get in touch with
[support@dockflow.com](mailto:support@dockflow.com).

### Configuration

Configure it in the UI like any other carrier (Backend → Śledzenie przesyłek →
Autoryzacja śledzenia), choosing **Dockflow** and entering the API key. The
endpoint defaults to production, `https://api.dockflow.com/v3`. For Dockflow's
sandbox use `https://uat.dockflow.com/v3` together with a UAT key.

Then create tracking jobs with carrier code `dockflow` for `container`,
`booking` or `bol` references. On its first poll the adapter registers the
reference with Dockflow as tradeflow `om-<type>-<reference>`, so it never
changes tradeflows you manage in Dockflow yourself. Events appear once Dockflow
has picked the reference up. Until then the job reports no events.

## License

MIT. See [LICENSE](LICENSE).
