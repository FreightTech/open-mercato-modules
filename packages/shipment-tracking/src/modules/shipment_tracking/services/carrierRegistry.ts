import type { CarrierAdapter } from '../lib/carrier-adapter'

/**
 * Singleton registry for carrier adapters.
 * Modules register concrete adapters at startup via DI.
 */
export class CarrierRegistryService {
  private adapters = new Map<string, CarrierAdapter>()

  register(adapter: CarrierAdapter): void {
    this.adapters.set(adapter.carrierCode.toLowerCase(), adapter)
  }

  get(carrierCode: string): CarrierAdapter | undefined {
    return this.adapters.get(carrierCode.toLowerCase())
  }

  list(): CarrierAdapter[] {
    return Array.from(this.adapters.values())
  }

  has(carrierCode: string): boolean {
    return this.adapters.has(carrierCode.toLowerCase())
  }

  names(): string[] {
    return Array.from(this.adapters.keys())
  }
}
