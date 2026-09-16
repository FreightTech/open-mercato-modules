/**
 * Runs a function in the background without blocking the caller.
 * Errors are logged but not propagated.
 *
 * Uses setImmediate to defer execution to the next event loop iteration,
 * allowing the caller to return immediately (non-blocking).
 *
 * @param fn - Async function to run in background
 * @param label - Optional label for error logging
 */
export function runInBackground(fn: () => Promise<void>, label?: string): void {
  setImmediate(() => {
    fn().catch((err) => {
      console.error(`[background${label ? `:${label}` : ''}] Error:`, err)
    })
  })
}

/**
 * Sleep helper for retry delays
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
