import { ProxyAgent, type Dispatcher } from 'undici'

/**
 * Build (and memoise) an undici `ProxyAgent` for a terminal's `proxyUrl`, to be
 * passed as the `dispatcher` on the N4 `fetch` calls so they egress through a
 * whitelisted IP. Returns undefined when no proxy is configured (direct).
 *
 * Note: undici proxying is HTTP(S) CONNECT only — `proxyUrl` must be an
 * http(s) forward proxy (e.g. tinyproxy/squid), not a SOCKS proxy.
 */
const cache = new Map<string, ProxyAgent>()

export function proxyDispatcher(proxyUrl?: string | null): Dispatcher | undefined {
  if (!proxyUrl) return undefined
  let agent = cache.get(proxyUrl)
  if (!agent) {
    agent = new ProxyAgent(proxyUrl)
    cache.set(proxyUrl, agent)
  }
  return agent
}

/** Init type for global fetch including undici's `dispatcher` (not in DOM types). */
export type FetchInitWithDispatcher = RequestInit & { dispatcher?: Dispatcher }
