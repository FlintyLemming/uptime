import { expect, test } from 'bun:test'
import { openDb } from '../db/client'
import { runMigrations, seedSettings } from '../db/migrate'
import { monitor, monitorGroup } from '../db/schema'
import { insertSlot } from '../store/slots'
import { upsertDaily } from '../store/daily'
import { buildStatusRoutes } from './status'
import { buildTimeseriesRoutes } from './timeseries'

function setup() {
  const { db, sql } = openDb(':memory:')
  runMigrations(db, sql)
  seedSettings(db)
  return { db, sql }
}

test('GET /api/status returns full page payload with grouping', async () => {
  const { db } = setup()
  const now = Math.floor(Date.now() / 1000)
  const gId = db.insert(monitorGroup).values({ name: 'API' }).returning({ id: monitorGroup.id }).get()!.id
  const mId = db.insert(monitor).values({ groupId: gId, name: 'a', type: 'http', target: 'https://a.com', intervalS: 60, createdAt: now, updatedAt: now })
    .returning({ id: monitor.id }).get()!.id
  insertSlot(db, { monitorId: mId, startedAt: Math.floor(now / 60) * 60 - 60, intervalS: 60, status: 0, attempts: 1, recoveredAfterS: null, latencyMs: 9, error: null, certDaysLeft: null })
  const app = buildStatusRoutes(db)
  const r = await app.request('/?range=24h')
  expect(r.status).toBe(200)
  const body = await r.json() as any
  expect(body.site_title).toBe('Status')
  expect(body.groups.length).toBe(1)               // 只有 API 组
  expect(body.groups[0].name).toBe('API')
  expect(body.overall).toBe('operational')
  expect(body.groups[0].monitors[0].bars.length).toBe(1440)
})

test('GET /api/status omits empty 未分组 when all monitors are grouped', async () => {
  const { db } = setup()
  const now = Math.floor(Date.now() / 1000)
  const gId = db.insert(monitorGroup).values({ name: 'API' }).returning({ id: monitorGroup.id }).get()!.id
  for (const name of ['a', 'b']) {
    const mId = db.insert(monitor).values({ groupId: gId, name, type: 'http', target: `https://${name}.com`, intervalS: 60, createdAt: now, updatedAt: now })
      .returning({ id: monitor.id }).get()!.id
    insertSlot(db, { monitorId: mId, startedAt: Math.floor(now / 60) * 60 - 60, intervalS: 60, status: 0, attempts: 1, recoveredAfterS: null, latencyMs: 9, error: null, certDaysLeft: null })
  }
  const r = await buildStatusRoutes(db).request('/?range=24h')
  const body = await r.json() as any
  expect(body.groups.length).toBe(1)               // 只有 API 组，无空「未分组」
  expect(body.groups[0].name).toBe('API')
})

test('GET /api/status rejects invalid range', async () => {
  const { db } = setup()
  const r = await buildStatusRoutes(db).request('/?range=bogus')
  expect(r.status).toBe(400)
  // 7d 是详情页专属档位，状态页不支持
  expect((await buildStatusRoutes(db).request('/?range=7d')).status).toBe(400)
})

test('GET /api/status hour ranges (1h/12h) return slot bars scaled to range', async () => {
  const { db } = setup()
  const now = Math.floor(Date.now() / 1000)
  const mId = db.insert(monitor).values({ name: 'a', type: 'http', target: 'https://a.com', intervalS: 60, createdAt: now, updatedAt: now })
    .returning({ id: monitor.id }).get()!.id
  insertSlot(db, { monitorId: mId, startedAt: Math.floor(now / 60) * 60 - 60, intervalS: 60, status: 0, attempts: 1, recoveredAfterS: null, latencyMs: 9, error: null, certDaysLeft: null })
  const app = buildStatusRoutes(db)
  const r1 = await app.request('/?range=1h')
  expect(r1.status).toBe(200)
  const b1 = await r1.json() as any
  expect(b1.groups[0].monitors[0].bars.length).toBe(60)
  expect(b1.groups[0].monitors[0].bars.filter((b: any) => b.s === 0).length).toBe(1)
  const r12 = await app.request('/?range=12h')
  expect(r12.status).toBe(200)
  const b12 = await r12.json() as any
  expect(b12.groups[0].monitors[0].bars.length).toBe(720)
  // slot 落在窗口内：bars 与 slots_meta 各有一个非空位（位置随 now 与 slot 边界对齐浮动，故不断言下标）
  expect(b12.groups[0].monitors[0].slots_meta.filter((x: any) => x !== null).length).toBe(1)
  expect(b12.groups[0].monitors[0].daily).toEqual([])
})

