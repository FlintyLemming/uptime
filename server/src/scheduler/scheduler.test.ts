import { expect, test } from 'bun:test'
import { openDb } from '../db/client'
import { runMigrations, seedSettings } from '../db/migrate'
import { monitor, slot } from '../db/schema'
import { count, eq } from 'drizzle-orm'
import { startScheduler } from './scheduler'
import { createWebhook } from '../store/webhooks'
import type { Probe } from '../probes/types'

function setup(intervalS: number) {
  const { db, sql } = openDb(':memory:')
  runMigrations(db, sql)
  seedSettings(db)
  const now = Math.floor(Date.now() / 1000)
  const mId = db.insert(monitor).values({
    name: 'm', type: 'http', target: 'https://a.com', intervalS,
    retryIntervalS: 1, maxRetries: 1, timeoutMs: 500, active: 1,
    createdAt: now, updatedAt: now,
  }).returning({ id: monitor.id }).get().id
  return { db, sql, mId }
}

const okProbe: Probe = { async run() { return { ok: true, latencyMs: 5, error: null, certDaysLeft: null } } }

test('scheduler writes exactly one slot row per boundary, probe called once for up', async () => {
  const { db, sql, mId } = setup(1)
  const sched = startScheduler({ db, sql, getNow: () => Date.now() / 1000, setIntervalMs: 50, probeConcurrency: 5, probeFactory: () => okProbe })
  await Bun.sleep(2600)                            // 跨过至少 2 个边界
  sched.stop()
  const rows = db.select({ c: count() }).from(slot).where(eq(slot.monitorId, mId)).get()!.c
  expect(rows).toBeGreaterThanOrEqual(1)
  const latest = db.select().from(slot).orderBy(slot.startedAt).all()
  const starts = latest.map((r) => r.startedAt)
  expect(new Set(starts).size).toBe(starts.length) // 无重复边界
  for (const r of latest) expect(r.intervalS).toBe(1)
})

test('inactive monitor is not probed', async () => {
  const { db, sql, mId } = setup(1)
  db.update(monitor).set({ active: 0 }).where(eq(monitor.id, mId)).run()
  const sched = startScheduler({ db, sql, getNow: () => Date.now() / 1000, setIntervalMs: 50, probeConcurrency: 5, probeFactory: () => okProbe })
  await Bun.sleep(1600)
  sched.stop()
  expect(db.select({ c: count() }).from(slot).get()!.c).toBe(0)
})

test('down transition fires dispatch exactly once', async () => {
  const failProbe: Probe = { async run() { return { ok: false, latencyMs: null, error: 'down', certDaysLeft: null } } }
  const { db, sql } = setup(1)
  createWebhook(db, {
    name: 'w', url: 'http://hook', method: 'POST', headers: {},
    bodyTemplate: '{"event":"{{event}}"}', enabled: 1, monitorIds: null,
  })
  const dispatched: string[] = []
  const sched = startScheduler({
    db, sql, getNow: () => Date.now() / 1000, setIntervalMs: 50, probeConcurrency: 5,
    probeFactory: () => failProbe,
    dispatchImpl: async (o) => { dispatched.push(o.body); return { ok: true, attempts: 1 } },
  })
  await Bun.sleep(2600)                            // 至少 2 个 down slot
  sched.stop()
  expect(dispatched.length).toBe(1)                // 连续 down 只报第一次
  expect(dispatched[0]).toContain('"event":"down"')
})
