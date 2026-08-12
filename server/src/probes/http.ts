import tls from 'node:tls'
import type { Probe, ProbeConfig, ProbeResult } from './types'
import { shortError } from './types'

interface HttpCfg {
  method?: string
  headers?: Record<string, string>
  body?: string
  accepted_status_codes?: string[]
  follow_redirects?: boolean
  keyword?: string
  keyword_invert?: boolean
  json_query?: string
  json_expected?: string
  ignore_tls?: boolean
  check_cert_expiry?: boolean
}

function statusAccepted(code: number, specs: string[]): boolean {
  if (specs.length === 0) return code >= 200 && code <= 299
  return specs.some((spec) => {
    const m = /^(\d{3})-(\d{3})$/.exec(spec.trim())
    if (m) return code >= Number(m[1]) && code <= Number(m[2])
    return Number(spec.trim()) === code
  })
}

function fetchCertDaysLeft(hostname: string, port: number, timeoutMs: number): Promise<number | null> {
  return new Promise((resolve) => {
    const socket = tls.connect({ host: hostname, port, rejectUnauthorized: false, servername: hostname }, () => {
      const cert = socket.getPeerCertificate()
      socket.end()
      if (!cert.valid_to) return resolve(null)
      const days = Math.floor((new Date(cert.valid_to).getTime() - Date.now()) / 86_400_000)
      resolve(days)
    })
    socket.setTimeout(timeoutMs, () => { socket.destroy(); resolve(null) })
    socket.on('error', () => resolve(null))
  })
}

export const httpProbe: Probe = {
  async run(cfg: ProbeConfig, signal: AbortSignal): Promise<ProbeResult> {
    const c = cfg.config as HttpCfg
    const started = performance.now()
    const timeout = AbortSignal.timeout(cfg.timeoutMs)
    const signalAll = AbortSignal.any([signal, timeout])
    let res: Response
    let body = ''
    try {
      res = await fetch(cfg.target, {
        method: (c.method ?? 'GET').toUpperCase(),
        headers: c.headers,
        body: c.method && c.method.toUpperCase() !== 'GET' ? c.body : undefined,
        redirect: c.follow_redirects === false ? 'manual' : 'follow',
        signal: signalAll,
        tls: c.ignore_tls ? { rejectUnauthorized: false } : undefined,
      } as RequestInit)
      // manual redirect 时不读 body（302 可能无 body）
      if (!(c.follow_redirects === false && res.status >= 300 && res.status < 400)) body = await res.text()
    } catch (e) {
      const msg = timeout.aborted && !signal.aborted ? 'request timeout' : shortError(e)
      return { ok: false, latencyMs: null, error: msg, certDaysLeft: null }
    }
    const latency = Math.round(performance.now() - started)

    if (!statusAccepted(res.status, c.accepted_status_codes ?? [])) {
      return { ok: false, latencyMs: latency, error: `unexpected status code ${res.status}`, certDaysLeft: null }
    }
    if (c.keyword) {
      const found = body.includes(c.keyword)
      if (found === !!c.keyword_invert) {
        return { ok: false, latencyMs: latency, error: c.keyword_invert ? `keyword "${c.keyword}" found` : `keyword "${c.keyword}" not found`, certDaysLeft: null }
      }
    }
    if (c.json_query !== undefined) {
      let parsed: unknown
      try { parsed = JSON.parse(body) } catch {
        return { ok: false, latencyMs: latency, error: 'json parse failed', certDaysLeft: null }
      }
      const actual = String((parsed as Record<string, unknown>)[c.json_query] ?? '')
      if (actual !== String(c.json_expected ?? '')) {
        return { ok: false, latencyMs: latency, error: `json "${c.json_query}" expected "${c.json_expected}", got "${actual}"`, certDaysLeft: null }
      }
    }

    let certDaysLeft: number | null = null
    if (c.check_cert_expiry) {
      try {
        const u = new URL(cfg.target)
        if (u.protocol === 'https:') certDaysLeft = await fetchCertDaysLeft(u.hostname, Number(u.port || 443), cfg.timeoutMs)
      } catch { certDaysLeft = null }
    }
    return { ok: true, latencyMs: latency, error: null, certDaysLeft }
  },
}
