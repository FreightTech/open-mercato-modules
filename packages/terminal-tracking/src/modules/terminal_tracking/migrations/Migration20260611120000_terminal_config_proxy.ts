import { Migration } from '@mikro-orm/migrations'

export class Migration20260611120000_terminal_config_proxy extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "terminal_tracking_terminal_configs" add column if not exists "proxy_url" text null;`)
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "terminal_tracking_terminal_configs" drop column if exists "proxy_url";`)
  }
}
