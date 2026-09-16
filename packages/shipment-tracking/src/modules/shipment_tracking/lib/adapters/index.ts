import type { CarrierRegistryService } from '../../services/carrierRegistry'
import { MaerskAdapter } from './maersk'
import { MscAdapter } from './msc'
import { ZimAdapter } from './zim'
import { HapagLloydAdapter } from './hapag-lloyd'
import { CmaCgmAdapter } from './cma-cgm'
import { CoscoAdapter } from './cosco'
import { EvergreenAdapter } from './evergreen'

export function registerAllAdapters(registry: CarrierRegistryService): void {
  registry.register(new MaerskAdapter())
  registry.register(new MscAdapter())
  registry.register(new ZimAdapter())
  registry.register(new HapagLloydAdapter())
  registry.register(new CmaCgmAdapter())
  registry.register(new CoscoAdapter())
  registry.register(new EvergreenAdapter())
}
