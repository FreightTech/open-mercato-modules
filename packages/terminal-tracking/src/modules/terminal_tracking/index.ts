import type { ModuleInfo } from '@open-mercato/shared/modules/registry'
import './commands'

export const metadata: ModuleInfo = {
  name: 'terminal_tracking',
  title: 'Terminal Tracking',
  version: '0.1.0',
  description: 'Container terminal (Navis N4) tracking with per-terminal config, periodic polling, and events.',
  author: 'FreightTech',
  license: 'Proprietary',
}

export { features } from './acl'
