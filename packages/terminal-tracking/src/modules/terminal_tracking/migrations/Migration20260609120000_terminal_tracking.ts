import { Migration } from '@mikro-orm/migrations'

export class Migration20260609120000_terminal_tracking extends Migration {
  override async up(): Promise<void> {
    // ─── terminal_tracking_terminal_configs ──────────────────
    this.addSql(`create table if not exists "terminal_tracking_terminal_configs" (
      "id" uuid not null default gen_random_uuid(),
      "organization_id" uuid not null,
      "tenant_id" uuid not null,
      "terminal_code" text not null,
      "adapter_type" text not null,
      "display_name" text not null,
      "base_url" text not null,
      "endpoints" jsonb not null,
      "auth_type" text not null,
      "token_url" text null,
      "scope" text null,
      "client_id" text null,
      "auth_config" jsonb null,
      "rate_limit_requests" integer not null default 200,
      "rate_limit_window_seconds" integer not null default 60,
      "unlocode" varchar(5) null,
      "bic_codes" jsonb null,
      "smdg_codes" jsonb null,
      "name_aliases" jsonb null,
      "is_active" boolean not null default true,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "terminal_tracking_terminal_configs_pkey" primary key ("id")
    );`)
    this.addSql(`create index if not exists "tt_terminal_configs_org_tenant_idx" on "terminal_tracking_terminal_configs" ("organization_id", "tenant_id");`)
    this.addSql(`create unique index if not exists "tt_terminal_configs_code_uniq" on "terminal_tracking_terminal_configs" ("organization_id", "tenant_id", "terminal_code");`)

    // ─── terminal_tracking_jobs ──────────────────────────────
    this.addSql(`create table if not exists "terminal_tracking_jobs" (
      "id" uuid not null default gen_random_uuid(),
      "organization_id" uuid not null,
      "tenant_id" uuid not null,
      "terminal_code" text not null,
      "container_number" text not null,
      "status" text not null default 'active',
      "schedule" jsonb null,
      "next_poll_at" timestamptz null,
      "last_poll_at" timestamptz null,
      "retry_count" integer not null default 0,
      "error_history" jsonb null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "terminal_tracking_jobs_pkey" primary key ("id")
    );`)
    this.addSql(`create index if not exists "tt_jobs_org_tenant_idx" on "terminal_tracking_jobs" ("organization_id", "tenant_id");`)
    this.addSql(`create index if not exists "tt_jobs_status_idx" on "terminal_tracking_jobs" ("status");`)
    this.addSql(`create index if not exists "tt_jobs_next_poll_idx" on "terminal_tracking_jobs" ("next_poll_at");`)
    this.addSql(`create index if not exists "tt_jobs_container_idx" on "terminal_tracking_jobs" ("container_number");`)

    // ─── terminal_tracking_events ────────────────────────────
    this.addSql(`create table if not exists "terminal_tracking_events" (
      "id" uuid not null default gen_random_uuid(),
      "organization_id" uuid not null,
      "tenant_id" uuid not null,
      "job_id" uuid not null,
      "source" text not null default 'terminal',
      "source_event_id" text not null,
      "event_type" text not null,
      "event_code" text not null,
      "event_classifier_code" text null,
      "event_date_time" timestamptz not null,
      "container_number" text not null,
      "ufv_gkey" text not null,
      "transit_state" text null,
      "visit_state" text null,
      "facility_code" text null,
      "facility_code_list_provider" text null,
      "unlocode" varchar(5) null,
      "visit_ref_in" text null,
      "visit_ref_out" text null,
      "vessel_name" text null,
      "voyage_number" text null,
      "mode_of_transport" text null,
      "seals" jsonb null,
      "vgm_weight_kg" double precision null,
      "impediments" jsonb null,
      "raw_data" jsonb null,
      "created_at" timestamptz not null default now(),
      constraint "terminal_tracking_events_pkey" primary key ("id")
    );`)
    this.addSql(`do $$ begin alter table "terminal_tracking_events"
      add constraint "terminal_tracking_events_job_id_foreign"
      foreign key ("job_id") references "terminal_tracking_jobs" ("id") on update cascade on delete cascade; exception when duplicate_object then null; when duplicate_table then null; end $$;`)
    this.addSql(`create index if not exists "tt_events_org_tenant_idx" on "terminal_tracking_events" ("organization_id", "tenant_id");`)
    this.addSql(`create index if not exists "tt_events_job_idx" on "terminal_tracking_events" ("job_id");`)
    this.addSql(`create index if not exists "tt_events_container_idx" on "terminal_tracking_events" ("container_number");`)
    this.addSql(`create index if not exists "tt_events_event_date_idx" on "terminal_tracking_events" ("event_date_time");`)
    this.addSql(`create unique index if not exists "tt_events_source_event_uniq" on "terminal_tracking_events" ("job_id", "source", "source_event_id");`)
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "terminal_tracking_events" cascade;`)
    this.addSql(`drop table if exists "terminal_tracking_jobs" cascade;`)
    this.addSql(`drop table if exists "terminal_tracking_terminal_configs" cascade;`)
  }
}
