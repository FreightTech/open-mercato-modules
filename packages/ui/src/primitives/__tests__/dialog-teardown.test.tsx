/** @jest-environment node */
/**
 * FMS CI 17.11 (invoicing, pc2 w1:p1): a closed dialog frees the page's scroll in a timer. vitest tears the page down
 * after a file's last test — `document` is gone — before that timer fires, and it threw "document is not defined": an
 * uncaught error that fails the run though every test passed. Here, in Node, there is no `document` at all: the timer
 * runs as it would after that teardown, and has nothing to do.
 */
import { releaseScrollLockSoon } from '../dialog'

describe('releaseScrollLockSoon — the page gone before its timer fires', () => {
  it('does nothing when there is no document', () => {
    expect(typeof document).toBe('undefined')
    const timers: Array<() => void> = []
    releaseScrollLockSoon({ setTimeout: ((fn: () => void) => { timers.push(fn); return 0 }) as never })
    expect(timers).toHaveLength(1)
    expect(() => timers[0]()).not.toThrow()
  })

  it('schedules nothing where there is no window', () => {
    expect(() => releaseScrollLockSoon(undefined)).not.toThrow()
  })
})
