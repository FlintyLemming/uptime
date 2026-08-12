export type ProbeType = 'http' | 'tcp' | 'ping' | 'dns'

export interface ProbeConfig {
  type: ProbeType
  target: string
  port: number | null
  timeoutMs: number
  /** 类型专属配置（设计文档 §4.1 的 monitor.config JSON） */
  config: Record<string, unknown>
}

export interface ProbeResult {
  ok: boolean
  latencyMs: number | null
  error: string | null
  /** 仅 http + check_cert_expiry 时非空：证书剩余天数 */
  certDaysLeft: number | null
}

export interface Probe {
  run(cfg: ProbeConfig, signal: AbortSignal): Promise<ProbeResult>
}

/** 统一错误包装：截断过长错误信息，保留首行 */
export function shortError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.split('\n')[0]!.slice(0, 500)
}
