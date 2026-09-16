// Entity ids for `@freighttech/terminal-tracking` — HAND-MAINTAINED and AUTHORITATIVE.
//
// This header used to say "local typecheck stub", owned at runtime by apps/web.
// Both halves were false, and HEDGE-164 is what that cost. Nothing regenerates
// this file — `yarn generate` rewrites `generated/` only for modules declared
// `from: '@app'`. And it is not merely a typecheck aid: because
// `@open-mercato/core` installs as a real directory rather than a workspace
// symlink, `@open-mercato/cli` runs in STANDALONE mode, where
// `loadStandaloneGeneratedPackageEntities()` reads THIS file as the package's
// entity list and uses it INSTEAD of parsing `data/entities.ts`.
//
// An entity missing here is therefore missing from the host app's `E`, and `E`
// is a runtime registry rather than a bag of types: it backs the custom-field
// entity picker, query-index coverage and reindex, attachment assignment,
// dashboard widget sources and encryption field resolution. The entity's table,
// migrations and repositories keep working the whole time, which is why the
// failure reads as "the feature was never built" instead of as an error.
//
// One key per exported class in `data/entities.ts`, keyed `toSnake(ClassName)`
// with NO pluralisation — `InvoiceOrderLine` is `invoice_order_line`, never the
// `tableName`. Namespaces for OTHER modules are typecheck-only; the generator
// reads `E['<this module id>']` and ignores the rest.
//
// The mechanism in full, and the guard that fails the gate when this file and
// `data/entities.ts` drift apart:
// `apps/web/src/__tests__/entity-ids-registry-contract.test.ts`.

export const M = {
  terminal_tracking: 'terminal_tracking',
} as const

export const E = {
  terminal_tracking: {
    terminal_config: 'terminal_tracking:terminal_config',
    // HEDGE-164: `tracking_job` matches NO class in `data/entities.ts`. The
    // real entity is `TerminalTrackingJob` -> `terminal_tracking_job`, added
    // below; this key is a hand-written guess that has been reaching the host
    // registry as a phantom id ever since. It is left in place rather than
    // deleted because `ce.ts` registers a custom-entity record against
    // `terminal_tracking:tracking_job`, and removing the id could orphan
    // custom-field definitions already configured against it in a customer
    // database. Removal needs a production check of `custom_field_def` /
    // `custom_field_value` first and is tracked separately from this fix.
    tracking_job: 'terminal_tracking:tracking_job',
    terminal_event: 'terminal_tracking:terminal_event',
    terminal_tracking_job: 'terminal_tracking:terminal_tracking_job',
    terminal_vessel_visit: 'terminal_tracking:terminal_vessel_visit',
  },
} as const

export type KnownModuleId = keyof typeof M
export type KnownEntities = typeof E
