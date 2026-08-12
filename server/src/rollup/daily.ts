import { and, asc, gte, lt } from 'drizzle-orm'
import { slot } from '../db/schema'
import type { DrizzleDb } from '../db/client'
import { upsertDaily, deleteDailyRange } from '../store/daily'

export function dayOfSlot(startedAtSec: number, _intervalSec: number, timezone: string): string {
  const dtf = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
  return dtf.format(new Date(startedAtSec * 1000))   // en-CA 输出 YYYY-MM-DD
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null
  const idx = Math.max(0, Math.ceil(p * sorted.length) - 1)
  return sorted[Math.min(idx, sorted.length - 1)]!
}

/**
 * 把 [fromSec, toSec) 内的 slot 按 (monitorId, day) 聚合 upsert 到 slot_daily。幂等。
 */
export function rollupDaily(db: DrizzleDb, fromSec: number, toSec: number, timezone: string): void {
  const rows = db.select().from(slot).where(and(gte(slot.startedAt, fromSec), lt(slot.startedAt, toSec))).orderBy(asc(slot.monitorId), asc(slot.startedAt)).all()
  const byMonitorDay = new Map<string, { monitorId: number; day: string; up: number; flaky: number; down: number; rows: typeof rows }>()
  for (const r of rows) {
    const day = dayOfSlot(r.startedAt, r.intervalS, timezone)
    const key = `${r.monitorId}:${day}`
    let agg = byMonitorDay.get(key)
    if (!agg) { agg = { monitorId: r.monitorId, day, up: 0, flaky: 0, down: 0, rows: [] }; byMonitorDay.set(key, agg) }
    if (r.status === 0) agg.up++
    else if (r.status === 1) agg.flaky++
    else agg.down++
    agg.rows.push(r)
  }
  for (const agg of byMonitorDay.values()) {
    const intervalS = agg.rows[0]!.intervalS       // 同一天内 interval 一般一致；取首行
    const expectedPerDay = Math.floor(86400 / intervalS)
    const actual = agg.up + agg.flaky + agg.down
    const nodata = Math.max(0, expectedPerDay - actual)
    const downSeconds = agg.rows.filter((r) => r.status === 2).reduce((s, r) => s + r.intervalS, 0)
    const latencies = agg.rows.filter((r) => r.latencyMs !== null).map((r) => r.latencyMs!).sort((a, b) => a - b)
    upsertDaily(db, {
      monitorId: agg.monitorId, day: agg.day,
      up: agg.up, flaky: agg.flaky, down: agg.down, nodata, downSeconds,
      latencyP50: percentile(latencies, 0.5), latencyP95: percentile(latencies, 0.95),
    })
  }
}

/** 时区变更后的全量重建：删掉窗口内日桶再重算 */
export function rebuildDaily(db: DrizzleDb, monitorIds: number[], fromSec: number, toSec: number, timezone: string): void {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
  // 既有行是按旧时区切日的：往东切时区时首日前移、往西切时末日后移，
  // 因此清理范围两端各扩一天，保证旧行一定落在删除窗口内（rollup 会重算）。
  const fromDay = fmt.format(new Date((fromSec - 86400) * 1000))
  const toDay = fmt.format(new Date((toSec - 1 + 86400) * 1000))
  for (const id of monitorIds) deleteDailyRange(db, id, fromDay, toDay)
  rollupDaily(db, fromSec, toSec, timezone)
}
