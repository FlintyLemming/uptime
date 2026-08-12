import { lt } from 'drizzle-orm'
import { attempt, slot } from '../db/schema'
import type { DrizzleDb } from '../db/client'
import type { Database } from 'bun:sqlite'
import { getSettings } from '../store/settings'

export function runRetention(db: DrizzleDb, sql: Database, nowSec: number): { deletedSlots: number; deletedAttempts: number } {
  const s = getSettings(db)
  const slotCutoff = nowSec - s.slot_retention_days * 86400
  const attemptCutoff = nowSec - s.attempt_retention_days * 86400
  const deletedSlots = db.delete(slot).where(lt(slot.startedAt, slotCutoff)).returning({ id: slot.monitorId }).all().length
  const deletedAttempts = db.delete(attempt).where(lt(attempt.at, attemptCutoff)).returning({ id: attempt.id }).all().length
  try { sql.exec('PRAGMA incremental_vacuum') } catch { /* 非 auto_vacuum=incremental 时忽略 */ }
  return { deletedSlots, deletedAttempts }
}
