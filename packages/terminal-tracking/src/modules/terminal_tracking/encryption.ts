import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: 'terminal_tracking:terminal_config',
    fields: [
      { field: 'auth_config' },
    ],
  },
]

export default defaultEncryptionMaps
