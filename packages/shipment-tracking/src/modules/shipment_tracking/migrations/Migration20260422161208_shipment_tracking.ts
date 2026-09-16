import { Migration } from '@mikro-orm/migrations';

export class Migration20260422161208_shipment_tracking extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "shipment_tracking_bic_configs" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "is_enabled" boolean not null default false, "username" text not null, "password" text not null, "base_url" text not null default 'https://api.bic-code.org', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), constraint "shipment_tracking_bic_configs_pkey" primary key ("id"));`);
    this.addSql(`create index if not exists "st_bic_configs_org_tenant_idx" on "shipment_tracking_bic_configs" ("organization_id", "tenant_id");`);
    this.addSql(`DO $$ BEGIN alter table "shipment_tracking_bic_configs" add constraint "st_bic_configs_scope_unique" unique ("organization_id", "tenant_id"); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END $$;`);

    this.addSql(`create table if not exists "shipment_tracking_carrier_configs" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "carrier_code" text not null, "api_endpoint" text null, "auth_config" jsonb null, "rate_limit_requests" int not null default 60, "rate_limit_window_seconds" int not null default 60, "is_active" boolean not null default true, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "shipment_tracking_carrier_configs_pkey" primary key ("id"));`);
    this.addSql(`create index if not exists "st_carrier_configs_org_tenant_idx" on "shipment_tracking_carrier_configs" ("organization_id", "tenant_id");`);
    this.addSql(`DO $$ BEGIN alter table "shipment_tracking_carrier_configs" add constraint "st_carrier_configs_code_uniq" unique ("organization_id", "tenant_id", "carrier_code"); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END $$;`);

    this.addSql(`create table if not exists "shipment_tracking_location_overrides" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "carrier_code" text null, "unlocode" text not null, "facility_code" text not null, "facility_code_list_provider" text not null, "override_data" jsonb not null, "description" text null, "is_active" boolean not null default true, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, "created_by_user_id" uuid null, "updated_by_user_id" uuid null, constraint "shipment_tracking_location_overrides_pkey" primary key ("id"));`);
    this.addSql(`create index if not exists "st_location_overrides_lookup_idx" on "shipment_tracking_location_overrides" ("unlocode", "facility_code", "facility_code_list_provider");`);
    this.addSql(`create index if not exists "st_location_overrides_org_tenant_idx" on "shipment_tracking_location_overrides" ("organization_id", "tenant_id");`);
    this.addSql(`DO $$ BEGIN alter table "shipment_tracking_location_overrides" add constraint "st_location_overrides_match_uniq" unique ("organization_id", "tenant_id", "carrier_code", "unlocode", "facility_code", "facility_code_list_provider"); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END $$;`);

    this.addSql(`create table if not exists "shipment_tracking_jobs" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "carrier_code" text not null, "reference_type" text not null, "reference_value" text not null, "origin_unlocode" text null, "destination_unlocode" text null, "status" text not null default 'active', "schedule" jsonb null, "next_poll_at" timestamptz null, "last_poll_at" timestamptz null, "retry_count" int not null default 0, "error_history" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "shipment_tracking_jobs_pkey" primary key ("id"));`);
    this.addSql(`create index if not exists "st_jobs_next_poll_idx" on "shipment_tracking_jobs" ("next_poll_at");`);
    this.addSql(`create index if not exists "st_jobs_status_idx" on "shipment_tracking_jobs" ("status");`);
    this.addSql(`create index if not exists "st_jobs_org_tenant_idx" on "shipment_tracking_jobs" ("organization_id", "tenant_id");`);

    this.addSql(`create table if not exists "shipment_tracking_events" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "tracking_job_id" uuid not null, "source" text not null default 'dcsa', "source_event_id" text null, "event_type" text not null, "event_code" text not null, "event_classifier_code" text null, "event_date_time" timestamptz not null, "event_date_time_offset" text null, "description" text null, "raw_data" jsonb null, "equipment_reference" text null, "iso_equipment_code" text null, "empty_indicator_code" text null, "is_transshipment_move" boolean null, "location_name" text null, "location_unlocode" text null, "location_country" text null, "facility_code" text null, "facility_code_list_provider" text null, "facility_type_code" text null, "facility_address" text null, "latitude" real null, "longitude" real null, "transport_call_reference" text null, "mode_of_transport" text null, "vessel_name" text null, "vessel_imo" text null, "voyage_number" text null, "carrier_service_code" text null, "carrier_export_voyage_number" text null, "carrier_import_voyage_number" text null, "universal_service_reference" text null, "universal_export_voyage_reference" text null, "universal_import_voyage_reference" text null, "port_visit_reference" text null, "related_document_references" jsonb null, "event_created_date_time" timestamptz null, "retracted_event_id" text null, "publisher_name" text null, "publisher_role" text null, "delay_reason_code" text null, "change_remark" text null, "seals" jsonb null, "created_at" timestamptz not null default now(), constraint "shipment_tracking_events_pkey" primary key ("id"));`);
    this.addSql(`create index if not exists "st_events_event_date_time_idx" on "shipment_tracking_events" ("event_date_time");`);
    this.addSql(`create index if not exists "st_events_equipment_ref_idx" on "shipment_tracking_events" ("equipment_reference");`);
    this.addSql(`create index if not exists "st_events_tracking_job_idx" on "shipment_tracking_events" ("tracking_job_id");`);
    this.addSql(`create index if not exists "st_events_org_tenant_idx" on "shipment_tracking_events" ("organization_id", "tenant_id");`);
    this.addSql(`DO $$ BEGIN alter table "shipment_tracking_events" add constraint "st_events_source_event_uniq" unique ("tracking_job_id", "source", "source_event_id"); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END $$;`);

    this.addSql(`create table if not exists "shipment_tracking_shipments" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "status" text not null default 'PENDING', "carrier_code" text null, "container_number" text null, "iso_equipment_code" text null, "booking_number" text null, "bol_number" text null, "etd_timestamps" jsonb null, "eta_timestamps" jsonb null, "atd_timestamps" jsonb null, "ata_timestamps" jsonb null, "origin_location" jsonb null, "destination_location" jsonb null, "vessel_name" text null, "vessel_imo" text null, "voyage_number" text null, "event_count" int not null default 0, "last_event_at" timestamptz null, "extra" jsonb null, "route_stops" jsonb null, "cargo_events" jsonb null, "seals" jsonb null, "is_active" boolean not null default true, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, "created_by_user_id" uuid null, "tracking_job_id" uuid null, constraint "shipment_tracking_shipments_pkey" primary key ("id"));`);
    this.addSql(`create index if not exists "st_shipments_tracking_job_idx" on "shipment_tracking_shipments" ("tracking_job_id");`);
    this.addSql(`create index if not exists "st_shipments_carrier_idx" on "shipment_tracking_shipments" ("carrier_code");`);
    this.addSql(`create index if not exists "st_shipments_status_idx" on "shipment_tracking_shipments" ("status");`);
    this.addSql(`create index if not exists "st_shipments_org_tenant_idx" on "shipment_tracking_shipments" ("organization_id", "tenant_id");`);

    this.addSql(`create table if not exists "shipment_tracking_webhooks" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "url" text not null, "events_subscribed" jsonb not null, "hmac_secret" text null, "is_active" boolean not null default true, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "shipment_tracking_webhooks_pkey" primary key ("id"));`);
    this.addSql(`create index if not exists "st_webhooks_org_tenant_idx" on "shipment_tracking_webhooks" ("organization_id", "tenant_id");`);

    this.addSql(`create table if not exists "shipment_tracking_webhook_deliveries" ("id" uuid not null default gen_random_uuid(), "webhook_id" uuid not null, "event_type" text not null, "status" text not null default 'pending', "retry_count" int not null default 0, "next_retry_at" timestamptz null, "payload" jsonb not null, "response_status" int null, "response_body" text null, "error_message" text null, "created_at" timestamptz not null default now(), constraint "shipment_tracking_webhook_deliveries_pkey" primary key ("id"));`);
    this.addSql(`create index if not exists "st_webhook_deliveries_next_retry_idx" on "shipment_tracking_webhook_deliveries" ("next_retry_at");`);
    this.addSql(`create index if not exists "st_webhook_deliveries_status_idx" on "shipment_tracking_webhook_deliveries" ("status");`);
    this.addSql(`create index if not exists "st_webhook_deliveries_webhook_idx" on "shipment_tracking_webhook_deliveries" ("webhook_id");`);

    this.addSql(`DO $$ BEGIN alter table "shipment_tracking_events" add constraint "shipment_tracking_events_tracking_job_id_foreign" foreign key ("tracking_job_id") references "shipment_tracking_jobs" ("id") on update cascade; EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END $$;`);

    this.addSql(`DO $$ BEGIN alter table "shipment_tracking_shipments" add constraint "shipment_tracking_shipments_tracking_job_id_foreign" foreign key ("tracking_job_id") references "shipment_tracking_jobs" ("id") on update cascade on delete set null; EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END $$;`);

    this.addSql(`DO $$ BEGIN alter table "shipment_tracking_webhook_deliveries" add constraint "shipment_tracking_webhook_deliveries_webhook_id_foreign" foreign key ("webhook_id") references "shipment_tracking_webhooks" ("id") on update cascade; EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END $$;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "shipment_tracking_events" drop constraint if exists "shipment_tracking_events_tracking_job_id_foreign";`);

    this.addSql(`alter table "shipment_tracking_shipments" drop constraint if exists "shipment_tracking_shipments_tracking_job_id_foreign";`);

    this.addSql(`alter table "shipment_tracking_webhook_deliveries" drop constraint if exists "shipment_tracking_webhook_deliveries_webhook_id_foreign";`);
  }

}
