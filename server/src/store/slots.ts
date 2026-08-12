import { and, asc, desc, eq, gte, lt } from 'drizzle-orm'
import { slot, attempt } from '../db/schema'
import type { DrizzleDb } from '../db/client'
import type { AttemptRow } from '../scheduler/slot-runner'

export type SlotRow = typeof slot.$inferSelect

export function insertSlot(db: DrizzleDb, row: typeof slot.$inferInsert): void {
  db.insert(slot).values(row).onConflictDoNothing().run()
}

export function insertAttempts(db: DrizzleDb, monitorId: number, slotStartedAt: number, rows: AttemptRow[]): void {
  if (rows.length === 0) return
  db.insert(attempt).values(rows.map((r) => ({ monitorId, slotStartedAt, seq: r.seq, ok: r.ok ? 1 : 0, latencyMs: r.latencyMs, error: r.error, at: r.at }))).run()
}

export function slotsInRange(db: DrizzleDb, monitorId: number, fromSec: number, toSec: number): SlotRow[] {
  return db.select().from(slot)
    .where(and(eq(slot.monitorId, monitorId), gte(slot.startedAt, fromSec), lt(slot.startedAt, toSec)))
    .orderBy(asc(slot.startedAt)).all()
}

export function lastNonNodataSlotBefore(db: DrizzleDb, monitorId: number, beforeSec: number): SlotRow | null {
  return db.select().from(slot)
    .where(and(eq(slot.monitorId, monitorId), lt(slot.startedAt, beforeSec)))
    .orderBy(desc(slot.startedAt)).get() ?? null
}

export function latestSlot(db: DrizzleDb, monitorId: number): SlotRow | null {
  return db.select().from(slot).where(eq(slot.monitorId, monitorId)).orderBy(desc(slot.startedAt)).get() ?? null
}
