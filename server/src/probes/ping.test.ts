import { expect, test, mock } from 'bun:test'
import { pingProbe, parsePingOutput, setRunnerForTest } from './ping'
import type { ProbeConfig } from './types'

function cfg(target = '127.0.0.1', config: Record<string, unknown> = {}): ProbeConfig {
  return { type: 'ping', target, port: null, timeoutMs: 2000, config }
}

test('parsePingOutput detects success and extracts rtt', () => {
  const out = 'PING example.com (93.184.216.34): 56 data bytes\n64 bytes from 93.184.216.34: icmp_seq=0 ttl=56 time=3.456 ms\n--- example.com ping statistics ---\n1 packets transmitted, 1 packets received, 0.0% packet loss\nround-trip min/avg/max/stddev = 3.456/3.456/3.456/0.000 ms\n'
  expect(parsePingOutput(out)).toEqual({ ok: true, latencyMs: 3.456 })
})

test('parsePingOutput detects 100% loss as failure', () => {
  const out = 'PING nohost (10.255.255.1): 56 data bytes\n--- nohost ping statistics ---\n1 packets transmitted, 0 packets received, 100.0% packet loss\n'
  expect(parsePingOutput(out)).toEqual({ ok: false, latencyMs: null })
})

test('ping probe uses injected runner and packet_count', async () => {
  const runner = mock(async (_args: string[]) => ({ exitCode: 0, stdout: '64 bytes from 127.0.0.1: icmp_seq=0 ttl=64 time=0.045 ms\n1 packets transmitted, 1 packets received, 0.0% packet loss\n', stderr: '' }))
  setRunnerForTest(runner)
  const r = await pingProbe.run(cfg('127.0.0.1', { packet_count: 3 }), AbortSignal.timeout(3000))
  expect(r.ok).toBe(true)
  expect(r.latencyMs).toBe(0)
  const args = runner.mock.calls[0]![0]!
  expect(args.join(' ')).toContain('-c 3')
  setRunnerForTest(null)
})

test('ping probe failure never throws', async () => {
  setRunnerForTest(async () => ({ exitCode: 2, stdout: '', stderr: 'ping: cannot resolve host' }))
  const r = await pingProbe.run(cfg('nohost.invalid'), AbortSignal.timeout(3000))
  expect(r.ok).toBe(false)
  expect(r.error).toContain('cannot resolve host')
  setRunnerForTest(null)
})
