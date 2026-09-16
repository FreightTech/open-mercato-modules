/**
 * POI NATS Subscriber Service
 *
 * Subscribes to POI proximity events from the AIS system via NATS JetStream
 * and processes them to create tracking events and notifications.
 */

import type { NatsConnection, JetStreamClient, JetStreamManager, Consumer, ConsumerMessages } from 'nats'
import { connect, JSONCodec, AckPolicy, DeliverPolicy, ReplayPolicy } from 'nats'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { EventBus } from '@open-mercato/events'
import { loadPoiNatsConfig, validatePoiNatsConfig, isPoiNatsConfigured, type PoiNatsConfig } from '../lib/poi-nats-config'
import type { PoiProximityEvent } from '../lib/poi-types'
import { getJobPoiEventId } from '../lib/poi-types'
import { mapToOpenMercatoEventId } from '../lib/poi-event-processor'
import {
  processPoiEvent,
  isEventAlreadyProcessed,
  createTrackingEventFromPoi,
} from '../lib/poi-event-processor'
import { Shipment } from '../data/entities'
import { trackingLogger } from '../lib/logger'
import type { TrackingService } from './trackingService'

const LOG_COMPONENT = 'poi-nats'

// ─── Types ───────────────────────────────────────────────────

type PoiNatsServiceDeps = {
  em: () => EntityManager
  eventBus: EventBus
  trackingService: TrackingService
}

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'draining' | 'closed'

export type PoiNatsServiceStats = {
  status: ConnectionStatus
  messagesReceived: number
  messagesProcessed: number
  eventsCreated: number
  errors: number
  lastMessageAt: Date | null
  connectedAt: Date | null
}

// ─── Service ─────────────────────────────────────────────────

export class PoiNatsService {
  private deps: PoiNatsServiceDeps
  private config: PoiNatsConfig
  private connection: NatsConnection | null = null
  private jetstream: JetStreamClient | null = null
  private consumer: Consumer | null = null
  private consumerMessages: ConsumerMessages | null = null
  private status: ConnectionStatus = 'disconnected'
  private stats: PoiNatsServiceStats = {
    status: 'disconnected',
    messagesReceived: 0,
    messagesProcessed: 0,
    eventsCreated: 0,
    errors: 0,
    lastMessageAt: null,
    connectedAt: null,
  }

  /**
   * Track per-job events already emitted in this batch to avoid duplicates.
   * Key format: `${trackingJobId}:${eventType}:${sourceEventId}`
   */
  private emittedJobEvents: Set<string> = new Set()

  constructor(deps: PoiNatsServiceDeps) {
    this.deps = deps
    this.config = loadPoiNatsConfig()
  }

  /**
   * Get current service statistics.
   */
  getStats(): PoiNatsServiceStats {
    return { ...this.stats, status: this.status }
  }

  /**
   * Check if the service is connected.
   */
  isConnected(): boolean {
    return this.status === 'connected'
  }

  /**
   * Check if POI NATS integration is configured.
   */
  isConfigured(): boolean {
    return isPoiNatsConfigured()
  }

  /**
   * Start the NATS subscriber.
   */
  async start(): Promise<void> {
    if (!isPoiNatsConfigured()) {
      trackingLogger.info('POI_NATS_URL not configured, skipping POI event subscription', {
        component: LOG_COMPONENT,
      })
      return
    }

    if (this.status === 'connected' || this.status === 'connecting') {
      trackingLogger.warn('Service is already started or connecting', {
        component: LOG_COMPONENT,
        status: this.status,
      })
      return
    }

    try {
      validatePoiNatsConfig(this.config)
      this.status = 'connecting'

      trackingLogger.info('Connecting to NATS server', {
        component: LOG_COMPONENT,
        serverUrl: this.config.serverUrl,
      })

      this.connection = await connect({
        servers: this.config.serverUrl,
        name: this.config.connectionName,
        reconnect: true,
        maxReconnectAttempts: this.config.reconnect.maxAttempts,
        reconnectTimeWait: this.config.reconnect.initialDelayMs,
        reconnectJitter: this.config.reconnect.maxDelayMs - this.config.reconnect.initialDelayMs,
      })

      this.status = 'connected'
      this.stats.connectedAt = new Date()

      trackingLogger.info('Connected to NATS server', { component: LOG_COMPONENT })

      // Set up connection event handlers
      this.setupConnectionHandlers()

      // Subscribe to POI events
      await this.subscribe()

      trackingLogger.info('Subscribed to POI subject', {
        component: LOG_COMPONENT,
        subject: this.config.subject,
      })
    } catch (error) {
      this.status = 'disconnected'
      trackingLogger.error('Failed to connect to NATS', {
        component: LOG_COMPONENT,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      })
      throw error
    }
  }

