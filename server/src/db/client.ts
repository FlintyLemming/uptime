import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import * as schema from './schema'

export type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>

export function openDb(file: string): { db: DrizzleDb; sql: Database } {
  const sql = new Database(file, { create: true })
  sql.exec('PRAGMA journal_mode=WAL')
  sql.exec('PRAGMA synchronous=NORMAL')
  sql.exec('PRAGMA foreign_keys=ON')
  const db = drizzle(sql, { schema })
  return { db, sql }
}
