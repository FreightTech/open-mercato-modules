import { Migration } from '@mikro-orm/migrations';

/**
 * Carrier cargo weight: gross and VGM (kg) on tracking events and the aggregated shipment.
 * Additive, nullable — most events carry neither; MSC/Hapag report them on the VGM event.
 */
export class Migration20261105120000_shipment_tracking_cargo_weight extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "shipment_tracking_events" add column if not exists "gross_weight_kg" real null;`);
    this.addSql(`alter table "shipment_tracking_events" add column if not exists "vgm_kg" real null;`);
    this.addSql(`alter table "shipment_tracking_shipments" add column if not exists "gross_weight_kg" real null;`);
    this.addSql(`alter table "shipment_tracking_shipments" add column if not exists "vgm_kg" real null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "shipment_tracking_events" drop column if exists "gross_weight_kg";`);
    this.addSql(`alter table "shipment_tracking_events" drop column if exists "vgm_kg";`);
    this.addSql(`alter table "shipment_tracking_shipments" drop column if exists "gross_weight_kg";`);
    this.addSql(`alter table "shipment_tracking_shipments" drop column if exists "vgm_kg";`);
  }

}
