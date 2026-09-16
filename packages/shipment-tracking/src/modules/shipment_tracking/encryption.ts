import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

/**
 * Tenant-data-encryption declarations for the shipment_tracking module.
 *
 * `ShipsGoConfig.apiToken` holds the per-tenant ShipsGo API token and must be
 * encrypted at rest. Reads go through `findOneWithDecryption`; writes are
 * encrypted transparently by the ORM subscriber using this map.
 */
export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: 'shipment_tracking:shipsgo_config',
    fields: [{ field: 'apiToken' }],
  },
]

export default defaultEncryptionMaps
