export interface DispatchOptions {
  fetchImpl?: typeof fetch
  sleepImpl?: (ms: number) => Promise<void>
  timeoutMs?: number
  retries?: number
  backoffMs?: number[]
}

const DEFAULTS = { timeoutMs: 10_000, retries: 3, backoffMs: [1_000, 4_000, 16_000] }

export async function dispatchWebhook(
  o: { method: string; url: string; headers: Record<string, string>; body: string },
  opts: DispatchOptions = {},
): Promise<{ ok: boolean; attempts: number }> {
  const doFetch = opts.fetchImpl ?? fetch
  const sleep = opts.sleepImpl ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  const timeoutMs = opts.timeoutMs ?? DEFAULTS.timeoutMs
  const retries = opts.retries ?? DEFAULTS.retries
  const backoff = opts.backoffMs ?? DEFAULTS.backoffMs

  let attempts = 0
  for (let i = 0; i <= retries; i++) {
    attempts++
    try {
      const res = await doFetch(o.url, { method: o.method, headers: o.headers, body: o.body, signal: AbortSignal.timeout(timeoutMs) })
      if (res.status >= 200 && res.status < 300) return { ok: true, attempts }
    } catch { /* 网络异常按失败重试 */ }
    if (i < retries) await sleep(backoff[Math.min(i, backoff.length - 1)]!)
  }
  console.error(`webhook dispatch failed after ${attempts} attempts: ${o.url}`)
  return { ok: false, attempts }
}
