import { afterAll, expect, test } from 'bun:test'
import { dnsProbe, buildDnsQuery, parseDnsResponse } from './dns'
import type { ProbeConfig } from './types'

/** 最小 DNS 应答构造：回显 query，把 A 记录 1.2.3.4 放进 answer */
function buildAResponse(query: Uint8Array): Uint8Array {
  const out = Uint8Array.from(query)
  out[2] = 0x81; out[3] = 0x80                     // QR=1, RCODE=0
  out[6] = 0; out[7] = 1                            // ANCOUNT=1
  const answer = new Uint8Array([
    0xc0, 0x0c,                                     // name: pointer to qname
    0x00, 0x01,                                     // TYPE A
    0x00, 0x01,                                     // CLASS IN
    0x00, 0x00, 0x00, 0x3c,                         // TTL 60
    0x00, 0x04,                                     // RDLENGTH
    1, 2, 3, 4,                                     // RDATA
  ])
  const merged = new Uint8Array(out.length + answer.length)
  merged.set(out); merged.set(answer, out.length)
  return merged
}

const udp = await Bun.udpSocket({
  port: 0, hostname: '127.0.0.1',
  socket: { data(socket, data, port, address) { socket.send(buildAResponse(data), port, address) }, error() {} },
})

afterAll(() => udp.close())

function cfg(config: Record<string, unknown>): ProbeConfig {
  return { type: 'dns', target: 'example.com', port: null, timeoutMs: 2000, config }
}

test('buildDnsQuery encodes qname and type', () => {
  const q = buildDnsQuery('a.b', 'A')
  expect(q[4]).toBe(0); expect(q[5]).toBe(1)       // QDCOUNT=1
  expect(q[12]).toBe(1)                            // label len 'a'
  expect(q[13]).toBe(0x61)                         // 'a'
  expect(q[q.length - 2]).toBe(0); expect(q[q.length - 1]).toBe(1)  // TYPE A
})

test('parseDnsResponse extracts A record', () => {
  const q = buildDnsQuery('example.com', 'A')
  const values = parseDnsResponse(buildAResponse(q))
  expect(values).toEqual(['1.2.3.4'])
})

test('dns probe success without expected_value', async () => {
  const r = await dnsProbe.run(cfg({ resolver: '127.0.0.1', resolver_port: udp.port }), AbortSignal.timeout(3000))
  expect(r.ok).toBe(true)
  expect(r.latencyMs).not.toBeNull()
})

test('dns probe expected_value mismatch fails', async () => {
  const r = await dnsProbe.run(cfg({ resolver: '127.0.0.1', resolver_port: udp.port, expected_value: '9.9.9.9' }), AbortSignal.timeout(3000))
  expect(r.ok).toBe(false)
  expect(r.error).toContain('9.9.9.9')
})

test('dns probe expected_value match succeeds', async () => {
  const r = await dnsProbe.run(cfg({ resolver: '127.0.0.1', resolver_port: udp.port, expected_value: '1.2.3.4' }), AbortSignal.timeout(3000))
  expect(r.ok).toBe(true)
})
