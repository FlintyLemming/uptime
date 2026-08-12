import { Hono } from 'hono'
import { asc } from 'drizzle-orm'
import type { DrizzleDb } from '../db/client'
import { monitorGroup } from '../db/schema'
import { listMonitors } from '../store/monitors'
import { slotsInRange, latestSlot } from '../store/slots'
import { dailyInRange } from '../store/daily'
import { getSettings } from '../store/settings'
import { buildStatusPayload, type Range, type GroupInput } from './aggregate'

function dayInTz(sec: number, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(sec * 1000))
}

export function buildStatusRoutes(db: DrizzleDb) {
  const app = new Hono()

  app.get('/', (c) => {
    const range = (c.req.query('range') ?? '90d') as Range
    if (!['90d', '30d', '24h'].includes(range)) return c.json({ error: 'invalid range' }, 400)
    const settings = getSettings(db)
    const nowSec = Math.floor(Date.now() / 1000)
    const monitors = listMonitors(db)
    const groups = db.select().from(monitorGroup).orderBy(asc(monitorGroup.sortOrder), asc(monitorGroup.id)).all()

    const groupInputs: GroupInput[] = groups.map((g) => ({ id: g.id, name: g.name, monitors: [] }))
    const ungrouped: GroupInput = { id: null, name: '未分组', monitors: [] }

    const byGroup = new Map<number | null, GroupInput>(groupInputs.map((g) => [g.id, g]))
    byGroup.set(null, ungrouped)

    for (const m of monitors) {
      const daily = range === '24h' ? [] : (() => {
        const n = range === '30d' ? 30 : 90
        const fromDay = dayInTz(nowSec - (n - 1) * 86400, settings.display_timezone)
        const toDay = dayInTz(nowSec, settings.display_timezone)
        return dailyInRange(db, m.id, fromDay, toDay)
      })()
      const slots = range === '24h'
        ? slotsInRange(db, m.id, nowSec - 86400, nowSec + 1).map((s) => ({ startedAt: s.startedAt, status: s.status, intervalS: s.intervalS, recoveredAfterS: s.recoveredAfterS }))
        : []
      const latest = latestSlot(db, m.id)
      const gi = (m.groupId !== null ? byGroup.get(m.groupId) : undefined) ?? ungrouped
      gi.monitors.push({ id: m.id, name: m.name, daily, slots, currentStatus: latest ? latest.status : null, intervalS: m.intervalS })
    }

    // 有名分组只保留有成员的；「未分组」恒在（可能为空），排在最后
    const ordered = [...groupInputs.filter((g) => g.monitors.length > 0), ungrouped]

    return c.json(buildStatusPayload({ siteTitle: settings.site_title, timezone: settings.display_timezone, range, nowSec, groups: ordered }))
  })

  return app
}
