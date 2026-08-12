import type { Probe, ProbeConfig, ProbeResult } from './types'
import { shortError } from './types'

export interface PingRunResult { exitCode: number; stdout: string; stderr: string }
type Runner = (args: string[], timeoutMs: number, signal: AbortSignal) => Promise<PingRunResult>

/** 解析系统 ping 输出：有 reply 行取 time= 作为延迟，否则看丢包率 */
export function parsePingOutput(stdout: string): { ok: boolean; latencyMs: number | null } {
  const timeMatch = /time[=<]\s*([\d.]+)\s*ms/.exec(stdout)
  const lossMatch = /([\d.]+)% packet loss/.exec(stdout)
  if (lossMatch && Number(lossMatch[1]) >= 100 && !timeMatch) return { ok: false, latencyMs: null }
  if (timeMatch) return { ok: true, latencyMs: Number(timeMatch[1]) }
  return { ok: false, latencyMs: null }
}

const systemRunner: Runner = async (args, timeoutMs, signal) => {
  const proc = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe' })
  const timer = setTimeout(() => proc.kill(), timeoutMs)
  const onAbort = () => proc.kill()
  signal.addEventListener('abort', onAbort)
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    return { exitCode, stdout, stderr }
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
  }
}

let runner: Runner = systemRunner
export function setRunnerForTest(r: Runner | null) { runner = r ?? systemRunner }

const isDarwin = process.platform === 'darwin'

function buildArgs(target: string, count: number, timeoutMs: number): string[] {
  const timeoutS = Math.max(1, Math.ceil(timeoutMs / 1000))
  // macOS: -t <秒> 是整体超时；Linux: -W <秒> 是单包超时
  return isDarwin
    ? ['ping', '-c', String(count), '-t', String(timeoutS), target]
    : ['ping', '-c', String(count), '-W', String(timeoutS), target]
}

export const pingProbe: Probe = {
  async run(cfg: ProbeConfig, signal: AbortSignal): Promise<ProbeResult> {
    const count = Math.max(1, Number(cfg.config.packet_count ?? 1))
    const started = performance.now()
    try {
      const { exitCode, stdout, stderr } = await runner(buildArgs(cfg.target, count, cfg.timeoutMs), cfg.timeoutMs, signal)
      const parsed = parsePingOutput(stdout)
      if (parsed.ok) {
        return { ok: true, latencyMs: parsed.latencyMs === null ? Math.round(performance.now() - started) : Math.round(parsed.latencyMs), error: null, certDaysLeft: null }
      }
      const err = stderr.trim() || (exitCode === 0 ? 'no reply received' : `ping exited with code ${exitCode}`)
      return { ok: false, latencyMs: null, error: shortError(err), certDaysLeft: null }
    } catch (e) {
      return { ok: false, latencyMs: null, error: shortError(e), certDaysLeft: null }
    }
  },
}
