import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { PoiNatsService } from './services/poiNatsService'

// ─── Argument Parser ────────────────────────────────────────────

function parseArgs(args: string[]): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {}

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    if (arg.startsWith('--')) {
      const key = arg.slice(2)

      if (arg.includes('=')) {
        const [k, v] = arg.slice(2).split('=')
        result[k] = v
      } else {
        const nextArg = args[i + 1]
        if (nextArg && !nextArg.startsWith('--')) {
          result[key] = nextArg
          i++
        } else {
          result[key] = true
        }
      }
    }
  }

  return result
}

// ─── Scheduler Service Type ─────────────────────────────────────

type SchedulerServiceType = {
  register: (registration: {
    name: string
    description?: string
    scopeType: 'system' | 'organization' | 'tenant'
    organizationId?: string
    tenantId?: string
    scheduleType: 'cron' | 'interval'
    scheduleValue: string
    timezone?: string
    targetType: 'queue' | 'command'
    targetQueue?: string
    targetCommand?: string
    targetPayload?: unknown
    sourceType?: 'user' | 'module'
    sourceModule?: string
    isEnabled?: boolean
  }) => Promise<void>
}

// ─── Setup Schedules Command ────────────────────────────────────

/**
 * Register scheduled jobs for shipment tracking
 *
 * This command registers the daily poll and pre-arrival evaluation schedules
 * for an organization.
 *
 * Usage:
 *   yarn mercato shipment_tracking setup-schedules --tenant <tenantId> --org <organizationId>
 *
 * After running, start the scheduler to sync with BullMQ:
 *   yarn mercato scheduler start
 */
const setupSchedulesCommand: ModuleCli = {
  command: 'setup-schedules',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.orgId ?? args.org ?? '')

    if (!tenantId || !organizationId) {
      console.error(
        'Usage: mercato shipment_tracking setup-schedules --tenant <tenantId> --org <organizationId>',
      )
      console.error('')
      console.error('This command registers the scheduled jobs for shipment tracking:')
      console.error('  - Daily poll schedule (6:00 AM UTC): polls all active tracking jobs')
      console.error('  - Pre-arrival evaluation (every 6h): upgrades IN_TRANSIT → PRE_ARRIVAL')
      console.error('')
      console.error('After running, sync with BullMQ:')
      console.error('  yarn mercato scheduler start')
      return
    }

    const { resolve } = await createRequestContainer()

    try {
      const schedulerService = resolve<SchedulerServiceType>('schedulerService')

      if (!schedulerService) {
        console.error('❌ Scheduler service not available.')
        console.error('   Make sure the scheduler module is installed and configured.')
        process.exit(1)
      }

      console.log('📅 Registering shipment tracking schedules...\n')

      // Register daily poll schedule
      await schedulerService.register({
        name: 'Daily Shipment Tracking Poll',
        description:
          'Polls all active tracking jobs for carrier updates every day at 6:00 AM UTC.',
        scopeType: 'organization',
        tenantId,
        organizationId,
        scheduleType: 'cron',
        scheduleValue: '0 6 * * *', // 6:00 AM UTC daily
        timezone: 'UTC',
        targetType: 'command',
        targetCommand: 'shipment_tracking.tracking.poll_all',
        targetPayload: {
          tenantId,
          organizationId,
        },
        sourceType: 'module',
        sourceModule: 'shipment_tracking',
        isEnabled: true,
      })
      console.log(`  ✅ Registered daily poll schedule`)
      console.log(`     Cron: 0 6 * * * (6:00 AM UTC daily)`)

      // Register PRE_ARRIVAL evaluation schedule
      await schedulerService.register({
        name: 'Pre-Arrival Status Evaluation',
        description:
          'Checks IN_TRANSIT shipments every 6 hours and upgrades them to PRE_ARRIVAL when ETA is within 7 days.',
        scopeType: 'organization',
        tenantId,
        organizationId,
        scheduleType: 'cron',
        scheduleValue: '0 */6 * * *', // Every 6 hours
        timezone: 'UTC',
        targetType: 'command',
        targetCommand: 'shipment_tracking.tracking.evaluate_pre_arrival',
        targetPayload: {
          tenantId,
          organizationId,
        },
        sourceType: 'module',
        sourceModule: 'shipment_tracking',
        isEnabled: true,
      })
      console.log(`  ✅ Registered pre-arrival evaluation schedule`)
      console.log(`     Cron: 0 */6 * * * (every 6 hours)`)

      console.log('')
      console.log('✅ Schedules registered successfully!')
      console.log('')
      console.log('Next steps:')
      console.log('  1. Sync schedules with BullMQ: yarn mercato scheduler start')
      console.log('  2. Ensure worker is running: yarn mercato worker:start')
      console.log('')
    } catch (error: any) {
      if (error.message?.includes('not registered')) {
        console.error('❌ Scheduler service not available.')
        console.error('   Make sure the scheduler module is installed.')
      } else {
        console.error('❌ Failed to register schedules:', error.message)
      }
      process.exit(1)
    }
  },
}

// ─── POI NATS Subscriber Commands ────────────────────────────

