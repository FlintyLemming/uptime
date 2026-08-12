import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import { eq } from 'drizzle-orm'
import type { Database } from 'bun:sqlite'
import type { DrizzleDb } from './client'
import { setting } from './schema'

export function runMigrations(db: DrizzleDb, _sql: Database) {
  migrate(db, { migrationsFolder: new URL('../../drizzle', import.meta.url).pathname })
}

export const DEFAULT_SETTINGS: Record<string, string> = {
  display_timezone: 'Asia/Shanghai',
  site_title: 'Status',
  slot_retention_days: '90',
  attempt_retention_days: '7',
}

export function seedSettings(db: DrizzleDb) {
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    const existing = db.select().from(setting).where(eq(setting.key, key)).get()
    if (!existing) db.insert(setting).values({ key, value }).run()
  }
}
