import { asc, eq } from 'drizzle-orm'
import { monitor, monitorGroup } from '../db/schema'
import type { DrizzleDb } from '../db/client'
import type { MonitorRuntimeConfig } from '../scheduler/slot-runner'

export type MonitorRow = typeof monitor.$inferSelect
export type MonitorInput = {
  groupId: number | null; name: string; type: string; target: string; port: number | null
  intervalS: number; retryIntervalS: number; maxRetries: number; timeoutMs: number
  active: number; sortOrder: number; config: Record<string, unknown>
}

const PROBE_TYPES = ['http', 'tcp', 'ping', 'dns']

export function validateMonitor(input: MonitorInput): string[] {
  const errors: string[] = []
  if (!input.name?.trim()) errors.push('name is required')
  if (!PROBE_TYPES.includes(input.type)) errors.push(`type must be one of ${PROBE_TYPES.join(', ')}`)
  if (!input.target?.trim()) errors.push('target is required')
  if (input.type === 'http') {
    try { new URL(input.target) } catch { errors.push('http target must be a valid URL') }
  }
  if (input.type === 'tcp' && !(input.port && input.port >= 1 && input.port <= 65535)) {
    errors.push('tcp monitor requires port between 1 and 65535')
  }
  if (input.intervalS < 10) errors.push('interval_s must be >= 10')
  if (input.retryIntervalS < 1) errors.push('retry_interval_s must be >= 1')
  if (input.timeoutMs >= input.retryIntervalS * 1000) {
    errors.push('timeout_ms must be smaller than retry_interval_s * 1000')
  }
  return errors
}

function nowSec() { return Math.floor(Date.now() / 1000) }

export function createMonitor(db: DrizzleDb, input: MonitorInput): MonitorRow {
  return db.insert(monitor).values({ ...input, config: JSON.stringify(input.config), createdAt: nowSec(), updatedAt: nowSec() })
    .returning().get()
}

export function updateMonitor(db: DrizzleDb, id: number, input: MonitorInput): MonitorRow | null {
  const rows = db.update(monitor)
    .set({ ...input, config: JSON.stringify(input.config), updatedAt: nowSec() })
    .where(eq(monitor.id, id)).returning().all()
  return rows[0] ?? null
}

export function deleteMonitor(db: DrizzleDb, id: number): void {
  db.delete(monitor).where(eq(monitor.id, id)).run()
}

export function getMonitor(db: DrizzleDb, id: number): MonitorRow | null {
  return db.select().from(monitor).where(eq(monitor.id, id)).get() ?? null
}

export function listMonitors(db: DrizzleDb): MonitorRow[] {
  return db.select().from(monitor)
    .leftJoin(monitorGroup, eq(monitor.groupId, monitorGroup.id))
    .orderBy(asc(monitorGroup.sortOrder), asc(monitor.sortOrder), asc(monitor.id))
    .all().map((r) => r.monitor)
}

export function reorderMonitors(db: DrizzleDb, ids: number[]): void {
  ids.forEach((id, i) => db.update(monitor).set({ sortOrder: i }).where(eq(monitor.id, id)).run())
}

export function toRuntimeConfig(row: MonitorRow): MonitorRuntimeConfig {
  return {
    id: row.id, type: row.type as MonitorRuntimeConfig['type'], target: row.target, port: row.port,
    intervalS: row.intervalS, retryIntervalS: row.retryIntervalS, maxRetries: row.maxRetries,
    timeoutMs: row.timeoutMs, config: JSON.parse(row.config) as Record<string, unknown>,
  }
}
