import type { ColumnDef } from '../../src/backend/dynamic-table/types/index'

/**
 * Deterministic fixture data. Every run of every build sees byte-identical rows,
 * so a delta between two runs can only come from the code under test.
 */
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const STATUSES = ['Booked', 'In transit', 'At port', 'Customs', 'Delivered', 'Cancelled']
const STATUS_BADGES: Record<string, string> = {
  Booked: 'info', 'In transit': 'sky', 'At port': 'purple', Customs: 'warning', Delivered: 'success', Cancelled: 'neutral',
}
const PORTS = ['PLGDN', 'PLGDY', 'DEHAM', 'NLRTM', 'BEANR', 'CNSHA', 'SGSIN', 'USNYC', 'TRIST', 'ITGOA']
const CARRIERS = ['Maersk', 'MSC', 'CMA CGM', 'Hapag-Lloyd', 'COSCO', 'ONE', 'Evergreen', 'HMM']
const WORDS = ['pallets', 'reefer', 'dangerous goods', 'machinery', 'textiles', 'electronics', 'furniture', 'steel coils', 'paper rolls', 'auto parts']

/**
 * The column mix of a real FMS transport list: identifiers, mono refs, status
 * badges, dropdowns, dates, right-aligned amounts, booleans and a custom
 * renderer. Columns past the first eight repeat the kinds so a wide table has
 * the same per-cell cost profile as a narrow one.
 */
const KINDS = ['ref', 'status', 'port', 'carrier', 'date', 'amount', 'flag', 'text', 'custom'] as const
type Kind = (typeof KINDS)[number]

function kindOf(i: number): Kind {
  return i === 0 ? 'ref' : KINDS[i % KINDS.length]
}

export function makeColumns(count: number): ColumnDef[] {
  return Array.from({ length: count }, (_, i): ColumnDef => {
    const data = `c${i}`
    switch (kindOf(i)) {
      case 'ref': return { data, title: `Ref ${i}`, width: 130, mono: true }
      case 'status': return { data, title: `Status ${i}`, width: 120, badge: true, badgeMap: STATUS_BADGES } as ColumnDef
      case 'port': return { data, title: `Port ${i}`, width: 110, type: 'dropdown', source: PORTS } as ColumnDef
      case 'carrier': return { data, title: `Carrier ${i}`, width: 130, type: 'dropdown', source: CARRIERS } as ColumnDef
      case 'date': return { data, title: `Date ${i}`, width: 110, type: 'date', mono: true } as ColumnDef
      case 'amount': return { data, title: `Amount ${i}`, width: 120, type: 'numeric', mono: true, align: 'right' } as ColumnDef
      case 'flag': return { data, title: `Flag ${i}`, width: 80, type: 'boolean' } as ColumnDef
      case 'text': return { data, title: `Cargo ${i}`, width: 200 }
      case 'custom': return {
        data, title: `Weight ${i}`, width: 110, readOnly: true,
        renderer: (v: unknown) => <span className="cell-content"><b>{String(v)}</b> kg</span>,
      } as ColumnDef
    }
  })
}

export function makeRows(rowCount: number, colCount: number, seed = 42): Record<string, unknown>[] {
  const rnd = mulberry32(seed)
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]
  const rows: Record<string, unknown>[] = new Array(rowCount)
  for (let r = 0; r < rowCount; r++) {
    const row: Record<string, unknown> = { id: `row-${r}` }
    for (let c = 0; c < colCount; c++) {
      const key = `c${c}`
      switch (kindOf(c)) {
        case 'ref': row[key] = `FT/${2026}/${String(r).padStart(6, '0')}`; break
        case 'status': row[key] = pick(STATUSES); break
        case 'port': row[key] = pick(PORTS); break
        case 'carrier': row[key] = pick(CARRIERS); break
        case 'date': row[key] = `2026-${String(1 + Math.floor(rnd() * 12)).padStart(2, '0')}-${String(1 + Math.floor(rnd() * 28)).padStart(2, '0')}`; break
        case 'amount': row[key] = Math.round(rnd() * 1_000_000) / 100; break
        case 'flag': row[key] = rnd() > 0.5; break
        case 'text': row[key] = `${pick(WORDS)}, ${Math.floor(rnd() * 40)} units, ${pick(WORDS)}`; break
        case 'custom': row[key] = Math.floor(rnd() * 28_000); break
      }
    }
    rows[r] = row
  }
  return rows
}
