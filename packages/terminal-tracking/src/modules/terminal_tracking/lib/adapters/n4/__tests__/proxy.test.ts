import { describe, it, expect } from 'vitest'
import { proxyDispatcher } from '../proxy'

describe('proxyDispatcher', () => {
  it('returns undefined when no proxy is configured', () => {
    expect(proxyDispatcher(undefined)).toBeUndefined()
    expect(proxyDispatcher(null)).toBeUndefined()
    expect(proxyDispatcher('')).toBeUndefined()
  })

  it('memoises one agent per proxy URL', () => {
    const a = proxyDispatcher('http://127.0.0.1:8888')
    const b = proxyDispatcher('http://127.0.0.1:8888')
    expect(a).toBeDefined()
    expect(a).toBe(b) // same instance reused
    const c = proxyDispatcher('http://127.0.0.1:9999')
    expect(c).not.toBe(a)
  })
})
