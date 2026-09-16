import { describe, it, expect } from 'vitest'
import { generateTotp, base32Decode, TOTP_PERIOD_SECONDS } from '../totp'

// RFC 6238 Appendix B publishes 8-digit reference codes for the SHA1 seed
// ASCII "12345678901234567890". Our generator emits 6 digits, i.e. the last 6
// of each published value. base32("12345678901234567890") = the seed below.
const RFC_SEED = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'

describe('generateTotp (RFC 6238 parity)', () => {
  it('matches the published 6-digit truncations at fixed instants', () => {
    // T=59s → 94287082 ; T=1234567890s → 89005924
    expect(generateTotp(RFC_SEED, 59_000)).toBe('287082')
    expect(generateTotp(RFC_SEED, 1_234_567_890_000)).toBe('005924')
  })

  it('always returns a zero-padded 6-digit string', () => {
    for (const t of [0, 30_000, 1_000_000_000_000, Date.now()]) {
      expect(generateTotp(RFC_SEED, t)).toMatch(/^\d{6}$/)
    }
  })

  it('rotates once per 30s period and is stable within one period', () => {
    const base = 1_700_000_000_000 // arbitrary period boundary-ish
    const inSamePeriod = generateTotp(RFC_SEED, base)
    expect(generateTotp(RFC_SEED, base + 1_000)).toBe(inSamePeriod) // same window
    const next = generateTotp(RFC_SEED, base + TOTP_PERIOD_SECONDS * 1_000)
    expect(next).not.toBe(inSamePeriod) // next window differs
  })

  it('decodes base32 case-insensitively and ignoring whitespace', () => {
    expect(base32Decode('jbswy3dpehpk3pxp')).toEqual(base32Decode('JBSWY3DPEHPK3PXP'))
    expect(base32Decode('JBSW Y3DP EHPK 3PXP')).toEqual(base32Decode('JBSWY3DPEHPK3PXP'))
  })

  it('rejects an invalid base32 secret', () => {
    expect(() => generateTotp('not-base32!!')).toThrow(/base32/)
  })
})