  /**
   * Stop the NATS subscriber gracefully.
   */
  async stop(): Promise<void> {
    if (!this.connection) {
      return
    }

    this.status = 'draining'
    trackingLogger.info('Draining NATS connection', { component: LOG_COMPONENT })

    try {
      // Stop consuming messages first
      if (this.consumerMessages) {
        this.consumerMessages.stop()
        this.consumerMessages = null
      }

      this.consumer = null
      this.jetstream = null

      // Drain and close connection
      await this.connection.drain()
      this.connection = null
      this.status = 'closed'

      trackingLogger.info('NATS connection closed', { component: LOG_COMPONENT })
    } catch (error) {
      trackingLogger.error('Error during NATS shutdown', {
        component: LOG_COMPONENT,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      })
      this.status = 'disconnected'
      throw error
    }
  }

  /**
   * Subscribe to POI proximity events via JetStream.
   *
   * Auto-creates the durable consumer if it doesn't exist.
   * Each instance gets a unique consumer name (based on JWT_SECRET hash)
   * so multiple self-hosted installations can each receive all messages.
   */
  private async subscribe(): Promise<void> {
    if (!this.connection) {
      throw new Error('Not connected to NATS')
    }

    // Get JetStream manager for consumer management
    const jsm = await this.connection.jetstreamManager()

    // Ensure consumer exists (create if not)
    await this.ensureConsumer(jsm)

    // Get JetStream client for consuming
    this.jetstream = this.connection.jetstream()

    trackingLogger.debug('Binding to JetStream consumer', {
      component: LOG_COMPONENT,
      consumerName: this.config.consumerName,
      streamName: this.config.streamName,
    })

    // Bind to the durable consumer
    this.consumer = await this.jetstream.consumers.get(
      this.config.streamName,
      this.config.consumerName
    )

    trackingLogger.debug('Consumer bound, starting to consume messages', {
      component: LOG_COMPONENT,
      consumerName: this.config.consumerName,
    })

    // Start consuming messages
    this.consumerMessages = await this.consumer.consume()

    // Process messages asynchronously
    this.processMessages()
  }

  /**
   * Ensure the durable consumer exists on the stream.
   * Creates it if it doesn't exist with the appropriate configuration.
   */
  private async ensureConsumer(jsm: JetStreamManager): Promise<void> {
    const consumerConfig = {
      durable_name: this.config.consumerName,
      ack_policy: AckPolicy.Explicit,
      deliver_policy: DeliverPolicy.All, // Replay all messages from stream start
      replay_policy: ReplayPolicy.Instant, // Don't throttle replay
      filter_subject: this.config.subject,
      max_deliver: 5, // Prevent infinite redelivery of poison messages
    }

    try {
      // Check if consumer exists
      await jsm.consumers.info(this.config.streamName, this.config.consumerName)
      trackingLogger.debug('Consumer exists', {
        component: LOG_COMPONENT,
        consumerName: this.config.consumerName,
      })
    } catch (error: unknown) {
      // Consumer doesn't exist, create it
      const errorCode = (error as { code?: string })?.code
      if (errorCode === '404' || (error as { api_error?: { err_code?: number } })?.api_error?.err_code === 10014) {
        trackingLogger.info('Creating JetStream consumer', {
          component: LOG_COMPONENT,
          consumerName: this.config.consumerName,
          streamName: this.config.streamName,
        })
        await jsm.consumers.add(this.config.streamName, consumerConfig)
        trackingLogger.info('JetStream consumer created', {
          component: LOG_COMPONENT,
          consumerName: this.config.consumerName,
        })
      } else {
        // Some other error, rethrow
        throw error
      }
    }
  }

