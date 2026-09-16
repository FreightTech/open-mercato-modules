import { Migration } from '@mikro-orm/migrations';

/**
 * Additive: human-friendly region names for AIS POI events.
 *
 * The poi-proximity-detector now emits `regionNamePl` / `regionNameEn` alongside the raw
 * POI code so the Journey Timeline can show e.g. "Morze Północne" instead of "N053W001-03738".
 * Both columns are nullable (carrier/DCSA events and unnamed POIs leave them null).
 */
export class Migration20260529120000_shipment_tracking_poi_region_names extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "shipment_tracking_events" add column if not exists "region_name_pl" text null;`);
    this.addSql(`alter table "shipment_tracking_events" add column if not exists "region_name_en" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "shipment_tracking_events" drop column if exists "region_name_pl";`);
    this.addSql(`alter table "shipment_tracking_events" drop column if exists "region_name_en";`);
  }

}
