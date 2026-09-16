import { parseUnitDataTable, type N4DataTableResponse } from '../parsers/data-table'

const COLUMNS = [
  'Unit Nbr', 'T-State', 'V-State', 'Category', 'Line Op', 'Type ISO', 'Frght Kind',
  'I/B Actual Visit', 'O/B Actual Visit', 'Time In', 'Time Out', 'Unit Impediments',
  'CEN Number', 'Cmdy Weight', 'VGM Weight', 'Cargo Wt (kg)', 'Tare Wt', 'Weight (kg)',
  'Seal Nbr1', 'Seal Nbr2', 'Seal Nbr3', 'Seal Nbr4', 'DSK Number', 'Loaded',
]

// Real Baltic Hub /unit response shape for container GCXU5598460 (two UFV legs).
const REAL_RESPONSE: N4DataTableResponse = {
  'query-response': {
    'data-table': {
      '@count': '2',
      columns: { column: COLUMNS },
      rows: {
        row: [
          {
            '@primary-key': '11412344487',
            field: ['GCXU5598460', 'Inbound', 'Active', 'Export', 'MAE', '45G1', 'FCL',
              'GEN_TRUCK', '26WIKI624', null, null,
              '!TECHNICAL_FULL_CONTAINER,!CUSTOMS EXPORT PERMISSION,!MISSING_AGENT_PERMISSION',
              null, '24600', '28300.0', '24600.0', '3700.0', '28300.0',
              null, null, null, null, null, null],
          },
          {
            '@primary-key': '11341499051',
            field: ['GCXU5598460', 'Departed', 'Departed', 'Import', 'MAE', '45G1', 'FCL',
              '26GIRO622', 'RST62379', '2026-05-27 23:41', '2026-06-03 01:58',
              '!TECHNICAL_FULL_CONTAINER,!MISSING_AGENT_PERMISSION', '26PL32208D005FRKR0',
              '6360', '10060.0', '6360.0', '3700.0', '10060.0',
              'CN7842852', null, null, null, '26GIRO622 2026-05-26 19:39', '2026-06-03 01:47'],
          },
        ],
      },
    },
  },
}