  /**
   * Process incoming messages from the JetStream consumer.
   */
  private async processMessages(): Promise<void> {
    if (!this.consumerMessages) {
      return
    }

    const jsonCodec = JSONCodec<PoiProximityEvent>()

    for await (const msg of this.consumerMessages) {
      this.stats.messagesReceived++
      this.stats.lastMessageAt = new Date()

      try {
        const event = jsonCodec.decode(msg.data)
        
        // Validate required fields - skip malformed/test messages
        if (!event || !event.type || !event.mmsi) {
          trackingLogger.debug('Skipping invalid message (missing type or mmsi)', {
            component: LOG_COMPONENT,
          })
          msg.ack() // Ack to prevent redelivery of bad messages
          continue
        }

        await this.handlePoiEvent(event)

        // Acknowledge successful processing
        msg.ack()
        this.stats.messagesProcessed++
      } catch (error) {
        this.stats.errors++
        trackingLogger.error('Error processing NATS message', {
          component: LOG_COMPONENT,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        })

        // Negative acknowledge - message will be redelivered
        msg.nak()
      }
    }
  }

  /**
   * Handle a single POI proximity event.
   */
  private async handlePoiEvent(event: PoiProximityEvent): Promise<void> {
    // Clear job event deduplication set at start of each message
    // This ensures a clean slate and prevents silent event drops on retry
    this.emittedJobEvents.clear()

    trackingLogger.debug('Received POI event', {
      component: LOG_COMPONENT,
      eventType: event.type,
      vesselName: event.shipName,
      mmsi: event.mmsi,
    })

    // Fork a fresh, cleared EM per message: this worker resolves the container once
    // and loops forever, so reusing the container EM would leak its identity map.
    const em = this.deps.em().fork({ clear: true })

    try {
      // Process the event and find matching shipments
      const processed = await processPoiEvent(em, event)

      if (!processed) {
        // No matching shipments found
        return
      }

      trackingLogger.info('Matched shipments for POI event', {
        component: LOG_COMPONENT,
        mmsi: event.mmsi,
        eventType: event.type,
        matchedShipmentCount: processed.shipmentIds.length,
      })

      // Track which tracking jobs got a new event, so we can re-derive their shipments'
      // denormalized state (Journey Timeline / status / ETA) afterwards. POI events are
      // TRANSPORT (vessel) events that apply to every container on the job, and dedup means
      // only the first container actually creates the TrackingEvent — so we refresh the
      // WHOLE job, not just the container where the row was created.
      const affectedJobIds = new Set<string>()

      // Process each matched shipment
      for (const shipmentId of processed.shipmentIds) {
        const shipment = await em.findOne(
          Shipment,
          { id: shipmentId },
          { populate: ['trackingJob'] }
        )

        if (!shipment?.trackingJob) {
          continue
        }

        // Check for duplicates
        const alreadyProcessed = await isEventAlreadyProcessed(
          em,
          shipment.trackingJob.id,
          processed.sourceEventId
        )

        if (alreadyProcessed) {
          trackingLogger.debug('Event already processed', {
            component: LOG_COMPONENT,
            sourceEventId: processed.sourceEventId,
            trackingJobId: shipment.trackingJob.id,
          })
          continue
        }

        // Create TrackingEvent record
        const trackingEvent = createTrackingEventFromPoi(processed, shipment.trackingJob)
        em.persist(trackingEvent)
        this.stats.eventsCreated++

        affectedJobIds.add(shipment.trackingJob.id)

        // Emit per-shipment event (for webhooks/external integrations)
        const shipmentEventId = mapToOpenMercatoEventId(event.type)
        await this.deps.eventBus.emit(shipmentEventId, {
          shipmentId: shipment.id,
          trackingEventId: trackingEvent.id,
          organizationId: shipment.organizationId,
          tenantId: shipment.tenantId,
          vesselName: event.shipName,
          vesselMmsi: event.mmsi,
          vesselImo: processed.vesselImo,
          eventType: event.type,
          poiCode: processed.poiCode,
          latitude: event.lat,
          longitude: event.lng,
          eventDateTime: processed.eventDateTime.toISOString(),
          distanceToPoiMeters: event.distanceToPoiMeters,
        })

        // Emit per-job event (for in-app notifications) - only once per tracking job
        // This avoids duplicate notifications for multi-container bookings
        const trackingJobId = shipment.trackingJob.id
        const jobEventKey = `${trackingJobId}:${event.type}:${processed.sourceEventId}`
        if (!this.emittedJobEvents.has(jobEventKey)) {
          this.emittedJobEvents.add(jobEventKey)

          const jobEventId = getJobPoiEventId(event.type)
          await this.deps.eventBus.emit(jobEventId, {
            trackingJobId,
            shipmentId: shipment.id,
            trackingEventId: trackingEvent.id,
            organizationId: shipment.organizationId,
            tenantId: shipment.tenantId,
            vesselName: event.shipName,
            vesselMmsi: event.mmsi,
            vesselImo: processed.vesselImo,
            eventType: event.type,
            poiCode: processed.poiCode,
            latitude: event.lat,
            longitude: event.lng,
            eventDateTime: processed.eventDateTime.toISOString(),
            distanceToPoiMeters: event.distanceToPoiMeters,
            // Include shipment reference info for notification body
            containerNumber: shipment.containerNumber,
            bookingNumber: shipment.bookingNumber,
            bolNumber: shipment.bolNumber,
          })

          trackingLogger.debug('Emitted per-job POI event', {
            component: LOG_COMPONENT,
            trackingJobId,
            eventType: event.type,
          })
        }

        trackingLogger.info('Created tracking event from POI', {
          component: LOG_COMPONENT,
          shipmentId,
          eventType: event.type,
          trackingEventId: trackingEvent.id,
        })
      }

      await em.flush()

      // Re-derive denormalized state so AIS arrivals appear in the Journey Timeline and
      // update status/ETA in real time, instead of waiting for the next carrier poll.
      for (const trackingJobId of affectedJobIds) {
        await this.deps.trackingService.refreshShipmentsFromEvents(em, trackingJobId)
      }
    } catch (error) {
      trackingLogger.error('Error handling POI event', {
        component: LOG_COMPONENT,
        eventType: event.type,
        mmsi: event.mmsi,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      })
      throw error
    }
  }

  /**
   * Set up connection event handlers.
   */
  private setupConnectionHandlers(): void {
    if (!this.connection) {
      return
    }

    // Handle connection status changes
    ;(async () => {
      if (!this.connection) return

      for await (const status of this.connection.status()) {
        switch (status.type) {
          case 'disconnect':
            trackingLogger.warn('Disconnected from NATS server', { component: LOG_COMPONENT })
            this.status = 'disconnected'
            break
          case 'reconnect':
            trackingLogger.info('Reconnected to NATS server', { component: LOG_COMPONENT })
            this.status = 'connected'
            break
          case 'reconnecting':
            trackingLogger.info('Reconnecting to NATS server', { component: LOG_COMPONENT })
            this.status = 'connecting'
            break
          case 'error':
            trackingLogger.error('NATS connection error', {
              component: LOG_COMPONENT,
              data: status.data,
            })
            break
        }
      }
    })()
  }
}
