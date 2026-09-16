import { computeColumnFill } from '../utils/columnFill'

/**
 * The two regimes are the whole feature: a narrow table fills its container,
 * a wide one keeps its declared widths and scrolls. Everything else here is
 * about what the fill is FORBIDDEN to touch.
 */
describe('computeColumnFill', () => {
  const fill = (over: Partial<Parameters<typeof computeColumnFill>[0]> = {}) =>
    computeColumnFill({
      widths: [100, 200, 100],
      rigid: new Set<number>(),
      furnitureWidth: 0,
      containerWidth: 800,
      ...over,
    })

  it('distributes the whole surplus, proportionally to declared width', () => {
    const out = fill()
    // 800 - 400 = 400 surplus over 400px of flexible width → +100/+200/+100.
    expect(out.get(0)).toBe(100)
    expect(out.get(1)).toBe(200)
    expect(out.get(2)).toBe(100)
    const total = 400 + [...out.values()].reduce((a, b) => a + b, 0)
    expect(total).toBe(800)
  })

  it('lands on the container edge EXACTLY when the split does not divide evenly', () => {
    const out = fill({ widths: [100, 100, 100], containerWidth: 401 })
    const total = 300 + [...out.values()].reduce((a, b) => a + b, 0)
    expect(total).toBe(401)
  })

  it('is a no-op once the declared widths already overflow — the grid scrolls', () => {
    expect(fill({ containerWidth: 400 }).size).toBe(0)
    expect(fill({ containerWidth: 300 }).size).toBe(0)
  })

  it('counts the row-header and Actions furniture against the container', () => {
    const out = fill({ furnitureWidth: 400, containerWidth: 800 })
    expect(out.size).toBe(0)
  })

  it('never grows a pinned or hand-resized column, and still fills the width', () => {
    const out = fill({ rigid: new Set([1]) })
    expect(out.has(1)).toBe(false)
    const total = 400 + [...out.values()].reduce((a, b) => a + b, 0)
    expect(total).toBe(800)
  })

  it('leaves the strip rather than overruling every column', () => {
    // Everything is pinned or hand-sized: there is nothing we are allowed to
    // grow, and inventing permission would silently discard the user's widths.
    expect(fill({ rigid: new Set([0, 1, 2]) }).size).toBe(0)
  })

  it('returns no zero-valued entries (they would look like a change to the store)', () => {
    const out = fill({ widths: [100, 100], containerWidth: 201 })
    for (const v of out.values()) expect(v).toBeGreaterThan(0)
  })

  it('is inert without a measured container', () => {
    expect(fill({ containerWidth: 0 }).size).toBe(0)
    expect(fill({ widths: [] }).size).toBe(0)
  })
})
