import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { user } from '../db/schema'
import type { DrizzleDb } from '../db/client'
import { createSession, destroySession, isValidSession, setSessionCookie, clearSessionCookie, SESSION_COOKIE } from './middleware/auth'
import { loginLimiter } from './middleware/ratelimit'
import { getCookie } from 'hono/cookie'

export function buildAuthRoutes(db: DrizzleDb) {
  const app = new Hono()

  app.get('/setup-status', (c) => {
    const first = db.select().from(user).get()
    return c.json({ hasUser: !!first })
  })

  app.post('/setup', async (c) => {
    if (db.select().from(user).get()) return c.json({ error: 'setup already completed' }, 409)
    const body = await c.req.json<{ username?: string; password?: string }>()
    if (!body.username?.trim() || !body.password || body.password.length < 8) {
      return c.json({ error: 'username and a password of at least 8 characters are required' }, 400)
    }
    const passwordHash = await Bun.password.hash(body.password, { algorithm: 'argon2id' })
    db.insert(user).values({ username: body.username.trim(), passwordHash, createdAt: Math.floor(Date.now() / 1000) }).run()
    setSessionCookie(c, createSession())
    return c.json({ username: body.username.trim() })
  })

  app.post('/login', async (c) => {
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local'
    const gate = loginLimiter.check(ip)
    if (!gate.allowed) return c.json({ error: 'too many failed attempts', retry_after_s: gate.retryAfterS }, 429)
    const body = await c.req.json<{ username?: string; password?: string }>()
    const row = body.username ? db.select().from(user).where(eq(user.username, body.username)).get() : undefined
    const ok = row && body.password ? await Bun.password.verify(body.password, row.passwordHash) : false
    if (!ok) { loginLimiter.fail(ip); return c.json({ error: 'invalid credentials' }, 401) }
    loginLimiter.reset(ip)
    setSessionCookie(c, createSession())
    return c.json({ username: row!.username })
  })

  app.post('/logout', (c) => {
    const id = getCookie(c, SESSION_COOKIE)
    if (id) destroySession(id)
    clearSessionCookie(c)
    return c.json({ ok: true })
  })

  app.get('/me', (c) => {
    const id = getCookie(c, SESSION_COOKIE)
    if (!isValidSession(id)) return c.json({ error: 'unauthorized' }, 401)
    const row = db.select().from(user).get()
    return c.json({ username: row?.username ?? '' })
  })

  return app
}
