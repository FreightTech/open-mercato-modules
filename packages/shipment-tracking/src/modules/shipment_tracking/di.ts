import { asClass } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { CarrierRegistryService } from './services/carrierRegistry'
import { TrackingService } from './services/trackingService'
import { ShipsGoProvider } from './services/shipsGoProvider'
import { WebhookService } from './services/webhookService'
import { PoiNatsService } from './services/poiNatsService'
import { registerAllAdapters } from './lib/adapters'

export function register(container: AppContainer) {
  // Register carrier registry (singleton - adapters are registered once)
  container.register({
    shipmentTrackingCarrierRegistry: asClass(CarrierRegistryService).singleton(),
  })

  // Register webhook service first (no dependencies on other shipment-tracking services)
  container.register({
    shipmentTrackingWebhookService: {
      resolve: () =>
        new WebhookService({
          em: () => container.resolve('em'),
          eventBus: container.resolve('eventBus'),
        }),
    },
  })

  // Register ShipsGo aggregator provider (fallback tracking; no external deps)
  container.register({
    shipmentTrackingShipsGoProvider: {
      resolve: () =>
        new ShipsGoProvider({
          em: () => container.resolve('em'),
        }),
    },
  })

  // Register tracking service (depends on webhook service)
  container.register({
    shipmentTrackingService: {
      resolve: () => {
        const cache = container.resolve<any>('cache')
        return new TrackingService({
          em: () => container.resolve('em'),
          eventBus: container.resolve('eventBus'),
          carrierRegistry: container.resolve('shipmentTrackingCarrierRegistry'),
          shipsGoProvider: container.resolve('shipmentTrackingShipsGoProvider'),
          webhookService: container.resolve('shipmentTrackingWebhookService'),
          cacheService: {
            get: (key: string) => cache.get(key),
            set: (key: string, value: string, ttlSeconds?: number) =>
              cache.set(key, value, ttlSeconds ? { ttl: ttlSeconds * 1000 } : undefined),
          },
        })
      },
    },
  })

  // Register POI NATS subscriber service
  container.register({
    poiNatsService: {
      resolve: () =>
        new PoiNatsService({
          em: () => container.resolve('em'),
          eventBus: container.resolve('eventBus'),
          trackingService: container.resolve('shipmentTrackingService'),
        }),
    },
  })

  // Register all built-in carrier adapters
  const registry = container.resolve<CarrierRegistryService>('shipmentTrackingCarrierRegistry')
  registerAllAdapters(registry)
}
