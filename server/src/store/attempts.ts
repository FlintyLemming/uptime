import { and, asc, eq, gte, lt } from 'drizzle-orm'
import { attempt } from '../db/schema'
import type { DrizzleDb } from '../db/client'

export type AttemptDbRow = typeof attempt.$inferSelect

export function attemptsInRange(db: DrizzleDb, monitorId: number, fromSec: number, toSec: number): AttemptDbRow[] {
  return db.select().from(attempt)
    .where(and(eq(attempt.monitorId, monitorId), gte(attempt.slotStartedAt, fromSec), lt(attempt.slotStartedAt, toSec)))
    .orderBy(asc(attempt.slotStartedAt), asc(attempt.seq)).all()
}
