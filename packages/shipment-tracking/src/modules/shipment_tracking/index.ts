import type { ModuleInfo } from '@open-mercato/shared/modules/registry'
import './commands'

export const metadata: ModuleInfo = {
  name: 'shipment_tracking',
  title: 'Shipment Tracking',
  version: '0.1.0',
  description: 'Ocean container shipment tracking with pluggable carrier adapters and webhooks.',
  author: 'Open Mercato Team',
  license: 'Proprietary',
}

export { features } from './acl'
