import { mkdirSync } from 'node:fs'
import { loadConfig } from './config'
import { openDb } from './db/client'
import { runMigrations, seedSettings } from './db/migrate'
import { startScheduler } from './scheduler/scheduler'
import { rollupDaily, rebuildDaily } from './rollup/daily'
import { runRetention } from './rollup/retention'
import { getSettings } from './store/settings'
import { listMonitors } from './store/monitors'
import { buildApp } from './api/app'

export function main() {
  const cfg = loadConfig()
  mkdirSync(cfg.dataDir, { recursive: true })

  const { db, sql } = openDb(cfg.dbFile)
  try {
    runMigrations(db, sql)
    seedSettings(db)
  } catch (e) {
    console.error('migration failed, refusing to start with partial schema:', e)
    process.exit(1)
  }

  const sched = startScheduler({ db, sql, getNow: () => Date.now() / 1000, probeConcurrency: cfg.probeConcurrency, baseUrl: `http://localhost:${cfg.port}` })

  const hourlyJob = () => {
    try {
      const settings = getSettings(db)
      const nowSec = Math.floor(Date.now() / 1000)
      rollupDaily(db, nowSec - settings.slot_retention_days * 86400, nowSec + 1, settings.display_timezone)
      runRetention(db, sql, nowSec)
    } catch (e) { console.error('hourly rollup/retention failed:', e) }
  }
  const firstTimer = setTimeout(hourlyJob, 10_000)
  const hourlyTimer = setInterval(hourlyJob, 3_600_000)

  const app = buildApp(db, sql, {
    rebuildDaily: () => {
      const settings = getSettings(db)
      const nowSec = Math.floor(Date.now() / 1000)
      rebuildDaily(db, listMonitors(db).map((m) => m.id), nowSec - settings.slot_retention_days * 86400, nowSec + 1, settings.display_timezone)
    },
  })

  const server = Bun.serve({ port: cfg.port, fetch: app.fetch })
  console.log(`uptime listening on :${cfg.port}`)

  const shutdown = () => { sched.stop(); clearTimeout(firstTimer); clearInterval(hourlyTimer); server.stop(); process.exit(0) }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

if (import.meta.main) main()
