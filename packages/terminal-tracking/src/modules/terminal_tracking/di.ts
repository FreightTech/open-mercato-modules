import { asClass } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { TerminalRegistry } from './services/terminalRegistry'
import { TerminalTrackingService } from './services/terminalTrackingService'
import { TerminalMatcherService } from './services/terminalMatcherService'
import { registerAllAdapters } from './lib/adapters'

export function register(container: AppContainer) {
  // Adapter registry (singleton - adapters registered once)
  container.register({
    terminalTrackingRegistry: asClass(TerminalRegistry).singleton(),
  })

  // Tracking service (poll loop, dedup, emit)
  container.register({
    terminalTrackingService: {
      resolve: () => {
        const cache = container.resolve<any>('cache')
        return new TerminalTrackingService({
          em: () => container.resolve('em'),
          eventBus: container.resolve('eventBus'),
          terminalRegistry: container.resolve('terminalTrackingRegistry'),
          cacheService: {
            get: (key: string) => cache.get(key),
            set: (key: string, value: string, ttlSeconds?: number) =>
              cache.set(key, value, ttlSeconds ? { ttl: ttlSeconds * 1000 } : undefined),
          },
        })
      },
    },
  })

  // Terminal matcher (fuzzy name + exact BIC/SMDG/UNLOCODE)
  container.register({
    terminalMatcherService: {
      resolve: () =>
        new TerminalMatcherService({
          em: () => container.resolve('em'),
        }),
    },
  })

  // Register built-in adapters
  const registry = container.resolve<TerminalRegistry>('terminalTrackingRegistry')
  registerAllAdapters(registry)
}
