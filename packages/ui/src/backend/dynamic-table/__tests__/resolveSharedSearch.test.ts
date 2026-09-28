/**
 * The ⚙ search switches (owner review 2026-09-28): "Global search" and
 * "Search in tables" replace the Shared / Per pane toggle. Each combination
 * decides what a table pane receives as `sharedSearch`.
 */
import { resolveSharedSearch } from '../split-view/sharedCriteria'

const split = (workspaceSearch: boolean, paneSearch: boolean, needle?: string) =>
  resolveSharedSearch({ isSplit: true, workspaceSearch, paneSearch, needle })

describe('resolveSharedSearch', () => {
  it('global on, tables off: the global needle drives every pane, empty means no search', () => {
    expect(split(true, false, 'gdansk')).toBe('gdansk')
    expect(split(true, false, '')).toBe('')
    expect(split(true, false, undefined)).toBe('')
  })

  it('global on, tables on: a typed global needle wins, an empty one leaves each pane its own box', () => {
    expect(split(true, true, 'gdansk')).toBe('gdansk')
    expect(split(true, true, '')).toBeUndefined()
  })

  it('global off, tables on: every pane uses its own box, whatever is left in the global one', () => {
    expect(split(false, true, 'gdansk')).toBeUndefined()
  })

  it('global off, tables off: no search at all — a hidden box must not keep filtering', () => {
    expect(split(false, false, 'gdansk')).toBe('')
  })

  it('an unsplit page has no workspace bar: always the pane\'s own box', () => {
    expect(resolveSharedSearch({ isSplit: false, workspaceSearch: true, paneSearch: false, needle: 'x' })).toBeUndefined()
  })
})
