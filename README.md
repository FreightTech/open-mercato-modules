# Global Trade Logistics Modules for Open Mercato

[![license MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![built on open-mercato](https://img.shields.io/badge/built%20on-open--mercato-6b46c1.svg)](https://github.com/open-mercato/open-mercato)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

[FreightTech.org](https://freighttech.org) brings deep, hands-on Global Trade
Logistics expertise. It's built within the **Open Mercato** framework, which
extends its capabilities to other areas of your business needs.

We're not a Logistics SaaS that asks a terminal, a forwarder, and a shipping
line to all live inside the same walled app, or a repository that only knows
what someone typed into it. We publish the logistics domain as open, ejectable
modules on top of an open core, fed automatically from the data sources
stakeholders already work with, so each one plugs the vertical into their own
stack instead of replacing it.

> We give every stakeholder connectivity to the data sources that matter:
> shipping line and airline schedules, container terminal data, vessel position
> via AIS, and ONE Record data exchange between each other.

## Who this is for

Global trade logistics is a chain, not a single company's workflow: every link
runs different systems and needs to talk to the others without losing data at
the handoff.

| Stakeholder | What these modules give them |
|-------------|------------------------------|
| **BCOs** (Beneficial Cargo Owners) | Visibility into freight spend, booking status, landed cost, and supply chain metrics like lead times across every carrier and forwarder they use |
| **Freight Forwarders / LSPs** | The quote-to-booking-to-billing workflow, in the domain's own language: not bent to fit a generic TMS, nor dependent on outside AI tools built to replace you one day |
| **Co-Loaders & Consolidators** | Load consolidation and space-allocation visibility across every co-loaded shipment and the carriers behind it |
| **Container Terminals** | Gate, yard, and vessel-visit data connected to the parties waiting on it |
| **Trucking & Intermodal Carriers** | Dispatch and container-move tracking that plugs into the booking and billing systems around it |
| **Shipping Lines** | Schedules, bookings, and B/L data reachable by the forwarders and BCOs who depend on them |
| **Airlines** | Air waybill and capacity data connected to the same trade-lifecycle modules as ocean and road |
| **Airport Handling Companies** | Ground-handling and milestone data flowing straight into the shipment record, not a separate silo |

## Why an open core

FreightTech.org brings the logistics domain expertise. Open Mercato provides the
technical foundation everyone can inspect, extend, or self-host. That split is
deliberate:

- 🔗 **Extends or replaces, your call:** modules meet the systems you already
  run; whether one sits alongside your ERP, CRM, or TMS, or replaces a piece of
  it, is your decision, not one the platform makes for you
- 🧬 **Ejectable:** take ownership of the source and modify it freely, no vendor
  lock-in
- 🔓 **MIT-licensed:** inspect it, self-host it, extend it
- 🔒 **Isolated by design:** each module hooks into the platform through declared
  extension points, never by patching core code

## How it works

Modules are published under `@freighttech/*` and installed into any standalone
Open Mercato app via the `mercato` CLI:

```bash
# Install and activate in one step
yarn mercato module add @freighttech/<module-name>

# Install it and copy the source locally if you want to modify the module yourself
yarn mercato module add @freighttech/<module-name> --eject
```

Each package integrates through Open Mercato's UMES extension points: widget
injection, event subscribers, response enrichers, API interceptors, and custom
entities. Core packages stay untouched and upgradeable.

## 🧩 Module List

| Package | Description | Author |
|---------|-------------|--------|
| [`@freighttech/shipment-tracking`](packages/shipment-tracking) | Carrier shipment tracking — DCSA carrier adapters (Maersk, MSC, CMA CGM, Hapag-Lloyd, ZIM, COSCO, Evergreen), a ShipsGo aggregator fallback, a Journey Timeline, and an optional live vessel/POI map | [FreightTech.org](https://freighttech.org) |
| [`@freighttech/terminal-tracking`](packages/terminal-tracking) | Container-terminal tracking — Navis N4, GCT (Gdynia), and BCT (INCOS) adapters that normalize terminal APIs into events, with per-terminal config, batched polling, and terminal matching | [FreightTech.org](https://freighttech.org) |
| [`@freighttech/ui`](packages/ui) | Composable UI toolkit for Open Mercato backoffice and business apps — backend UI patterns (DynamicTable, forms, dialogs, detail sections, injections, notifications) and reusable primitives | [FreightTech.org](https://freighttech.org) |

## 🏗️ Building a Module

Modules live in `packages/<module-name>/` and are published under the
`@freighttech/` scope, following Open Mercato's own module development guide and
package conventions:

- **Package name:** `@freighttech/<module-name>` (kebab-case)
- **Module ID inside the package:** snake_case (e.g. `my_module`)
- Every module **MUST** use UMES extension points; it **MUST NOT** modify Open
  Mercato core packages
- `ejectable: true` in the module's metadata if consumers should be able to take
  source ownership

See [CONTRIBUTING.md](CONTRIBUTING.md) for the branch model and PR checklist.

## 🔗 Resources

- [Open Mercato core repo](https://github.com/open-mercato/open-mercato)
- [Open Mercato official modules](https://github.com/open-mercato/modules) — general-purpose community modules
- [Module development guide](https://github.com/open-mercato/open-mercato#module-development)
- [FreightTech.org](https://freighttech.org)

## License

MIT. See [LICENSE](LICENSE) for details.
