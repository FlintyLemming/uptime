import type { Probe, ProbeConfig, ProbeResult } from './types'
import { shortError } from './types'

async function connect(host: string, port: number, timeoutMs: number, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (fn: () => void) => { if (!settled) { settled = true; cleanup(); fn() } }
    const timer = setTimeout(() => finish(() => reject(new Error('connection timeout'))), timeoutMs)
    const onAbort = () => finish(() => reject(new Error('aborted')))
    signal.addEventListener('abort', onAbort)
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', onAbort) }

    const connecting = Bun.connect({
      hostname: host, port,
      socket: {
        open(s) { s.end(); finish(resolve) },
        error(_s, err) { finish(() => reject(err)) },
        close() {},
        data() {},
        drain() {},
      },
    })
    connecting.catch((err) => finish(() => reject(err)))
  })
}

export const tcpProbe: Probe = {
  async run(cfg: ProbeConfig, signal: AbortSignal): Promise<ProbeResult> {
    if (!cfg.port) return { ok: false, latencyMs: null, error: 'tcp probe requires a port', certDaysLeft: null }
    const started = performance.now()
    try {
      await connect(cfg.target, cfg.port, cfg.timeoutMs, signal)
      return { ok: true, latencyMs: Math.round(performance.now() - started), error: null, certDaysLeft: null }
    } catch (e) {
      return { ok: false, latencyMs: null, error: shortError(e), certDaysLeft: null }
    }
  },
}
