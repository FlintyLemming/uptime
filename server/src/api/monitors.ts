import { Hono } from 'hono'
import type { DrizzleDb } from '../db/client'
import * as ms from '../store/monitors'
import { monitorGroup } from '../db/schema'
import { getProbe, probeConfigFromMonitor } from '../probes'

function toInput(body: any): ms.MonitorInput {
  return {
    groupId: body.group_id ?? null, name: body.name ?? '', type: body.type ?? '', target: body.target ?? '',
    port: body.port ?? null, intervalS: Number(body.interval_s ?? 60), retryIntervalS: Number(body.retry_interval_s ?? 20),
    maxRetries: Number(body.max_retries ?? 3), timeoutMs: Number(body.timeout_ms ?? 10000),
    active: body.active === 0 ? 0 : 1, sortOrder: Number(body.sort_order ?? 0), config: body.config ?? {},
  }
}

function toJson(row: ms.MonitorRow, groupName: string | null) {
  return {
    id: row.id, group_id: row.groupId, group_name: groupName, name: row.name, type: row.type, target: row.target,
    port: row.port, interval_s: row.intervalS, retry_interval_s: row.retryIntervalS, max_retries: row.maxRetries,
    timeout_ms: row.timeoutMs, active: row.active, sort_order: row.sortOrder, config: JSON.parse(row.config),
    created_at: row.createdAt, updated_at: row.updatedAt,
  }
}

export function buildMonitorRoutes(db: DrizzleDb) {
  const app = new Hono()

  app.get('/', (c) => {
    const groups = new Map(db.select().from(monitorGroup).all().map((g) => [g.id, g.name]))
    return c.json(ms.listMonitors(db).map((m) => toJson(m, m.groupId ? groups.get(m.groupId) ?? null : null)))
  })

  app.post('/', async (c) => {
    const input = toInput(await c.req.json())
    const errors = ms.validateMonitor(input)
    if (errors.length) return c.json({ error: 'validation failed', errors }, 400)
    return c.json(toJson(ms.createMonitor(db, input), null), 201)
  })

  app.patch('/:id', async (c) => {
    const id = Number(c.req.param('id'))
    const input = toInput(await c.req.json())
    const errors = ms.validateMonitor(input)
    if (errors.length) return c.json({ error: 'validation failed', errors }, 400)
    const row = ms.updateMonitor(db, id, input)
    if (!row) return c.json({ error: 'not found' }, 404)
    return c.json(toJson(row, null))
  })

  app.delete('/:id', (c) => {
    ms.deleteMonitor(db, Number(c.req.param('id')))
    return c.body(null, 204)
  })

  app.post('/reorder', async (c) => {
    const body = await c.req.json<{ ids: number[] }>()
    ms.reorderMonitors(db, body.ids ?? [])
    return c.json({ ok: true })
  })

  app.post('/:id/test', async (c) => {
    const id = Number(c.req.param('id'))
    const row = ms.getMonitor(db, id)
    if (!row) return c.json({ error: 'not found' }, 404)
    const cfg = ms.toRuntimeConfig(row)
    const result = await getProbe(cfg.type).run(probeConfigFromMonitor(cfg), AbortSignal.timeout(cfg.timeoutMs + 1000))
    return c.json({ ok: result.ok, latency_ms: result.latencyMs, error: result.error, cert_days_left: result.certDaysLeft })
  })

  return app
}
