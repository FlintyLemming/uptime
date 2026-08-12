import { expect, test } from 'bun:test'
import { openDb } from '../db/client'
import { runMigrations, seedSettings } from '../db/migrate'
import { buildMonitorRoutes } from './monitors'
import { buildGroupRoutes } from './groups'
import { buildWebhookRoutes } from './webhooks'
import { buildSettingsRoutes } from './settings'

function setup() {
  const { db, sql } = openDb(':memory:')
  runMigrations(db, sql)
  seedSettings(db)
  return { db, sql }
}

const MONITOR_INPUT = { group_id: null, name: 'a', type: 'http', target: 'https://a.com', port: null, interval_s: 60, retry_interval_s: 20, max_retries: 3, timeout_ms: 10000, active: 1, sort_order: 0, config: {} }

test('monitor CRUD roundtrip', async () => {
  const { db } = setup()
  const app = buildMonitorRoutes(db)
  const created = await app.request('/', { method: 'POST', body: JSON.stringify(MONITOR_INPUT), headers: { 'content-type': 'application/json' } })
  expect(created.status).toBe(201)
  const row = await created.json() as any
  const list = await (await app.request('/')).json() as any[]
  expect(list.length).toBe(1)
  const patched = await app.request(`/${row.id}`, { method: 'PATCH', body: JSON.stringify({ ...MONITOR_INPUT, name: 'b' }), headers: { 'content-type': 'application/json' } })
  expect(((await patched.json()) as any).name).toBe('b')
  const del = await app.request(`/${row.id}`, { method: 'DELETE' })
  expect(del.status).toBe(204)
})

test('monitor create rejects timeout >= retry_interval*1000', async () => {
  const { db } = setup()
  const app = buildMonitorRoutes(db)
  const r = await app.request('/', { method: 'POST', body: JSON.stringify({ ...MONITOR_INPUT, timeout_ms: 20000 }), headers: { 'content-type': 'application/json' } })
  expect(r.status).toBe(400)
  expect(JSON.stringify(await r.json())).toContain('timeout_ms')
})

test('monitor reorder persists sort order', async () => {
  const { db } = setup()
  const app = buildMonitorRoutes(db)
  const a = await (await app.request('/', { method: 'POST', body: JSON.stringify(MONITOR_INPUT), headers: { 'content-type': 'application/json' } })).json() as any
  const b = await (await app.request('/', { method: 'POST', body: JSON.stringify({ ...MONITOR_INPUT, name: 'b' }), headers: { 'content-type': 'application/json' } })).json() as any
  await app.request('/reorder', { method: 'POST', body: JSON.stringify({ ids: [b.id, a.id] }), headers: { 'content-type': 'application/json' } })
  const list = await (await app.request('/')).json() as any[]
  expect(list.map((m) => m.id)).toEqual([b.id, a.id])
})

test('group CRUD', async () => {
  const { db } = setup()
  const app = buildGroupRoutes(db)
  const created = await app.request('/', { method: 'POST', body: JSON.stringify({ name: 'API', sort_order: 0 }), headers: { 'content-type': 'application/json' } })
  expect(created.status).toBe(201)
  const g = await created.json() as any
  const patched = await app.request(`/${g.id}`, { method: 'PATCH', body: JSON.stringify({ name: 'APIs', sort_order: 1 }), headers: { 'content-type': 'application/json' } })
  expect(((await patched.json()) as any).name).toBe('APIs')
  expect((await app.request(`/${g.id}`, { method: 'DELETE' })).status).toBe(204)
})

test('webhook CRUD and test-send uses injected dispatcher', async () => {
  const { db } = setup()
  const sent: string[] = []
  const app = buildWebhookRoutes(db, { dispatchImpl: async (o) => { sent.push(o.body); return { ok: true, attempts: 1 } } })
  const created = await app.request('/', { method: 'POST', body: JSON.stringify({ name: 'w', url: 'https://hook.example.com', method: 'POST', headers: {}, body_template: '{"e":"{{event}}","m":"{{monitor_name}}"}', enabled: 1, monitor_ids: null }), headers: { 'content-type': 'application/json' } })
  expect(created.status).toBe(201)
  const w = await created.json() as any
  const testRes = await app.request(`/${w.id}/test`, { method: 'POST' })
  expect(testRes.status).toBe(200)
  expect(sent.length).toBe(1)
  const parsed = JSON.parse(sent[0]!)
  expect(parsed.e).toBe('down')
  expect(typeof parsed.m).toBe('string')
})

test('settings GET/PUT and timezone change callback', async () => {
  const { db } = setup()
  const rebuilds: string[] = []
  const app = buildSettingsRoutes(db, { onTimezoneChange: (tz) => { rebuilds.push(tz) } })
  const cur = await (await app.request('/')).json() as any
  expect(cur.display_timezone).toBe('Asia/Shanghai')
  await app.request('/', { method: 'PUT', body: JSON.stringify({ display_timezone: 'UTC' }), headers: { 'content-type': 'application/json' } })
  expect(rebuilds).toEqual(['UTC'])
  expect(((await (await app.request('/')).json()) as any).display_timezone).toBe('UTC')
})

test('settings PUT rejects slot_retention_days < 90', async () => {
  const { db } = setup()
  const app = buildSettingsRoutes(db, { onTimezoneChange: () => {} })
  const r = await app.request('/', { method: 'PUT', body: JSON.stringify({ slot_retention_days: 30 }), headers: { 'content-type': 'application/json' } })
  expect(r.status).toBe(400)
})
