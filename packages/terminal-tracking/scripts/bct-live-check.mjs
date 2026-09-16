// Live end-to-end check of the built BCT/INCOS adapter against incos.pl.
// Drives the REAL code path: HTTP Basic header, container GET via n4Request,
// envelope parsing, and event mapping. No credentials are stored — the password
// is read from $INCOS_PASSWORD.
//
// Run (from anywhere):
//   INCOS_PASSWORD='…' node packages/terminal-tracking/scripts/bct-live-check.mjs
// Optional overrides: INCOS_USER, INCOS_CONTAINERS (comma-separated).

import { BctTerminalAdapter } from '../dist/modules/terminal_tracking/lib/adapters/bct/adapter.js'

const username = process.env.INCOS_USER || 'gtairandocean@freighttech.org'
const password = process.env.INCOS_PASSWORD
if (!password) {
  console.error('Set $INCOS_PASSWORD (the BCT INCOS Basic-auth password).')
  process.exit(2)
}

const containers = (process.env.INCOS_CONTAINERS || 'MSDU1035043,MSNU1267521,MSNU3022678,UETU3148415')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

const config = {
  terminalCode: 'bct',
  adapterType: 'bct',
  displayName: 'BCT',
  baseUrl: 'https://incos.pl',
  proxyUrl: null,
  endpoints: { unit: '/rest-container/container' },
  authType: 'basic',
  authConfig: { username, password },
  rateLimitRequests: 10000,
  rateLimitWindowSeconds: 86400,
  unlocode: 'PLBCT',
  facilityCode: null,
  facilityCodeListProvider: null,
}

const adapter = new BctTerminalAdapter()
console.log(`→ ${adapter.adapterType} adapter, ${containers.length} containers, user=${username}\n`)

const { events } = await adapter.fetchEventsBatch({ containerNumbers: containers, config })

const byContainer = new Map(containers.map((c) => [c, []]))
for (const e of events) {
  if (!byContainer.has(e.containerNumber)) byContainer.set(e.containerNumber, [])
  byContainer.get(e.containerNumber).push(e)
}

for (const [c, evs] of byContainer) {
  if (!evs.length) {
    console.log(`${c}: (no events — not found / no yard timestamps)`)
    continue
  }
  for (const e of evs) {
    console.log(
      `${c}: ${e.eventCode} @ ${e.eventDateTime.toISOString()}  ` +
        `mode=${e.modeOfTransport} dir=${e.rawData?.Category} loc=${e.transitState} ` +
        `vessel=${e.vesselName ?? '-'}/${e.voyageNumber ?? '-'} vgm=${e.vgmWeightKg ?? '-'} ` +
        `seal=${e.seals?.[0]?.number ?? '-'} holds=${JSON.stringify(e.impediments)} id=${e.sourceEventId}`,
    )
  }
}
console.log(`\nTotal events: ${events.length}`)

// Phase 2: resolve vessel visits (ETA/ATA) for the events' packed visit refs.
const refs = [...new Set(events.flatMap((e) => [e.visitRefIn, e.visitRefOut]).filter(Boolean))]
if (refs.length) {
  console.log('\nVessel visits:')
  for (const ref of refs) {
    try {
      const v = await adapter.fetchVesselVisit({ visitRef: ref, config })
      if (!v) {
        console.log(`  ${ref}: (none)`)
        continue
      }
      console.log(
        `  ${ref}: ${v.vesselName} line=${v.line} ` +
          `ETA=${v.eta?.toISOString() ?? '-'} ATA=${v.ata?.toISOString() ?? '-'} ` +
          `ETD=${v.etd?.toISOString() ?? '-'} ATD=${v.atd?.toISOString() ?? '-'}`,
      )
    } catch (err) {
      console.log(`  ${ref}: ERROR ${err.message}`)
    }
  }
}
