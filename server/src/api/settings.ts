import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import type { DrizzleDb } from '../db/client'
import { user } from '../db/schema'
import { getSettings, setSetting, validateSettings, type Settings } from '../store/settings'

export function buildSettingsRoutes(db: DrizzleDb, deps: { onTimezoneChange: (newTz: string) => void }) {
  const app = new Hono()

  app.get('/', (c) => c.json(getSettings(db)))

  app.put('/', async (c) => {
    const body = await c.req.json<Partial<Settings>>()
    const errors = validateSettings(body)
    if (errors.length) return c.json({ error: 'validation failed', errors }, 400)
    const prev = getSettings(db)
    if (body.display_timezone !== undefined) setSetting(db, 'display_timezone', body.display_timezone)
    if (body.site_title !== undefined) setSetting(db, 'site_title', body.site_title)
    if (body.slot_retention_days !== undefined) setSetting(db, 'slot_retention_days', String(body.slot_retention_days))
    if (body.attempt_retention_days !== undefined) setSetting(db, 'attempt_retention_days', String(body.attempt_retention_days))
    if (body.display_timezone !== undefined && body.display_timezone !== prev.display_timezone) {
      deps.onTimezoneChange(body.display_timezone)
    }
    return c.json(getSettings(db))
  })

  app.post('/password', async (c) => {
    const body = await c.req.json<{ current?: string; next?: string }>()
    const row = db.select().from(user).get()
    if (!row) return c.json({ error: 'no user' }, 404)
    if (!body.current || !(await Bun.password.verify(body.current, row.passwordHash))) {
      return c.json({ error: 'current password is incorrect' }, 401)
    }
    if (!body.next || body.next.length < 8) return c.json({ error: 'new password must be at least 8 characters' }, 400)
    const passwordHash = await Bun.password.hash(body.next, { algorithm: 'argon2id' })
    db.update(user).set({ passwordHash }).where(eq(user.id, row.id)).run()
    return c.json({ ok: true })
  })

  return app
}
