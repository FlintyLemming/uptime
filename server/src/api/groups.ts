import { Hono } from 'hono'
import { asc, eq } from 'drizzle-orm'
import type { DrizzleDb } from '../db/client'
import { monitorGroup } from '../db/schema'

export function buildGroupRoutes(db: DrizzleDb) {
  const app = new Hono()

  app.get('/', (c) => c.json(db.select().from(monitorGroup).orderBy(asc(monitorGroup.sortOrder), asc(monitorGroup.id)).all()
    .map((g) => ({ id: g.id, name: g.name, sort_order: g.sortOrder }))))

  app.post('/', async (c) => {
    const body = await c.req.json<{ name?: string; sort_order?: number }>()
    if (!body.name?.trim()) return c.json({ error: 'name is required' }, 400)
    const row = db.insert(monitorGroup).values({ name: body.name.trim(), sortOrder: body.sort_order ?? 0 }).returning().get()!
    return c.json({ id: row.id, name: row.name, sort_order: row.sortOrder }, 201)
  })

  app.patch('/:id', async (c) => {
    const body = await c.req.json<{ name?: string; sort_order?: number }>()
    const id = Number(c.req.param('id'))
    const set: { name?: string; sortOrder?: number } = {}
    if (body.name !== undefined) set.name = body.name
    if (body.sort_order !== undefined) set.sortOrder = body.sort_order
    const rows = db.update(monitorGroup).set(set).where(eq(monitorGroup.id, id)).returning().all()
    if (!rows[0]) return c.json({ error: 'not found' }, 404)
    return c.json({ id: rows[0]!.id, name: rows[0]!.name, sort_order: rows[0]!.sortOrder })
  })

  app.delete('/:id', (c) => {
    db.delete(monitorGroup).where(eq(monitorGroup.id, Number(c.req.param('id')))).run()
    return c.body(null, 204)
  })

  return app
}
