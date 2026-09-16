import { describe, it, expect } from 'vitest'
import { parseVesselDataTable } from '../parsers/vessel-data-table'
import type { N4DataTableResponse } from '../parsers/data-table'

const COLUMNS = [
  'Visit', 'Vessel Name', 'I/B Vyg', 'O/B Vyg', 'Line', 'Phase',
  'ETA', 'ETD', 'ATA', 'ATD', 'Begin Receive', 'DryCutoff',
]

// Real Baltic Hub /VESSEL response for VISIT_REF=26NUBA625 (single row).
const REAL_RESPONSE: N4DataTableResponse = {
  'query-response': {
    'data-table': {
      '@count': '1',
      columns: { column: COLUMNS },
      rows: {
        row: {
          '@primary-key': '11000443969',
          field: [
            '26NUBA625', 'MAERSK NUBA', '623N', '625S', 'MAE', 'Inbound',
            '2026-06-14 10:00', '2026-06-15 18:00', null, null,
            '2026-06-07 10:00', null,
          ],
        },
      },
    },
  },
}

describe('parseVesselDataTable', () => {
  it('maps the real /VESSEL row by header name', () => {
    const row = parseVesselDataTable(REAL_RESPONSE)
    expect(row).not.toBeNull()
    expect(row).toMatchObject({
      visitRef: '26NUBA625',
      vesselName: 'MAERSK NUBA',
      ibVoyage: '623N',
      obVoyage: '625S',
      line: 'MAE',
      phase: 'Inbound',
      eta: '2026-06-14 10:00',
      etd: '2026-06-15 18:00',
      ata: null,
      atd: null,
      beginReceive: '2026-06-07 10:00',
      dryCutoff: null,
    })
  })

  it('preserves the full header->value map in raw', () => {
    const row = parseVesselDataTable(REAL_RESPONSE)!
    expect(row.raw['Line']).toBe('MAE')
    expect(row.raw['Begin Receive']).toBe('2026-06-07 10:00')
    expect(row.raw['DryCutoff']).toBeNull()
  })

  it('returns null when there are no rows', () => {
    const empty: N4DataTableResponse = {
      'query-response': { 'data-table': { '@count': '0', columns: { column: COLUMNS }, rows: null } },
    }
    expect(parseVesselDataTable(empty)).toBeNull()
  })

  it('returns null on an empty envelope', () => {
    expect(parseVesselDataTable({} as N4DataTableResponse)).toBeNull()
  })
})
