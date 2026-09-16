import { fetch, type RequestInit as UndiciRequestInit } from 'undici'
import { proxyDispatcher, type FetchInitWithDispatcher } from './proxy'
import { terminalLogger } from '../../logger'

/** Outcome of an N4 HTTP request: status + the fully-read response body. */
export type N4Response = { status: number; ok: boolean; text: string }

export type N4RequestOptions = {
  /** Terminal proxy URL — egresses through an undici ProxyAgent when set. */
  proxyUrl?: string | null
  /** Per-attempt timeout (whole attempt: connect + headers + body). Default 30s. */
  timeoutMs?: number
  /** Extra attempts after the first, on transient network failures. Default 2. */
  retries?: number
  /** Base backoff between attempts (doubles each retry). Default 250ms. */
  retryBackoffMs?: number
  /** Short label for logs (e.g. `"<terminalCode> /unit"`). */
  label?: string
}

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_RETRIES = 2
const DEFAULT_BACKOFF_MS = 250

// undici raises these for a dropped/half-open/timed-out connection — all safe to
// retry (the request either never reached the server or got no usable response).
const TRANSIENT_CODES = new Set([
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'ETIMEDOUT',
  'EAI_AGAIN',
])

/**
 * A transient network failure (connection dropped/reset/timed out) — distinct
 * from an HTTP error *status*, which is a real answer and must not be retried.
 */
export function isTransientNetworkError(err: unknown): boolean {
  // AbortSignal.timeout() rejects with a TimeoutError DOMException.
  if (err instanceof DOMException && err.name === 'TimeoutError') return true
  const e = err as { code?: string; message?: string; cause?: { code?: string; message?: string } }
  const code = e?.code ?? e?.cause?.code
  if (code && TRANSIENT_CODES.has(code)) return true
  // undici surfaces a mid-flight peer socket close as `TypeError: terminated`
  // (cause: UND_ERR_SOCKET "other side closed"); match on message as a backstop.
  const msg = `${e?.message ?? ''} ${e?.cause?.message ?? ''}`
  return /terminated|other side closed|socket hang ?up|fetch failed/i.test(msg)
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Perform one N4 HTTP request and ALWAYS fully read the response body — even on a
 * non-2xx status — returning `{ status, ok, text }`. Callers inspect `status`
 * and parse `text`; they never touch the live response stream.
 *
 * Why drain the body unconditionally: undici holds the keep-alive socket open
 * while a response body is unread. The previous code threw on a non-ok status
 * (e.g. Baltic Hub's Cloudflare allowlist 403) WITHOUT reading the body, leaving
 * a dangling stream. When the peer later closed that socket, undici errored the
 * orphaned body controller with no reader attached, surfacing an *unhandled*
 * `TypeError: terminated`. Under Node's default unhandled-rejection policy that
 * killed the queue-worker process and took the whole server down. Reading the
 * body inside this `try` means any mid-stream close rejects an awaited call here,
 * where it is caught and (when transient) retried — it can never escape.
 *
 * Each attempt is bounded by an AbortSignal timeout, and transient connection
 * drops are retried with exponential backoff so a single Cloudflare/tunnel
 * keep-alive reset doesn't fail an entire poll cycle.
 */
export async function n4Request(
  url: string,
  init: Omit<FetchInitWithDispatcher, 'dispatcher' | 'signal'>,
  options: N4RequestOptions = {},
): Promise<N4Response> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const retries = options.retries ?? DEFAULT_RETRIES
  const backoffMs = options.retryBackoffMs ?? DEFAULT_BACKOFF_MS
  const dispatcher = proxyDispatcher(options.proxyUrl)
  const label = options.label ?? url

  let lastErr: unknown
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      // `fetch` is imported from undici (not the global) so the request driver
      // and the `dispatcher` (a ProxyAgent from the SAME undici) belong to one
      // instance. With the global fetch — Node's *built-in* undici — driving a
      // dispatcher from this package's *bundled* undici, a peer socket reset
      // makes the bundled dispatcher call the built-in fetch's onAborted, which
      // throws `TypeError: terminated` from a detached socket-close handler that
      // no try/catch here can see — it escaped as an uncaughtException and killed
      // the worker. Same-instance, that reset rejects the awaited call below,
      // where it is caught and (when transient) retried.
      const res = await fetch(url, {
        ...init,
        dispatcher,
        signal: AbortSignal.timeout(timeoutMs),
      } as UndiciRequestInit)
      // Drain the body within this try — see the doc comment above. This is the
      // line that prevents the dangling-stream unhandled rejection.
      const text = await res.text()
      return { status: res.status, ok: res.ok, text }
    } catch (err) {
      lastErr = err
      if (attempt < retries && isTransientNetworkError(err)) {
        const wait = backoffMs * 2 ** attempt
        terminalLogger.warn('N4 request transient failure — retrying', {
          label,
          attempt: attempt + 1,
          maxAttempts: retries + 1,
          waitMs: wait,
          message: err instanceof Error ? err.message : String(err),
        })
        await sleep(wait)
        continue
      }
      throw err
    }
  }
  // The loop always returns or throws; this satisfies the type checker.
  throw lastErr
}
