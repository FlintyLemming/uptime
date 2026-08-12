import { expect, test } from 'bun:test'
import { openDb } from '../db/client'
import { runMigrations, seedSettings } from '../db/migrate'
import { monitor } from '../db/schema'
import { insertSlot } from '../store/slots'
import { dailyInRange } from '../store/daily'
import { rollupDaily, rebuildDaily, dayOfSlot } from './daily'

function setup() {
  const { db, sql } = openDb(':memory:')
  runMigrations(db, sql)
  seedSettings(db)
  const now = Math.floor(Date.now() / 1000)
  const mId = db.insert(monitor).values({ name: 'm', type: 'http', target: 'https://a.com', createdAt: now, updatedAt: now })
    .returning({ id: monitor.id }).get().id
  return { db, sql, mId }
}

// UTC 2026-01-02 00:00:00 = 1767312000
const DAY = 86400
const BASE = 1767312000

test('dayOfSlot uses timezone of slot start', () => {
  expect(dayOfSlot(BASE, 60, 'UTC')).toBe('2026-01-02')
  expect(dayOfSlot(BASE, 60, 'Asia/Shanghai')).toBe('2026-01-02')   // 08:00 CST
  expect(dayOfSlot(BASE - 8 * 3600, 60, 'Asia/Shanghai')).toBe('2026-01-02') // UTC 16:00 = CST 00:00
  expect(dayOfSlot(BASE - 8 * 3600 - 60, 60, 'Asia/Shanghai')).toBe('2026-01-01')
})

test('rollup aggregates counts, down_seconds and nodata', () => {
  const { db, sql, mId } = setup()
  // 4 个 60s slot：up, flaky, down, 缺失(=nodata)；interval 60 → 一天应有 1440 个，nodata = 1440-3
  insertSlot(db, { monitorId: mId, startedAt: BASE, intervalS: 60, status: 0, attempts: 1, recoveredAfterS: null, latencyMs: 10, error: null, certDaysLeft: null })
  insertSlot(db, { monitorId: mId, startedAt: BASE + 60, intervalS: 60, status: 1, attempts: 2, recoveredAfterS: 30, latencyMs: 15, error: null, certDaysLeft: null })
  insertSlot(db, { monitorId: mId, startedAt: BASE + 180, intervalS: 60, status: 2, attempts: 4, recoveredAfterS: null, latencyMs: null, error: 'boom', certDaysLeft: null })
  rollupDaily(db, BASE, BASE + DAY, 'UTC')
  const rows = dailyInRange(db, mId, '2026-01-02', '2026-01-02')
  expect(rows.length).toBe(1)
  const r = rows[0]!
  expect(r.up).toBe(1)
  expect(r.flaky).toBe(1)
  expect(r.down).toBe(1)
  expect(r.nodata).toBe(1440 - 3)
  expect(r.downSeconds).toBe(60)
})

test('nodata does not enter uptime denominator (denominator uses up+flaky+down only)', () => {
  const { db, sql, mId } = setup()
  insertSlot(db, { monitorId: mId, startedAt: BASE, intervalS: 60, status: 0, attempts: 1, recoveredAfterS: null, latencyMs: 10, error: null, certDaysLeft: null })
  insertSlot(db, { monitorId: mId, startedAt: BASE + 60, intervalS: 60, status: 2, attempts: 4, recoveredAfterS: null, latencyMs: null, error: 'e', certDaysLeft: null })
  rollupDaily(db, BASE, BASE + DAY, 'UTC')
  const r = dailyInRange(db, mId, '2026-01-02', '2026-01-02')[0]!
  const denom = r.up + r.flaky + r.down
  expect(denom).toBe(2)                            // nodata 不在分母
  expect((r.up + r.flaky) / denom).toBe(0.5)
})

test('rollup is idempotent (rerun produces identical rows)', () => {
  const { db, sql, mId } = setup()
  insertSlot(db, { monitorId: mId, startedAt: BASE, intervalS: 60, status: 0, attempts: 1, recoveredAfterS: null, latencyMs: 10, error: null, certDaysLeft: null })
  rollupDaily(db, BASE, BASE + DAY, 'UTC')
  rollupDaily(db, BASE, BASE + DAY, 'UTC')
  const rows = dailyInRange(db, mId, '2026-01-02', '2026-01-02')
  expect(rows.length).toBe(1)
  expect(rows[0]!.up).toBe(1)
})

test('latency p50/p95 from successful slots', () => {
  const { db, sql, mId } = setup()
  for (let i = 0; i < 100; i++) {
    insertSlot(db, { monitorId: mId, startedAt: BASE + i * 60, intervalS: 60, status: 0, attempts: 1, recoveredAfterS: null, latencyMs: (i + 1) * 10, error: null, certDaysLeft: null })
  }
  rollupDaily(db, BASE, BASE + DAY, 'UTC')
  const r = dailyInRange(db, mId, '2026-01-02', '2026-01-02')[0]!
  expect(r.latencyP50).toBe(500)                   // ceil(0.5*100)=50 → sorted[49]=500
  expect(r.latencyP95).toBe(950)
})

test('cross-timezone day cut: same slots roll up to different days', () => {
  const { db, sql, mId } = setup()
  insertSlot(db, { monitorId: mId, startedAt: BASE - 3600, intervalS: 60, status: 0, attempts: 1, recoveredAfterS: null, latencyMs: 5, error: null, certDaysLeft: null }) // UTC 2026-01-01 23:00
  rollupDaily(db, BASE - 7200, BASE + DAY, 'UTC')
  expect(dailyInRange(db, mId, '2026-01-01', '2026-01-01').length).toBe(1)
  rebuildDaily(db, [mId], BASE - 7200, BASE + DAY, 'Asia/Shanghai')
  expect(dailyInRange(db, mId, '2026-01-01', '2026-01-01').length).toBe(0)
  expect(dailyInRange(db, mId, '2026-01-02', '2026-01-02').length).toBe(1) // CST 07:00 → 1-02
})