test('GET /api/status 90d reads slot_daily', async () => {
  const { db } = setup()
  const now = Math.floor(Date.now() / 1000)
  const mId = db.insert(monitor).values({ name: 'a', type: 'http', target: 'https://a.com', intervalS: 60, createdAt: now, updatedAt: now })
    .returning({ id: monitor.id }).get()!.id
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' })
  const today = fmt.format(new Date(now * 1000))
  upsertDaily(db, { monitorId: mId, day: today, up: 100, flaky: 2, down: 0, nodata: 0, downSeconds: 0, latencyP50: 10, latencyP95: 20 })
  const r = await buildStatusRoutes(db).request('/?range=90d')
  const body = await r.json() as any
  const mon = body.groups.find((g: any) => g.id === null).monitors[0]
  expect(mon.flaky_count).toBe(2)
  expect(mon.bars.filter((b: any) => b.s === 1).length).toBe(1)
})

test('GET /api/monitors/:id/timeseries returns slots and daily', async () => {
  const { db } = setup()
  const now = Math.floor(Date.now() / 1000)
  const mId = db.insert(monitor).values({ name: 'a', type: 'http', target: 'https://a.com', intervalS: 60, createdAt: now, updatedAt: now })
    .returning({ id: monitor.id }).get()!.id
  insertSlot(db, { monitorId: mId, startedAt: now - 30, intervalS: 60, status: 1, attempts: 2, recoveredAfterS: 20, latencyMs: 15, error: null, certDaysLeft: 30 })
  const app = buildTimeseriesRoutes(db)
  const r = await app.request(`/${mId}/timeseries?range=24h`)
  expect(r.status).toBe(200)
  const body = await r.json() as any
  expect(body.monitor.id).toBe(mId)
  expect(body.slots.length).toBe(1)
  expect(body.slots[0].cert_days_left).toBe(30)
  expect((await app.request('/999/timeseries?range=24h')).status).toBe(404)
})

test('GET /api/monitors/:id/timeseries accepts hour ranges and returns bounded range_seconds', async () => {
  const { db } = setup()
  const now = Math.floor(Date.now() / 1000)
  const mId = db.insert(monitor).values({ name: 'a', type: 'http', target: 'https://a.com', intervalS: 60, createdAt: now, updatedAt: now })
    .returning({ id: monitor.id }).get()!.id
  // 窗口内 1 个 slot，窗口外 1 个（now-3700 早于 1h 起点 now-3600）
  insertSlot(db, { monitorId: mId, startedAt: now - 3700, intervalS: 60, status: 0, attempts: 1, recoveredAfterS: null, latencyMs: 9, error: null, certDaysLeft: null })
  insertSlot(db, { monitorId: mId, startedAt: now - 3000, intervalS: 60, status: 0, attempts: 1, recoveredAfterS: null, latencyMs: 9, error: null, certDaysLeft: null })
  const app = buildTimeseriesRoutes(db)
  const r = await app.request(`/${mId}/timeseries?range=1h`)
  expect(r.status).toBe(200)
  const body = await r.json() as any
  expect(body.range_seconds).toBe(3600)
  expect(body.slots.length).toBe(1)                // 仅 now-3000 落在最近 1h 内
  expect(body.slots[0].started_at).toBe(now - 3000)
  expect((await app.request(`/${mId}/timeseries?range=90d`)).status).toBe(200)  // 详情页未列出 90d 但后端共享档位表，不拒绝
})
