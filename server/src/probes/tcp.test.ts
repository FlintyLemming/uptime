import { afterEach, expect, test } from 'bun:test'
import { tcpProbe } from './tcp'
import type { ProbeConfig } from './types'

let server: { port: number; stop: (closeActiveConnections?: boolean) => void } | null = null

afterEach(() => {
  server?.stop(true)
  server = null
})

function cfg(port: number, timeoutMs = 2000): ProbeConfig {
  return { type: 'tcp', target: '127.0.0.1', port, timeoutMs, config: {} }
}

test('tcp probe succeeds against open port', async () => {
  const s = await Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data() {} } })
  server = s
  const r = await tcpProbe.run(cfg(s.port), AbortSignal.timeout(3000))
  expect(r.ok).toBe(true)
  expect(r.latencyMs).not.toBeNull()
  expect(r.error).toBeNull()
})

test('tcp probe fails against closed port without throwing', async () => {
  const r = await tcpProbe.run(cfg(1), AbortSignal.timeout(3000))
  expect(r.ok).toBe(false)
  expect(r.latencyMs).toBeNull()
  expect(typeof r.error).toBe('string')
})
