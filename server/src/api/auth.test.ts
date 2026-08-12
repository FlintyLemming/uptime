import { beforeEach, expect, test } from 'bun:test'
import { openDb } from '../db/client'
import { runMigrations, seedSettings } from '../db/migrate'
import { buildAuthRoutes } from './auth'
import { clearAllSessionsForTest } from './middleware/auth'
import { resetLoginLimiterForTest } from './middleware/ratelimit'

function setup() {
  const { db, sql } = openDb(':memory:')
  runMigrations(db, sql)
  seedSettings(db)
  clearAllSessionsForTest()
  resetLoginLimiterForTest()
  return buildAuthRoutes(db)
}

test('setup-status reports hasUser=false then true', async () => {
  const app = setup()
  let r = await app.request('/setup-status')
  expect(await r.json()).toEqual({ hasUser: false })
  await app.request('/setup', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'password123' }), headers: { 'content-type': 'application/json' } })
  r = await app.request('/setup-status')
  expect(await r.json()).toEqual({ hasUser: true })
})

test('setup creates user and logs in; second setup is 409', async () => {
  const app = setup()
  const r1 = await app.request('/setup', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'password123' }), headers: { 'content-type': 'application/json' } })
  expect(r1.status).toBe(200)
  expect(r1.headers.get('set-cookie')).toContain('uptime_session')
  const r2 = await app.request('/setup', { method: 'POST', body: JSON.stringify({ username: 'x', password: 'password123' }), headers: { 'content-type': 'application/json' } })
  expect(r2.status).toBe(409)
})

test('setup rejects short password with 400', async () => {
  const app = setup()
  const r = await app.request('/setup', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'short' }), headers: { 'content-type': 'application/json' } })
  expect(r.status).toBe(400)
})

test('login success sets cookie; wrong password gives 401', async () => {
  const app = setup()
  await app.request('/setup', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'password123' }), headers: { 'content-type': 'application/json' } })
  const bad = await app.request('/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'wrong' }), headers: { 'content-type': 'application/json' } })
  expect(bad.status).toBe(401)
  const good = await app.request('/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'password123' }), headers: { 'content-type': 'application/json' } })
  expect(good.status).toBe(200)
  expect(good.headers.get('set-cookie')).toContain('uptime_session')
})

test('rate limit: 5 failures lock for 15 minutes (429 with retry_after_s)', async () => {
  const app = setup()
  await app.request('/setup', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'password123' }), headers: { 'content-type': 'application/json' } })
  for (let i = 0; i < 5; i++) {
    await app.request('/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'no' }), headers: { 'content-type': 'application/json' } })
  }
  const locked = await app.request('/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'password123' }), headers: { 'content-type': 'application/json' } })
  expect(locked.status).toBe(429)
  const body = await locked.json() as { retry_after_s: number }
  expect(body.retry_after_s).toBeGreaterThan(0)
})

test('me returns 401 without session, username with session', async () => {
  const app = setup()
  expect((await app.request('/me')).status).toBe(401)
  const setupRes = await app.request('/setup', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'password123' }), headers: { 'content-type': 'application/json' } })
  const cookie = setupRes.headers.get('set-cookie')!.split(';')[0]!
  const me = await app.request('/me', { headers: { cookie } })
  expect(me.status).toBe(200)
  expect(await me.json()).toEqual({ username: 'admin' })
})

test('logout invalidates session', async () => {
  const app = setup()
  const setupRes = await app.request('/setup', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'password123' }), headers: { 'content-type': 'application/json' } })
  const cookie = setupRes.headers.get('set-cookie')!.split(';')[0]!
  await app.request('/logout', { method: 'POST', headers: { cookie } })
  expect((await app.request('/me', { headers: { cookie } })).status).toBe(401)
})
