import { and, asc, eq, gte, lte } from 'drizzle-orm'
import { slotDaily } from '../db/schema'
import type { DrizzleDb } from '../db/client'

export type DailyRow = typeof slotDaily.$inferSelect

export function upsertDaily(db: DrizzleDb, row: typeof slotDaily.$inferInsert): void {
  db.insert(slotDaily).values(row)
    .onConflictDoUpdate({
      target: [slotDaily.monitorId, slotDaily.day],
      set: { up: row.up, flaky: row.flaky, down: row.down, nodata: row.nodata, downSeconds: row.downSeconds, latencyP50: row.latencyP50, latencyP95: row.latencyP95 },
    }).run()
}

export function dailyInRange(db: DrizzleDb, monitorId: number, fromDay: string, toDay: string): DailyRow[] {
  return db.select().from(slotDaily)
    .where(and(eq(slotDaily.monitorId, monitorId), gte(slotDaily.day, fromDay), lte(slotDaily.day, toDay)))
    .orderBy(asc(slotDaily.day)).all()
}

export function deleteDailyRange(db: DrizzleDb, monitorId: number, fromDay: string, toDay: string): void {
  db.delete(slotDaily)
    .where(and(eq(slotDaily.monitorId, monitorId), gte(slotDaily.day, fromDay), lte(slotDaily.day, toDay))).run()
}
