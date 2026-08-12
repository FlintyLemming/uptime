import { Hono } from 'hono'
import type { DrizzleDb } from '../db/client'
import { getMonitor } from '../store/monitors'
import { slotsInRange } from '../store/slots'
import { dailyInRange } from '../store/daily'
import { getSettings } from '../store/settings'

import { RANGE_SECONDS, type Range } from './aggregate'

export function buildTimeseriesRoutes(db: DrizzleDb) {
  const app = new Hono()

  app.get('/:id/timeseries', (c) => {
    const id = Number(c.req.param('id'))
    const m = getMonitor(db, id)
    if (!m) return c.json({ error: 'monitor not found' }, 404)
    const range = c.req.query('range') ?? '24h'
    if (!(range in RANGE_SECONDS)) return c.json({ error: 'invalid range' }, 400)
    const settings = getSettings(db)
    const nowSec = Math.floor(Date.now() / 1000)
    const rangeSec = RANGE_SECONDS[range as Range]!
    const slots = slotsInRange(db, id, nowSec - rangeSec, nowSec + 1).map((s) => ({
      started_at: s.startedAt, status: s.status, latency_ms: s.latencyMs, error: s.error,
      attempts: s.attempts, recovered_after_s: s.recoveredAfterS, cert_days_left: s.certDaysLeft,
    }))
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: settings.display_timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
    const fromDay = fmt.format(new Date((nowSec - rangeSec) * 1000))
    const toDay = fmt.format(new Date(nowSec * 1000))
    const daily = dailyInRange(db, id, fromDay, toDay).map((d) => ({
      day: d.day, up: d.up, flaky: d.flaky, down: d.down, nodata: d.nodata,
      down_seconds: d.downSeconds, latency_p50: d.latencyP50, latency_p95: d.latencyP95,
    }))
    return c.json({
      monitor: { id: m.id, name: m.name, type: m.type, target: m.target, interval_s: m.intervalS, config: JSON.parse(m.config) },
      slots, daily, range_seconds: rangeSec,
    })
  })

  return app
}
