import type { Probe, ProbeConfig, ProbeResult } from './types'
import { shortError } from './types'

const TYPE_CODES: Record<string, number> = { A: 1, AAAA: 28, CNAME: 5, TXT: 16, NS: 2, MX: 15 }

export function buildDnsQuery(domain: string, recordType: string): Uint8Array {
  const type = TYPE_CODES[recordType.toUpperCase()] ?? 1
  const labels = domain.split('.').filter(Boolean)
  const qnameLen = labels.reduce((n, l) => n + 1 + l.length, 0) + 1
  const buf = new Uint8Array(12 + qnameLen + 4)
  const id = Math.floor(Math.random() * 0xffff)
  const dv = new DataView(buf.buffer)
  dv.setUint16(0, id)
  dv.setUint16(2, 0x0100)                          // RD=1
  dv.setUint16(4, 1)                               // QDCOUNT
  let off = 12
  for (const label of labels) {
    buf[off++] = label.length
    for (let i = 0; i < label.length; i++) buf[off++] = label.charCodeAt(i)
  }
  buf[off++] = 0
  dv.setUint16(off, type); dv.setUint16(off + 2, 1) // QTYPE, QCLASS IN
  return buf
}

function readName(_buf: Uint8Array, off: number): number {
  // 跳过名字：支持压缩指针与标签序列，返回名字之后的偏移
  let i = off
  for (;;) {
    const len = _buf[i]!
    if (len === 0) return i + 1
    if ((len & 0xc0) === 0xc0) return i + 2        // 压缩指针：2 字节
    i += 1 + len
  }
}

export function parseDnsResponse(buf: Uint8Array): string[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const qd = dv.getUint16(4), an = dv.getUint16(6)
  let off = 12
  for (let i = 0; i < qd; i++) { off = readName(buf, off); off += 4 }
  const values: string[] = []
  for (let i = 0; i < an; i++) {
    off = readName(buf, off)
    const type = dv.getUint16(off), rdlen = dv.getUint16(off + 8)
    const rdata = off + 10
    if (type === 1 && rdlen === 4) values.push(`${buf[rdata]}.${buf[rdata + 1]}.${buf[rdata + 2]}.${buf[rdata + 3]}`)
    else if (type === 28 && rdlen === 16) {
      const parts: string[] = []
      for (let p = 0; p < 16; p += 2) parts.push(((buf[rdata + p]! << 8) | buf[rdata + p + 1]!).toString(16))
      values.push(parts.join(':').replace(/\b0+\b/g, '').replace(/:{2,}/g, '::'))
    } else if (type === 16) {
      values.push(new TextDecoder().decode(buf.subarray(rdata + 1, rdata + rdlen)))
    } else if (type === 5 || type === 2) {
      values.push('<cname-or-ns>')                 // CNAME/NS 只计“解析成功”
    }
    off = rdata + rdlen
  }
  return values
}

function udpQuery(query: Uint8Array, resolver: string, port: number, timeoutMs: number, signal: AbortSignal): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    let settled = false
    let socket: { send: (d: Uint8Array, port: number, addr: string) => void; close: () => void } | null = null
    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      socket?.close()
      fn()
    }
    const timer = setTimeout(() => finish(() => reject(new Error('dns query timeout'))), timeoutMs)
    const onAbort = () => finish(() => reject(new Error('aborted')))
    signal.addEventListener('abort', onAbort)
    Bun.udpSocket({
      hostname: '0.0.0.0', port: 0,
      socket: {
        data(_s, data) { finish(() => resolve(Uint8Array.from(data))) },
        error(_s, err) { finish(() => reject(err)) },
      },
    }).then((s) => {
      socket = s
      if (settled) { s.close(); return }
      s.send(query, port, resolver)
    }).catch((e) => { finish(() => reject(e)) })
  })
}

export const dnsProbe: Probe = {
  async run(cfg: ProbeConfig, signal: AbortSignal): Promise<ProbeResult> {
    const resolver = String(cfg.config.resolver ?? '1.1.1.1')
    const resolverPort = Number(cfg.config.resolver_port ?? 53)   // resolver_port 仅供测试注入
    const recordType = String(cfg.config.record_type ?? 'A')
    const expected = cfg.config.expected_value ? String(cfg.config.expected_value) : null
    const started = performance.now()
    try {
      const query = buildDnsQuery(cfg.target, recordType)
      const response = await udpQuery(query, resolver, resolverPort, cfg.timeoutMs, signal)
      const values = parseDnsResponse(response)
      const latency = Math.round(performance.now() - started)
      if (expected !== null) {
        if (values.includes(expected)) return { ok: true, latencyMs: latency, error: null, certDaysLeft: null }
        return { ok: false, latencyMs: latency, error: `expected ${expected}, resolved to ${values.join(', ') || '(empty)'}`, certDaysLeft: null }
      }
      if (values.length > 0) return { ok: true, latencyMs: latency, error: null, certDaysLeft: null }
      return { ok: false, latencyMs: latency, error: 'no answer records', certDaysLeft: null }
    } catch (e) {
      return { ok: false, latencyMs: null, error: shortError(e), certDaysLeft: null }
    }
  },
}
