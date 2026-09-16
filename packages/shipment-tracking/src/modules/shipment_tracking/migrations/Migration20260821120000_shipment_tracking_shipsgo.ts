import { Migration } from '@mikro-orm/migrations';

/**
 * ShipsGo fallback tracking (Phase 1 — ocean fallback + air groundwork).
 *
 * Additive only:
 *  - `shipment_tracking_shipsgo_configs`: per-tenant ShipsGo config (encrypted api_token).
 *  - `shipment_tracking_jobs`: `provider` ('carrier'|'shipsgo'), `mode` ('ocean'|'air'),
 *    `provider_shipment_id` (ShipsGo id, set on registration).
 *  - `shipment_tracking_shipments`: `mode` + air fields (awb/flight/airline), all nullable.
 *
 * Existing rows default to provider='carrier', mode='ocean' — no backfill needed.
 */
export class Migration20260821120000_shipment_tracking_shipsgo extends Migration {

  override async up(): Promise<void> {
    // ShipsGoConfig
    this.addSql(`create table if not exists "shipment_tracking_shipsgo_configs" (
      "id" uuid not null default gen_random_uuid(),
      "organization_id" uuid not null,
      "tenant_id" uuid not null,
      "is_enabled" boolean not null default false,
      "api_token" text not null,
      "base_url" text not null default 'https://api.shipsgo.com/v2',
      "ocean_enabled" boolean not null default true,
      "air_enabled" boolean not null default true,
      "rate_limit_requests" int not null default 60,
      "rate_limit_window_seconds" int not null default 60,
      "is_active" boolean not null default true,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "shipment_tracking_shipsgo_configs_pkey" primary key ("id")
    );`);
    this.addSql(`create index if not exists "st_shipsgo_configs_org_tenant_idx" on "shipment_tracking_shipsgo_configs" ("organization_id", "tenant_id");`);
    this.addSql(`create unique index if not exists "st_shipsgo_configs_scope_unique" on "shipment_tracking_shipsgo_configs" ("organization_id", "tenant_id");`);

    // TrackingJob provider/mode
    this.addSql(`alter table "shipment_tracking_jobs" add column if not exists "provider" text not null default 'carrier';`);
    this.addSql(`alter table "shipment_tracking_jobs" add column if not exists "mode" text not null default 'ocean';`);
    this.addSql(`alter table "shipment_tracking_jobs" add column if not exists "provider_shipment_id" text null;`);

    // Shipment mode + air fields
    this.addSql(`alter table "shipment_tracking_shipments" add column if not exists "mode" text not null default 'ocean';`);
    this.addSql(`alter table "shipment_tracking_shipments" add column if not exists "awb_number" text null;`);
    this.addSql(`alter table "shipment_tracking_shipments" add column if not exists "flight_number" text null;`);
    this.addSql(`alter table "shipment_tracking_shipments" add column if not exists "airline_code" text null;`);
    this.addSql(`alter table "shipment_tracking_shipments" add column if not exists "airline_name" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "shipment_tracking_shipments" drop column if exists "airline_name";`);
    this.addSql(`alter table "shipment_tracking_shipments" drop column if exists "airline_code";`);
    this.addSql(`alter table "shipment_tracking_shipments" drop column if exists "flight_number";`);
    this.addSql(`alter table "shipment_tracking_shipments" drop column if exists "awb_number";`);
    this.addSql(`alter table "shipment_tracking_shipments" drop column if exists "mode";`);

    this.addSql(`alter table "shipment_tracking_jobs" drop column if exists "provider_shipment_id";`);
    this.addSql(`alter table "shipment_tracking_jobs" drop column if exists "mode";`);
    this.addSql(`alter table "shipment_tracking_jobs" drop column if exists "provider";`);

    this.addSql(`drop table if exists "shipment_tracking_shipsgo_configs";`);
  }

}
