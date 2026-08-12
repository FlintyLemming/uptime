import { createMiddleware } from 'hono/factory'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import type { Context } from 'hono'

export const SESSION_COOKIE = 'uptime_session'
export const SESSION_MAX_AGE_S = 30 * 24 * 3600

const sessions = new Map<string, { createdAt: number }>()

export function createSession(): string {
  const id = crypto.randomUUID()
  sessions.set(id, { createdAt: Date.now() })
  return id
}

export function destroySession(id: string): void { sessions.delete(id) }

export function isValidSession(id: string | undefined): boolean {
  if (!id) return false
  const s = sessions.get(id)
  if (!s) return false
  if (Date.now() - s.createdAt > SESSION_MAX_AGE_S * 1000) { sessions.delete(id); return false }
  return true
}

export function clearAllSessionsForTest(): void { sessions.clear() }

export const requireAuth = createMiddleware(async (c, next) => {
  if (!isValidSession(getCookie(c, SESSION_COOKIE))) {
    return c.json({ error: 'unauthorized' }, 401)
  }
  await next()
})

export function setSessionCookie(c: Context, id: string): void {
  setCookie(c, SESSION_COOKIE, id, {
    path: '/', httpOnly: true, sameSite: 'Lax', maxAge: SESSION_MAX_AGE_S,
    secure: process.env.NODE_ENV === 'production',
  })
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE)
}
