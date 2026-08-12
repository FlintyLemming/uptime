import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import type { DrizzleDb } from '../db/client'
import { requireAuth } from './middleware/auth'
import { buildAuthRoutes } from './auth'
import { buildStatusRoutes } from './status'
import { buildTimeseriesRoutes } from './timeseries'
import { buildMonitorRoutes } from './monitors'
import { buildGroupRoutes } from './groups'
import { buildWebhookRoutes } from './webhooks'
import { buildSettingsRoutes, buildPasswordRoutes } from './settings'

export function buildApp(db: DrizzleDb, sql: Database, opts: { rebuildDaily?: () => void } = {}) {
  const app = new Hono()

  app.get('/healthz', (c) => {
    try { sql.query('SELECT 1').get(); return c.json({ ok: true, db: 'ok' }) }
    catch { return c.json({ ok: false, db: 'error' }, 503) }
  })

  app.route('/api/auth', buildAuthRoutes(db))
  app.route('/api/status', buildStatusRoutes(db))
  app.route('/api/monitors', buildTimeseriesRoutes(db))

  app.use('/api/admin/*', requireAuth)
  app.route('/api/admin/monitors', buildMonitorRoutes(db))
  app.route('/api/admin/groups', buildGroupRoutes(db))
  app.route('/api/admin/webhooks', buildWebhookRoutes(db))
  app.route('/api/admin/settings', buildSettingsRoutes(db, { onTimezoneChange: () => opts.rebuildDaily?.() }))
  // settings 的 /password 子路径按设计文档 §8.2 挂在 /api/admin/password
  app.route('/api/admin/password', buildPasswordRoutes(db))

  app.notFound((c) => c.json({ error: 'not found' }, 404))
  return app
}
