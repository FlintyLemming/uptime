import { expect, test } from 'bun:test'
import { openDb } from '../db/client'
import { runMigrations, seedSettings } from '../db/migrate'
import { buildApp } from './app'
import { clearAllSessionsForTest } from './middleware/auth'
import { resetLoginLimiterForTest } from './middleware/ratelimit'

function setup() {
  const { db, sql } = openDb(':memory:')
  runMigrations(db, sql)
  seedSettings(db)
  clearAllSessionsForTest()
  resetLoginLimiterForTest()
  return buildApp(db, sql, { rebuildDaily: () => {} })
}

test('healthz returns ok', async () => {
  const app = setup()
  const r = await app.request('/healthz')
  expect(r.status).toBe(200)
  expect(await r.json()).toEqual({ ok: true, db: 'ok' })
})

test('admin endpoints require session (401 without cookie)', async () => {
  const app = setup()
  for (const path of ['/api/admin/monitors', '/api/admin/groups', '/api/admin/webhooks', '/api/admin/settings']) {
    expect((await app.request(path)).status).toBe(401)
  }
})

test('public endpoints are open', async () => {
  const app = setup()
  expect((await app.request('/api/status')).status).toBe(200)
  expect((await app.request('/api/auth/setup-status')).status).toBe(200)
})

test('admin endpoints work after login', async () => {
  const app = setup()
  const setupRes = await app.request('/api/auth/setup', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'password123' }), headers: { 'content-type': 'application/json' } })
  const cookie = setupRes.headers.get('set-cookie')!.split(';')[0]!
  const r = await app.request('/api/admin/monitors', { headers: { cookie } })
  expect(r.status).toBe(200)
})

test('POST /api/admin/password changes password behind requireAuth', async () => {
  const app = setup()
  const setupRes = await app.request('/api/auth/setup', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'password123' }), headers: { 'content-type': 'application/json' } })
  const cookie = setupRes.headers.get('set-cookie')!.split(';')[0]!
  expect((await app.request('/api/admin/password', { method: 'POST', body: JSON.stringify({ current: 'x', next: 'password456' }), headers: { 'content-type': 'application/json' } })).status).toBe(401)
  const ok = await app.request('/api/admin/password', { method: 'POST', body: JSON.stringify({ current: 'password123', next: 'password456' }), headers: { 'content-type': 'application/json', cookie } })
  expect(ok.status).toBe(200)
  const login = await app.request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'password456' }), headers: { 'content-type': 'application/json' } })
  expect(login.status).toBe(200)
})
