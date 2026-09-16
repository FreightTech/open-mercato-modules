import { Migration } from '@mikro-orm/migrations'

export class Migration20260610120000_terminal_vessel_visits extends Migration {
  override async up(): Promise<void> {
    // ─── terminal_tracking_vessel_visits ─────────────────────
    this.addSql(`create table if not exists "terminal_tracking_vessel_visits" (
      "id" uuid not null default gen_random_uuid(),
      "organization_id" uuid not null,
      "tenant_id" uuid not null,
      "terminal_code" text not null,
      "visit_ref" text not null,
      "vessel_name" text null,
      "ib_voyage" text null,
      "ob_voyage" text null,
      "line" text null,
      "phase" text null,
      "eta" timestamptz null,
      "etd" timestamptz null,
      "ata" timestamptz null,
      "atd" timestamptz null,
      "begin_receive" timestamptz null,
      "dry_cutoff" timestamptz null,
      "raw_data" jsonb null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      constraint "terminal_tracking_vessel_visits_pkey" primary key ("id")
    );`)
    this.addSql(`create index if not exists "tt_vessel_visits_org_tenant_idx" on "terminal_tracking_vessel_visits" ("organization_id", "tenant_id");`)
    this.addSql(`create index if not exists "tt_vessel_visits_visit_ref_idx" on "terminal_tracking_vessel_visits" ("visit_ref");`)
    this.addSql(`create unique index if not exists "tt_vessel_visits_uniq" on "terminal_tracking_vessel_visits" ("organization_id", "tenant_id", "terminal_code", "visit_ref");`)

    // ─── terminal_tracking_terminal_configs: vessel cache TTL ─
    this.addSql(`alter table "terminal_tracking_terminal_configs" add column if not exists "vessel_cache_ttl_seconds" integer null;`)
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "terminal_tracking_terminal_configs" drop column if exists "vessel_cache_ttl_seconds";`)
    this.addSql(`drop table if exists "terminal_tracking_vessel_visits" cascade;`)
  }
}
