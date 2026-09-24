/**
 * Benchmark workloads. Each is a (rows × columns) shape seen in FMS, not an
 * arbitrary stress number.
 *
 *  100x30   a normal list page (API pageSize cap is 100), typical column count
 *  100x80   the same page with a wide perspective (transport/finance tables)
 *  1000x30  an unpaginated / grouped view or an import preview
 *  10000x50 stress: the shape where virtualisation must carry the whole load
 *  app-transport  the transport list as FMS configures it: 100 rows, a wide
 *           perspective, 2 frozen columns, column virtualisation ON
 */
export const WORKLOADS = [
  { id: '100x30', rows: 100, cols: 30 },
  { id: '100x80', rows: 100, cols: 80 },
  { id: '1000x30', rows: 1000, cols: 30 },
  { id: '10000x50', rows: 10000, cols: 50 },
  { id: 'app-transport', rows: 100, cols: 120, frozen: 2, colVirt: true },
  // Diagnostic: isolate what app-transport's cost comes from. Run with
  // --only; excluded from the default matrix.
  { id: 'x120-plain', rows: 100, cols: 120, diagnostic: true },
  { id: 'x120-frozen', rows: 100, cols: 120, frozen: 2, diagnostic: true },
  { id: 'x120-virt', rows: 100, cols: 120, colVirt: true, diagnostic: true },
]
