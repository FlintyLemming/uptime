import { expect, test, beforeAll, afterAll } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { openDb } from '../db/client'
import { runMigrations, seedSettings } from '../db/migrate'
import { buildApp } from './app'

const DIR = '/tmp/uptime-static-test'

beforeAll(() => {
  rmSync(DIR, { recursive: true, force: true })
  mkdirSync(`${DIR}/assets`, { recursive: true })
  writeFileSync(`${DIR}/index.html`, '<!doctype html><html><body>spa</body></html>')
  writeFileSync(`${DIR}/assets/app.js`, 'console.log(1)')
})

afterAll(() => rmSync(DIR, { recursive: true, force: true }))

function setup() {
  const { db, sql } = openDb(':memory:')
  runMigrations(db, sql)
  seedSettings(db)
  return buildApp(db, sql, { publicDir: DIR })
}

test('serves index.html at /', async () => {
  const r = await setup().request('/')
  expect(r.status).toBe(200)
  expect(await r.text()).toContain('spa')
})

test('serves built assets', async () => {
  const r = await setup().request('/assets/app.js')
  expect(r.status).toBe(200)
  expect(await r.text()).toContain('console.log')
})

test('spa fallback: unknown path returns index.html', async () => {
  const r = await setup().request('/admin/monitors/new')
  expect(r.status).toBe(200)
  expect(await r.text()).toContain('spa')
})

test('api routes are not shadowed by fallback', async () => {
  const app = setup()
  expect((await app.request('/api/status')).status).toBe(200)
  expect((await app.request('/healthz')).status).toBe(200)
})

test('no publicDir -> api-only mode still 404s unknown paths', async () => {
  const { db, sql } = openDb(':memory:')
  runMigrations(db, sql)
  seedSettings(db)
  const app = buildApp(db, sql, { publicDir: '/tmp/definitely-missing-dir' })
  expect((await app.request('/anything')).status).toBe(404)
})
