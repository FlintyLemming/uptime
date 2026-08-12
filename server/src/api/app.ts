import { Hono } from 'hono'
import { serveStatic } from 'hono/bun'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
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

// serveStatic（hono/bun）的 root 相对进程 cwd，绝对路径经 join 后行为不一致，
// 统一用 root: '/' + rewriteRequestPath 拼成绝对文件路径，cwd 无关。
function serveFrom(dir: string, sub: string) {
  return serveStatic({ root: '/', rewriteRequestPath: () => join(dir, sub) })
}

export function buildApp(db: DrizzleDb, sql: Database, opts: { rebuildDaily?: () => void; publicDir?: string } = {}) {
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

  // 静态托管：显式 publicDir 优先，否则按候选顺序探测（PUBLIC_DIR 环境变量 →
  // 仓库布局的 ../../../web/dist → 容器布局 cwd/web/dist）。目录不存在则保持纯 API 模式。
  const candidates = opts.publicDir
    ? [opts.publicDir]
    : [process.env.PUBLIC_DIR, new URL('../../../web/dist', import.meta.url).pathname, join(process.cwd(), 'web/dist')]
        .filter((p): p is string => Boolean(p))
  const publicDir = candidates.find((dir) => existsSync(join(dir, 'index.html')))

  if (publicDir) {
    const indexHtmlPath = join(publicDir, 'index.html')
    app.use('/assets/*', serveStatic({ root: '/', rewriteRequestPath: (p) => join(publicDir, p) }))
    app.get('/favicon.ico', serveFrom(publicDir, 'favicon.ico'))
    // SPA fallback：除 /api 与 /healthz 外的所有未命中 GET 都返回 index.html
    app.get('*', async (c) => {
      if (c.req.path.startsWith('/api/') || c.req.path === '/healthz') return c.notFound()
      const html = await readFile(indexHtmlPath)
      return c.html(html.toString())
    })
  }

  app.notFound((c) => c.json({ error: 'not found' }, 404))
  return app
}
