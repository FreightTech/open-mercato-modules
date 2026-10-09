/**
 * A cell's value for a column whose `data` may be a dotted path.
 *
 * Columns may point into a nested row object — the folders list's Status column
 * is `status.transport`, and its module route filters on the same path. The grid
 * reads `rowData[col.data]` literally, so for such a column the cell value is
 * `undefined` and only the column's renderer resolves the nested field. Features
 * that compare cell VALUES (Highlighting) read it here instead, so a rule on
 * Status can match (GT, 2026-10-08).
 *
 * A literal key wins over the path, so a row that already carries a flattened
 * `'status.transport'` key reads exactly what the grid reads.
 */
export function readCellValue(rowData: unknown, path: string): unknown {
  if (rowData === null || typeof rowData !== 'object') return undefined;
  const row = rowData as Record<string, unknown>;
  if (path in row || !path.includes('.')) return row[path];
  let current: unknown = row;
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}
