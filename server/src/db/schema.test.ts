import { expect, test } from 'bun:test'
import { count, eq } from 'drizzle-orm'
import { openDb } from './client'
import { runMigrations, seedSettings, DEFAULT_SETTINGS } from './migrate'
import { monitor, monitorGroup, setting, slot } from './schema'

function freshDb() {
  const { db, sql } = openDb(':memory:')
  runMigrations(db, sql)
  seedSettings(db)
  return { db, sql }
}

test('migrations create all tables and seed settings', () => {
  const { db } = freshDb()
  const rows = db.select().from(setting).all()
  expect(rows.length).toBe(4)
  expect(db.select().from(setting).where(eq(setting.key, 'display_timezone')).get()?.value).toBe('Asia/Shanghai')
})

test('seedSettings is idempotent', () => {
  const { db } = freshDb()
  seedSettings(db)
  expect(db.select({ count: count() }).from(setting).get()?.count).toBe(4)
})

test('monitor fk set null on group delete; slot cascade on monitor delete', () => {
  const { db } = freshDb()
  const gId = db.insert(monitorGroup).values({ name: 'API' }).returning({ id: monitorGroup.id }).get().id
  const now = Math.floor(Date.now() / 1000)
  const mId = db.insert(monitor).values({
    groupId: gId, name: 'a', type: 'http', target: 'https://example.com',
    createdAt: now, updatedAt: now,
  }).returning({ id: monitor.id }).get().id
  db.insert(slot).values({ monitorId: mId, startedAt: 1000, intervalS: 60, status: 0, attempts: 1 }).run()

  db.delete(monitorGroup).where(eq(monitorGroup.id, gId)).run()
  expect(db.select().from(monitor).where(eq(monitor.id, mId)).get()?.groupId).toBeNull()

  db.delete(monitor).where(eq(monitor.id, mId)).run()
  expect(db.select({ count: count() }).from(slot).get()?.count).toBe(0)
})

test('seedSettings does not overwrite existing values', () => {
  const { db } = freshDb()
  db.update(setting).set({ value: 'UTC' }).where(eq(setting.key, 'display_timezone')).run()
  seedSettings(db)
  expect(db.select().from(setting).where(eq(setting.key, 'display_timezone')).get()?.value).toBe('UTC')
  expect(DEFAULT_SETTINGS.slot_retention_days).toBe('90')
})
