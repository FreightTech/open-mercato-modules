/**
 * TOTP (RFC 6238) code generation for terminal adapters whose login expects an
 * authenticator one-time code in place of a static password (e.g. GCT).
 *
 * This is a deliberate, self-contained COPY of the generation half of
 * `packages/two-factor/src/modules/two_factor/lib/totp.ts` — kept in sync by
 * hand. We copy rather than depend on `@freighttech/two-factor` so this backend
 * tracking module stays dependency-light (only `fuse.js` + `undici`) and free of
 * that package's Next/React/mikro-orm peer deps. The algorithm is pure Node
 * `crypto`; only the consume-side pieces are copied (base32 decode + HOTP +
 * `generateTotp`) — enrollment helpers (secret/QR generation, verification) live
 * in the two-factor package and are not needed here.
 *
 * Parameters match a standard authenticator app: SHA1, 6 digits, 30s period.
 */
import crypto from 'crypto'

// ── Base32 (RFC 4648, no padding) ──────────────────────────────────────────
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** Decode a base32 authenticator secret into its raw key bytes. */
export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/g, '').replace(/\s+/g, '').toUpperCase()
  let bits = 0
  let value = 0
  const bytes: number[] = []
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch)
    if (idx === -1) throw new Error('totp: invalid base32 character in secret')
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

// ── TOTP (RFC 6238) over HOTP (RFC 4226) ────────────────────────────────────
export const TOTP_PERIOD_SECONDS = 30
export const TOTP_DIGITS = 6

function hotp(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8)
  // 64-bit big-endian counter (JS bitops are 32-bit, so split hi/lo).
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0)
  buf.writeUInt32BE(counter >>> 0, 4)
  const hmac = crypto.createHmac('sha1', secret).update(buf).digest()
  const offset = hmac[hmac.length - 1] & 0xf
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  return (binary % 10 ** TOTP_DIGITS).toString().padStart(TOTP_DIGITS, '0')
}

/** Compute the current TOTP code for a base32 secret (default time: now). */
export function generateTotp(base32Secret: string, nowMs: number = Date.now()): string {
  const counter = Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS)
  return hotp(base32Decode(base32Secret), counter)
}
