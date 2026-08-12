import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import { eq } from 'drizzle-orm'
import type { Database } from 'bun:sqlite'
import type { DrizzleDb } from './client'
import { setting } from './schema'

export function migrationsFolder(): string {
  // 编译为单二进制后 import.meta.url 指向虚拟文件系统，drizzle 目录必须靠
  // MIGRATIONS_DIR 环境变量注入（Dockerfile 里 COPY drizzle/ 并设置该变量）；
  // 非编译模式（dev/test）回退到仓库内相对路径。
  return process.env.MIGRATIONS_DIR ?? new URL('../../drizzle', import.meta.url).pathname
}

export function runMigrations(db: DrizzleDb, _sql: Database) {
  migrate(db, { migrationsFolder: migrationsFolder() })
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