/**
 * POI NATS Worker
 *
 * Long-running worker process that consumes POI proximity events from NATS JetStream.
 * Run this as a separate process/service alongside the main app.
 *
 * Usage:
 *   yarn mercato shipment_tracking poi:worker
 *
 * With pm2:
 *   pm2 start "yarn mercato shipment_tracking poi:worker" --name poi-worker
 *
 * With systemd:
 *   ExecStart=/path/to/yarn mercato shipment_tracking poi:worker
 */
const poiWorkerCommand: ModuleCli = {
  command: 'poi:worker',
  async run() {
    const { resolve } = await createRequestContainer()

    try {
      const poiService = resolve<PoiNatsService>('poiNatsService')

      if (!poiService) {
        console.error('[poi-worker] PoiNatsService not available')
        process.exit(1)
      }

      // Check if POI NATS is configured
      if (!poiService.isConfigured()) {
        console.log('[poi-worker] POI_NATS_URL not configured, exiting')
        console.log('[poi-worker] Set POI_NATS_URL environment variable to enable')
        process.exit(0)
      }

      console.log('[poi-worker] Starting POI NATS consumer...')

      // Start the NATS subscriber
      await poiService.start()

      const stats = poiService.getStats()
      console.log(`[poi-worker] Consumer started at ${stats.connectedAt?.toISOString()}`)
      console.log('[poi-worker] Listening for POI proximity events')

      // Keep the process alive and handle graceful shutdown
      let isShuttingDown = false
      const gracefulShutdown = async () => {
        if (isShuttingDown) return
        isShuttingDown = true
        console.log('[poi-worker] Shutting down...')
        try {
          await poiService.stop()
          console.log('[poi-worker] Stopped')
        } catch (error) {
          console.error('[poi-worker] Error during shutdown:', error)
        }
        process.exit(0)
      }

      process.on('SIGINT', gracefulShutdown)
      process.on('SIGTERM', gracefulShutdown)

      // Keep alive
      await new Promise(() => {})
    } catch (error: any) {
      console.error('[poi-worker] Failed to start:', error.message)
      process.exit(1)
    }
  },
}

const poiStatusCommand: ModuleCli = {
  command: 'poi:status',
  async run() {
    const { resolve } = await createRequestContainer()

    try {
      const poiService = resolve<PoiNatsService>('poiNatsService')

      if (!poiService) {
        console.error('PoiNatsService not available.')
        process.exit(1)
      }

      console.log('POI NATS Subscriber Status\n')

      // Check if POI NATS is configured
      if (!poiService.isConfigured()) {
        console.log('  Status:             not configured')
        console.log('')
        console.log('Set POI_NATS_URL environment variable to enable POI event subscription.')
        process.exit(0)
      }

      const stats = poiService.getStats()

      console.log(`  Status:             ${stats.status}`)
      console.log(`  Connected at:       ${stats.connectedAt?.toISOString() ?? 'N/A'}`)
      console.log(`  Messages received:  ${stats.messagesReceived}`)
      console.log(`  Messages processed: ${stats.messagesProcessed}`)
      console.log(`  Events created:     ${stats.eventsCreated}`)
      console.log(`  Errors:             ${stats.errors}`)
      console.log(`  Last message at:    ${stats.lastMessageAt?.toISOString() ?? 'N/A'}`)
      console.log('')
    } catch (error: any) {
      console.error('Failed to get status:', error.message)
      process.exit(1)
    }
  },
}

const poiHelpCommand: ModuleCli = {
  command: 'poi:help',
  async run() {
    console.log('POI NATS Consumer Commands\n')
    console.log('Commands:')
    console.log('  poi:worker  Start the POI NATS consumer worker (long-running)')
    console.log('  poi:status  Show consumer status and statistics')
    console.log('  poi:help    Show this help message')
    console.log('')
    console.log('Environment Variables:')
    console.log('  POI_NATS_URL      NATS server URL (required to enable)')
    console.log('  POI_NATS_STREAM   JetStream stream name (default: AIS_STREAM)')
    console.log('  POI_NATS_SUBJECT  Subject filter (default: ais.ship.proximity.events)')
    console.log('  POI_NATS_CONSUMER Durable consumer name (default: shipment-tracking-poi)')
    console.log('')
    console.log('Prerequisites:')
    console.log('  Create a durable consumer on the NATS server:')
    console.log('    nats consumer add AIS_STREAM shipment-tracking-poi \\')
    console.log('      --filter "ais.ship.proximity.events" \\')
    console.log('      --ack explicit --deliver all --replay instant')
    console.log('')
    console.log('Running as a service:')
    console.log('  # Direct:')
    console.log('  POI_NATS_URL=nats://localhost:4222 yarn mercato shipment_tracking poi:worker')
    console.log('')
    console.log('  # With pm2:')
    console.log('  pm2 start "yarn mercato shipment_tracking poi:worker" --name poi-worker')
    console.log('')
    console.log('  # With Docker (add to docker-compose.yml):')
    console.log('  poi-worker:')
    console.log('    command: yarn mercato shipment_tracking poi:worker')
    console.log('    environment:')
    console.log('      - POI_NATS_URL=nats://nats:4222')
    console.log('')
  },
}

export default [setupSchedulesCommand, poiWorkerCommand, poiStatusCommand, poiHelpCommand]
