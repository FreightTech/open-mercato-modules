import { Migration } from '@mikro-orm/migrations'

/**
 * Additive-only: a nullable `loaded_at` timestamp on terminal_tracking_events.
 * The N4 `Loaded` column parsed into a typed datetime, captured on every event
 * regardless of the container's current transit state.
 */
export class Migration20260805120000_terminal_event_loaded_at extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "terminal_tracking_events" add column if not exists "loaded_at" timestamptz null;`)
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "terminal_tracking_events" drop column if exists "loaded_at";`)
  }
}
