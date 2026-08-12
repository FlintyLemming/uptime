import { effectiveRetries } from './clock'
import { probeConfigFromMonitor, type Probe, type ProbeResult } from '../probes'

export type SlotStatus = 0 | 1 | 2                 // up | flaky | down

export interface AttemptRow {
  seq: number                                      // 0=首检, 1..n=重试
  ok: boolean
  latencyMs: number | null
  error: string | null
  at: number                                       // unix 秒
}

export interface SlotResult {
  status: SlotStatus
  attempts: number
  recoveredAfterS: number | null
  latencyMs: number | null
  error: string | null
  certDaysLeft: number | null
  attemptRows: AttemptRow[]
}

export interface MonitorRuntimeConfig {
  id: number
  type: 'http' | 'tcp' | 'ping' | 'dns'
  target: string
  port: number | null
  intervalS: number
  retryIntervalS: number
  maxRetries: number
  timeoutMs: number
  config: Record<string, unknown>
}

export interface SlotDeps {
  probe: Probe
  now: () => number                                // unix 秒
  sleep: (ms: number, signal: AbortSignal) => Promise<void>
}

/**
 * 运行单个 slot 的状态机（设计文档 §3.3）：
 * 首检成功=up；重试后成功=flaky；预算用尽/撞上边界=down。
 * 至多产出 1 个 SlotResult，与实际探测次数无关。
 */
export async function runSlot(
  cfg: MonitorRuntimeConfig,
  deps: SlotDeps,
  slotStartSec: number,
  signal: AbortSignal,
): Promise<SlotResult> {
  const { probe, now, sleep } = deps
  const probeCfg = probeConfigFromMonitor({ type: cfg.type, target: cfg.target, port: cfg.port, timeoutMs: cfg.timeoutMs, config: cfg.config })
  const budget = effectiveRetries(cfg)
  const attemptRows: AttemptRow[] = []
  let lastError: string | null = null
  let certDaysLeft: number | null = null

  for (let seq = 0; seq <= budget; seq++) {
    if (signal.aborted) break
    const attemptStart = now()
    const r: ProbeResult = await probe.run(probeCfg, signal)
    attemptRows.push({ seq, ok: r.ok, latencyMs: r.latencyMs, error: r.error, at: attemptStart })
    if (r.certDaysLeft !== null) certDaysLeft = r.certDaysLeft

    if (r.ok) {
      if (seq === 0) {
        return { status: 0, attempts: 1, recoveredAfterS: null, latencyMs: r.latencyMs, error: null, certDaysLeft, attemptRows }
      }
      return { status: 1, attempts: seq + 1, recoveredAfterS: Math.round(now() - slotStartSec), latencyMs: r.latencyMs, error: null, certDaysLeft, attemptRows }
    }
    lastError = r.error
    if (seq === budget || signal.aborted) break

    // 重试节奏：对齐 slot 起点 + retry_interval * (seq+1)，且不超过 slot 边界
    const nextAtMs = (slotStartSec + cfg.retryIntervalS * (seq + 1)) * 1000
    const waitMs = nextAtMs - now() * 1000
    if (waitMs <= 0) break                          // 已撞边界，直接判 down
    await sleep(waitMs, signal)
  }

  return { status: 2, attempts: attemptRows.length, recoveredAfterS: null, latencyMs: null, error: lastError, certDaysLeft, attemptRows }
}