describe('parseUnitDataTable', () => {
  it('parses both UFV legs, mapping @primary-key to ufvGkey and fields by header name', () => {
    const rows = parseUnitDataTable(REAL_RESPONSE)
    expect(rows).toHaveLength(2)

    const [exp, imp] = rows
    // @primary-key -> ufvGkey (the N4 Ufv_Gkey)
    expect(exp.ufvGkey).toBe('11412344487')
    expect(imp.ufvGkey).toBe('11341499051')

    // Positional field[] mapped by column header
    expect(exp.unitNbr).toBe('GCXU5598460')
    expect(exp.tState).toBe('Inbound')
    expect(exp.category).toBe('Export')
    expect(exp.ibActualVisit).toBe('GEN_TRUCK')
    expect(exp.obActualVisit).toBe('26WIKI624')
    expect(exp.vgmWeight).toBe(28300)
    expect(exp.cargoWtKg).toBe(24600)

    expect(imp.tState).toBe('Departed')
    expect(imp.timeIn).toBe('2026-05-27 23:41')
    expect(imp.timeOut).toBe('2026-06-03 01:58')
    expect(imp.loaded).toBe('2026-06-03 01:47')
    expect(imp.dskNumber).toBe('26GIRO622 2026-05-26 19:39')
  })

  it('splits impediments and collects non-empty seals', () => {
    const [exp, imp] = parseUnitDataTable(REAL_RESPONSE)
    expect(exp.impediments).toEqual([
      '!TECHNICAL_FULL_CONTAINER', '!CUSTOMS EXPORT PERMISSION', '!MISSING_AGENT_PERMISSION',
    ])
    expect(exp.seals).toEqual([]) // all four seal columns null
    expect(imp.seals).toEqual(['CN7842852']) // only Seal Nbr1 populated
  })

  it('preserves the full raw row (null for empty columns)', () => {
    const [exp] = parseUnitDataTable(REAL_RESPONSE)
    expect(exp.raw['Category']).toBe('Export')
    expect(exp.raw['Time In']).toBeNull()
    expect(Object.keys(exp.raw)).toHaveLength(COLUMNS.length)
  })

  it('tolerates XML->JSON single-element collapsing (row/column as objects, not arrays)', () => {
    const single: N4DataTableResponse = {
      'query-response': {
        'data-table': {
          '@count': '1',
          columns: { column: COLUMNS },
          rows: {
            row: {
              '@primary-key': '999',
              field: ['MSKU1', 'Yard', 'Active', 'Import', 'MSC', '22G1', 'FCL',
                'V1', null, '2026-01-01 10:00', null, null, null, null, null, null, null, null,
                null, null, null, null, null, null],
            },
          },
        },
      },
    }
    const rows = parseUnitDataTable(single)
    expect(rows).toHaveLength(1)
    expect(rows[0].ufvGkey).toBe('999')
    expect(rows[0].unitNbr).toBe('MSKU1')
    expect(rows[0].tState).toBe('Yard')
  })

  it('reports all-null stops for a pre-update payload lacking the STOP columns', () => {
    const [exp, imp] = parseUnitDataTable(REAL_RESPONSE)
    expect(exp.stops).toEqual({ vsl: null, road: null, rail: null })
    expect(imp.stops).toEqual({ vsl: null, road: null, rail: null })
  })

  it('parses the new Stop-Vsl / Stop-Road / Stop-Rail columns when present', () => {
    const withStops: N4DataTableResponse = {
      'query-response': {
        'data-table': {
          '@count': '1',
          columns: { column: [...COLUMNS, 'Stop-Vsl', 'Stop-Road', 'Stop-Rail'] },
          rows: {
            row: {
              '@primary-key': '555',
              field: ['MSKU2', 'Yard', 'Active', 'Import', 'MSC', '22G1', 'FCL',
                'V1', null, '2026-01-01 10:00', null, null, null, null, null, null, null, null,
                null, null, null, null, null, null,
                'N', 'Y', null],
            },
          },
        },
      },
    }
    const [row] = parseUnitDataTable(withStops)
    expect(row.stops).toEqual({ vsl: false, road: true, rail: false })
  })

  it('parses a real post-update Baltic Hub payload (27 columns, Stop-* = "false")', () => {
    // Verbatim shape from a real /unit response (container ECMU7554418, 2026-07):
    // the STOP columns arrive in Vsl, Rail, Road order with string "false" values,
    // and empties report Frght Kind "Empty" (not "MTY").
    const REAL_WITH_STOPS: N4DataTableResponse = {
      'query-response': {
        'data-table': {
          '@count': '2',
          columns: {
            column: [...COLUMNS, 'Stop-Vsl', 'Stop-Rail', 'Stop-Road'],
          },
          rows: {
            row: [
              {
                '@primary-key': '11643960646',
                field: ['ECMU7554418', 'Departed', 'Departed', 'Export', 'CMA', '45G1', 'Empty',
                  'BC1455XA', '26SPAI012', '2026-07-06 09:53', '2026-07-12 04:30', null, null, null,
                  null, '0.0', '4000.0', '4000.0', null, null, null, null, null, '2026-07-09 21:21',
                  'false', 'false', 'false'],
              },
              {
                '@primary-key': '11483997354',
                field: ['ECMU7554418', 'Departed', 'Departed', 'Import', 'CMA', '45G1', 'FCL',
                  '26CCJA1FL1MA', 'BC1455XA', '2026-06-22 17:15', '2026-06-30 14:49',
                  '!TECHNICAL_FULL_CONTAINER,!MISSING_AGENT_PERMISSION', '26PL322080NSJAGEK7',
                  '18320', '22020.0', '18020.0', '4000.0', '22020.0', 'M7663322', null, null, null,
                  '26CCJA1FL1MA 2026-06-22 05:55', '2026-06-30 14:40', 'false', 'false', 'false'],
              },
            ],
          },
        },
      },
    }
    const [mty, fcl] = parseUnitDataTable(REAL_WITH_STOPS)
    expect(mty.raw['Frght Kind']).toBe('Empty')
    expect(mty.stops).toEqual({ vsl: false, road: false, rail: false })
    expect(fcl.stops).toEqual({ vsl: false, road: false, rail: false })
    // Header order in the payload is Vsl, Rail, Road — name-indexed parsing is order-agnostic.
    expect(mty.raw['Stop-Road']).toBe('false')
  })

  it('returns [] for an empty (rows: null) or malformed envelope', () => {
    expect(parseUnitDataTable({ 'query-response': { 'data-table': { '@count': '0', columns: { column: COLUMNS }, rows: null } } })).toEqual([])
    expect(parseUnitDataTable({})).toEqual([])
  })
})
