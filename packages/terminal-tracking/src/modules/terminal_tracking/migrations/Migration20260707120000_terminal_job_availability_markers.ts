import { Migration } from '@mikro-orm/migrations'

export class Migration20260707120000_terminal_job_availability_markers extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "terminal_tracking_jobs" add column if not exists "empty_ready_at" timestamptz null;`)
    this.addSql(`alter table "terminal_tracking_jobs" add column if not exists "holds_cleared_at" timestamptz null;`)
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "terminal_tracking_jobs" drop column if exists "empty_ready_at";`)
    this.addSql(`alter table "terminal_tracking_jobs" drop column if exists "holds_cleared_at";`)
  }
}
