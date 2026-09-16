import { AsyncLocalStorage } from 'node:async_hooks'
import { trace, SpanStatusCode, type Span } from '@opentelemetry/api'

const MODULE_NAME = 'shipment-tracking'

// ── Inlined structured logger + tracing ──────────────────────────────
// Previously provided by `@open-mercato/logger`, which is not published to the
// public npm registry. Reimplemented locally over `@opentelemetry/api` (already
// a dependency) and `node:async_hooks` so this package installs from public
// registries with no private dependency. Behaviour parity: JSON structured
// logs that carry any active async-local context, and an OTel active span
// wrapper that records exceptions and always ends the span.

type LogContext = Record<string, unknown>
type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const logContext = new AsyncLocalStorage<LogContext>()

function emit(level: LogLevel, message: string, fields?: LogContext): void {
  const record: LogContext = {
    level,
    time: new Date().toISOString(),
    message,
    ...logContext.getStore(),
    ...fields,
  }
  const line = JSON.stringify(record)
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

const logger = {
  debug: (message: string, fields?: LogContext) => emit('debug', message, fields),
  info: (message: string, fields?: LogContext) => emit('info', message, fields),
  warn: (message: string, fields?: LogContext) => emit('warn', message, fields),
  error: (message: string, fields?: LogContext) => emit('error', message, fields),
}

function runWithLogContext<T>(ctx: LogContext, fn: () => T | Promise<T>): T | Promise<T> {
  return logContext.run({ ...logContext.getStore(), ...ctx }, fn)
}

const tracer = trace.getTracer(MODULE_NAME)

function withSpan<T>(
  opts: { name: string; attributes?: Record<string, string | number | boolean | undefined> },
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const attributes = Object.fromEntries(
    Object.entries(opts.attributes ?? {}).filter(([, v]) => v !== undefined),
  ) as Record<string, string | number | boolean>
  return tracer.startActiveSpan(opts.name, { attributes }, async (span) => {
    try {
      return await fn(span)
    } catch (error) {
      span.recordException(error as Error)
      span.setStatus({ code: SpanStatusCode.ERROR })
      throw error
    } finally {
      span.end()
    }
  })
}

// ──────────────────────────────────────────────────────────────────────

export type CarrierOperation = 'authenticate' | 'fetchEvents'

export interface CarrierApiContext {
  carrierCode: string
  operation: CarrierOperation
  referenceType?: string
  referenceValue?: string
}

export interface CarrierLogContext {
  carrierCode: string
  shipmentId?: string
  trackingJobId?: string
}

/**
 * Run a function with carrier context in logs.
 * All logs within the function will include the carrier context fields.
 */
export function withCarrierContext<T>(
  ctx: CarrierLogContext,
  fn: () => T | Promise<T>,
): T | Promise<T> {
  return runWithLogContext({ module: MODULE_NAME, ...ctx }, fn)
}

/**
 * Run a carrier API call with OpenTelemetry span and structured logging.
 *
 * Creates a span named `carrier.{carrierCode}.{operation}` with relevant attributes.
 * Logs debug on start, info on success, error on failure.
 *
 * @example
 * ```ts
 * const events = await withCarrierApiSpan(
 *   { carrierCode: 'maersk', operation: 'fetchEvents', referenceType: 'container' },
 *   async (span) => {
 *     const response = await fetch(url, options)
 *     span.setAttribute('http.status_code', response.status)
 *     return response.json()
 *   }
 * )
 * ```
 */
export async function withCarrierApiSpan<T>(
  ctx: CarrierApiContext,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const spanName = `carrier.${ctx.carrierCode}.${ctx.operation}`

  logger.debug(`Starting ${ctx.operation}`, {
    module: MODULE_NAME,
    carrierCode: ctx.carrierCode,
    operation: ctx.operation,
    referenceType: ctx.referenceType,
  })

  const startMs = Date.now()

  return withSpan(
    {
      name: spanName,
      attributes: {
        'carrier.code': ctx.carrierCode,
        'carrier.operation': ctx.operation,
        module: MODULE_NAME,
        ...(ctx.referenceType && { 'tracking.reference_type': ctx.referenceType }),
      },
    },
    async (span) => {
      try {
        const result = await fn(span)
        const durationMs = Date.now() - startMs

        logger.info(`Completed ${ctx.operation}`, {
          module: MODULE_NAME,
          carrierCode: ctx.carrierCode,
          operation: ctx.operation,
          durationMs,
          success: true,
        })

        span.setAttribute('duration_ms', durationMs)
        return result
      } catch (error) {
        const durationMs = Date.now() - startMs
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'

        logger.error(`Failed ${ctx.operation}`, {
          module: MODULE_NAME,
          carrierCode: ctx.carrierCode,
          operation: ctx.operation,
          durationMs,
          success: false,
          error: errorMessage,
        })

        span.setAttribute('duration_ms', durationMs)
        throw error
      }
    },
  )
}

/**
 * Log rate limit events with structured fields.
 */
export function logRateLimit(ctx: {
  carrierCode: string
  tenantId: string
  allowed: boolean
  retryAfterSeconds?: number
}): void {
  const level = ctx.allowed ? 'debug' : 'info'
  logger[level]('Rate limit check', {
    module: MODULE_NAME,
    carrierCode: ctx.carrierCode,
    tenantId: ctx.tenantId,
    allowed: ctx.allowed,
    retryAfterSeconds: ctx.retryAfterSeconds,
  })
}

/**
 * The shipment tracking logger instance.
 * Use this for general logging within the shipment-tracking module.
 */
export const trackingLogger = logger
