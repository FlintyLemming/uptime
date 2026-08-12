import { Hono } from 'hono'
import type { DrizzleDb } from '../db/client'
import * as ws from '../store/webhooks'
import { renderTemplate, formatSlotTime, type TemplateVars } from '../notify/template'
import { dispatchWebhook } from '../notify/dispatcher'
import { getSettings } from '../store/settings'
import { listMonitors } from '../store/monitors'

export const DEFAULT_BODY_TEMPLATE = `{
  "event": "{{event}}",
  "monitor": "{{monitor_name}}",
  "target": "{{target}}",
  "error": "{{error}}",
  "time": "{{slot_started_at}}",
  "url": "{{url}}"
}`

function toInput(body: any): ws.WebhookInput {
  return {
    name: body.name ?? '', url: body.url ?? '', method: body.method ?? 'POST',
    headers: body.headers ?? {}, bodyTemplate: body.body_template ?? DEFAULT_BODY_TEMPLATE,
    enabled: body.enabled === 0 ? 0 : 1, monitorIds: Array.isArray(body.monitor_ids) ? body.monitor_ids : null,
  }
}

export function buildWebhookRoutes(db: DrizzleDb, deps: { dispatchImpl?: typeof dispatchWebhook } = {}) {
  const dispatch = deps.dispatchImpl ?? dispatchWebhook
  const app = new Hono()

  app.get('/', (c) => c.json(ws.listWebhooks(db).map((w) => ({
    id: w.id, name: w.name, url: w.url, method: w.method, headers: JSON.parse(w.headers),
    body_template: w.bodyTemplate, enabled: w.enabled, monitor_ids: w.monitorIds.length ? w.monitorIds : null,
  }))))

  app.post('/', async (c) => {
    const input = toInput(await c.req.json())
    const errors = ws.validateWebhook(input)
    if (errors.length) return c.json({ error: 'validation failed', errors }, 400)
    const row = ws.createWebhook(db, input)
    return c.json({ id: row.id }, 201)
  })

  app.patch('/:id', async (c) => {
    const input = toInput(await c.req.json())
    const errors = ws.validateWebhook(input)
    if (errors.length) return c.json({ error: 'validation failed', errors }, 400)
    const row = ws.updateWebhook(db, Number(c.req.param('id')), input)
    if (!row) return c.json({ error: 'not found' }, 404)
    return c.json({ id: row.id })
  })

  app.delete('/:id', (c) => { ws.deleteWebhook(db, Number(c.req.param('id'))); return c.body(null, 204) })

  app.post('/:id/test', async (c) => {
    const id = Number(c.req.param('id'))
    const w = ws.getWebhook(db, id)
    if (!w) return c.json({ error: 'not found' }, 404)
    const settings = getSettings(db)
    const firstMonitor = listMonitors(db)[0]
    const vars: TemplateVars = {
      event: 'down', monitor_name: firstMonitor?.name ?? 'Test monitor', monitor_type: firstMonitor?.type ?? 'http',
      target: firstMonitor?.target ?? 'https://example.com', group_name: '', status: 'down',
      error: 'test event from uptime admin', attempts: '1',
      slot_started_at: formatSlotTime(Math.floor(Date.now() / 1000), settings.display_timezone),
      down_duration_s: '', url: firstMonitor ? `/m/${firstMonitor.id}` : '',
    }
    const result = await dispatch({ method: w.method, url: w.url, headers: JSON.parse(w.headers), body: renderTemplate(w.bodyTemplate, vars) })
    return c.json({ ok: result.ok, attempts: result.attempts })
  })

  return app
}
