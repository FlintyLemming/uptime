const MAX_FAILURES = 5
const LOCK_SECONDS = 15 * 60

interface Entry { failures: number; lockedUntil: number | null }
const byIp = new Map<string, Entry>()

export const loginLimiter = {
  check(ip: string): { allowed: boolean; retryAfterS?: number } {
    const e = byIp.get(ip)
    if (!e?.lockedUntil) return { allowed: true }
    const remain = Math.ceil((e.lockedUntil - Date.now()) / 1000)
    if (remain <= 0) { byIp.delete(ip); return { allowed: true } }
    return { allowed: false, retryAfterS: remain }
  },
  fail(ip: string): void {
    const e = byIp.get(ip) ?? { failures: 0, lockedUntil: null }
    e.failures++
    if (e.failures >= MAX_FAILURES) { e.lockedUntil = Date.now() + LOCK_SECONDS * 1000; e.failures = 0 }
    byIp.set(ip, e)
  },
  reset(ip: string): void { byIp.delete(ip) },
}

export function resetLoginLimiterForTest(): void { byIp.clear() }
