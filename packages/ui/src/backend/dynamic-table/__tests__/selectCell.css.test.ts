import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Owner 07.10: select cells read as plain text; the only hint is a faint chevron on the hovered /
 * selected cell. The hint is drawn on the CELL (`td.cell-select`), because a column with its own
 * `renderer` has no `.cell-content` — FMS's Telex / Nadwozie / Przewóz showed no chevron at all
 * while the rule targeted `.cell-content` (browser check, 0.14.11).
 */
const css = readFileSync(join(__dirname, '../styles/DynamicTable.v2.css'), 'utf8')

const rulesFor = (selectorPart: string) =>
  [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .filter(([, sel]) => sel.includes(selectorPart))
    .map(([, sel, body]) => ({ sel: sel.trim(), body }))

describe('select cell styling', () => {
  it('no bordered pill and no "Wybierz…" placeholder', () => {
    for (const { body } of rulesFor('cell-select')) {
      expect(body).not.toMatch(/border\s*:/)
      expect(body).not.toMatch(/Wybierz/)
    }
  })

  it('the chevron is drawn on the cell, not on .cell-content', () => {
    const chevron = rulesFor('cell-select').filter(({ body }) => body.includes('background-image'))
    expect(chevron.length).toBeGreaterThan(0)
    for (const { sel } of chevron) {
      expect(sel).not.toMatch(/\.cell-content/)
      expect(sel).toMatch(/td\.hot-cell\.cell-select/)
      expect(sel).toMatch(/:hover|data-cell-selected/)
      expect(sel).toMatch(/:not\(\[data-cell-editing\]\)/)
    }
  })

  it('steps left of the comment marker', () => {
    expect(rulesFor('cell-select:has(> .cell-comment-indicator)').some(({ body }) => /background-position:\s*right 34px/.test(body))).toBe(true)
  })
})
