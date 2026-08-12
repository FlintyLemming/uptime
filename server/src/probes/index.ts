import { httpProbe } from './http'
import { tcpProbe } from './tcp'
import { pingProbe } from './ping'
import { dnsProbe } from './dns'
import type { Probe, ProbeConfig, ProbeType } from './types'

const REGISTRY: Record<ProbeType, Probe> = {
  http: httpProbe,
  tcp: tcpProbe,
  ping: pingProbe,
  dns: dnsProbe,
}

export function getProbe(type: ProbeType): Probe {
  const p = REGISTRY[type]
  if (!p) throw new Error(`unknown probe type: ${type}`)
  return p
}

export function probeConfigFromMonitor(m: {
  type: ProbeType; target: string; port: number | null; timeoutMs: number; config: Record<string, unknown>
}): ProbeConfig {
  return { type: m.type, target: m.target, port: m.port, timeoutMs: m.timeoutMs, config: m.config }
}

export type { Probe, ProbeConfig, ProbeResult, ProbeType } from './types'
