import { eq } from 'drizzle-orm'
import type { Database } from 'bun:sqlite'
import type { DrizzleDb } from '../db/client'
import { monitor, monitorGroup } from '../db/schema'
import { getProbe, type Probe, type ProbeType } from '../probes'
import { runSlot, type MonitorRuntimeConfig } from './slot-runner'
import { nextSlotStart } from './clock'
import { insertSlot, insertAttempts, lastNonNodataSlotBefore } from '../store/slots'
import { listMonitors, toRuntimeConfig } from '../store/monitors'
import { getSettings } from '../store/settings'
import { monitorsForWebhook, listWebhooks } from '../store/webhooks'
import { transitionEvent } from '../notify/transitions'
import { renderTemplate, formatSlotTime, type TemplateVars } from '../notify/template'
import { dispatchWebhook } from '../notify/dispatcher'

export interface SchedulerDeps {
  db: DrizzleDb
  sql: Database
  getNow: () => number                             // unix 秒（浮点）
  setIntervalMs?: number
  probeConcurrency?: number
  probeFactory?: (type: ProbeType) => Probe
  dispatchImpl?: typeof dispatchWebhook
  baseUrl?: string
}

export function startScheduler(deps: SchedulerDeps) {
  const { db, getNow } = deps
  const tickMs = deps.setIntervalMs ?? 1000
  const concurrency = deps.probeConcurrency ?? Number(process.env.PROBE_CONCURRENCY ?? 20)
  const probeOf = deps.probeFactory ?? ((t: ProbeType) => getProbe(t))
  const dispatch = deps.dispatchImpl ?? dispatchWebhook
  const baseUrl = deps.baseUrl ?? 'http://localhost:3000'

  const nextDue = new Map<number, number>()        // monitorId → 下一个边界（unix 秒）
  const inFlight = new Map<number, AbortController>()
  let running = 0
  let stopped = false
  const queue: Array<() => Promise<void>> = []

  function pump() {
    while (running < concurrency && queue.length > 0) {
      running++
      const task = queue.shift()!
      task().finally(() => { running--; pump() })
    }
  }

  async function runMonitorSlot(cfg: MonitorRuntimeConfig, slotStartSec: number) {
    const ac = new AbortController()
    inFlight.set(cfg.id, ac)
    try {
      const result = await runSlot(cfg, {
        probe: probeOf(cfg.type),
        now: getNow,
        sleep: (ms, signal) => new Promise((resolve) => {
          const t = setTimeout(resolve, ms)
          const onAbort = () => { clearTimeout(t); resolve() }
          signal.addEventListener('abort', onAbort, { once: true })
        }),
      }, slotStartSec, ac.signal)

      try {
        insertSlot(db, {
          monitorId: cfg.id, startedAt: slotStartSec, intervalS: cfg.intervalS,
          status: result.status, attempts: result.attempts, recoveredAfterS: result.recoveredAfterS,
          latencyMs: result.latencyMs, error: result.error, certDaysLeft: result.certDaysLeft,
        })
        insertAttempts(db, cfg.id, slotStartSec, result.attemptRows)
      } catch (e) {
        console.error(`slot write failed for monitor ${cfg.id}:`, e)
        return                                     // 丢弃该 slot（呈现 nodata），不阻塞
      }

      // 告警判定：上一个非 nodata slot
      const prev = lastNonNodataSlotBefore(db, cfg.id, slotStartSec)
      const event = transitionEvent(prev ? (prev.status as 0 | 1 | 2) : null, result.status)
      if (event) void notify(event, cfg, slotStartSec, result.error, prev?.startedAt ?? null)
    } catch (e) {
      console.error(`slot task crashed for monitor ${cfg.id}:`, e)
    } finally {
      inFlight.delete(cfg.id)
    }
  }

  async function notify(event: 'down' | 'recovered', cfg: MonitorRuntimeConfig, slotStartSec: number, error: string | null, prevSlotStart: number | null) {
    try {
      const settings = getSettings(db)
      const mRow = db.select().from(monitor).where(eq(monitor.id, cfg.id)).get()
      const monitorName = mRow?.name ?? ''
      const groupName = mRow?.groupId
        ? db.select().from(monitorGroup).where(eq(monitorGroup.id, mRow.groupId)).get()?.name ?? ''
        : ''
      const downDurationS = event === 'recovered' && prevSlotStart !== null ? slotStartSec - prevSlotStart : null
      const webhooks = listWebhooks(db).filter((w) => w.enabled === 1)
      for (const w of webhooks) {
        const scoped = monitorsForWebhook(db, w.id)
        if (scoped.length > 0 && !scoped.includes(cfg.id)) continue
        const vars: TemplateVars = {
          event, monitor_name: monitorName,
          monitor_type: cfg.type, target: cfg.target, group_name: groupName,
          status: event === 'down' ? 'down' : 'recovered',
          error: error ?? '', attempts: '', slot_started_at: formatSlotTime(slotStartSec, settings.display_timezone),
          down_duration_s: downDurationS === null ? '' : String(downDurationS),
          url: `${baseUrl}/m/${cfg.id}`,
        }
        void dispatch({ method: w.method, url: w.url, headers: JSON.parse(w.headers), body: renderTemplate(w.bodyTemplate, vars) })
      }
    } catch (e) {
      console.error('notify failed:', e)
    }
  }

  const timer = setInterval(() => {
    try {
      if (stopped) return
      const nowSec = Math.floor(getNow())
      // 边界到达时 abort 上一轮仍未结束的任务
      for (const [id, ac] of inFlight) {
        const due = nextDue.get(id)
        if (due !== undefined && nowSec >= due) ac.abort()
      }
      const monitors = listMonitors(db).filter((m) => m.active === 1)
      for (const m of monitors) {
        const cfg = toRuntimeConfig(m)
        const due = nextDue.get(cfg.id)
        if (due === undefined) {
          nextDue.set(cfg.id, nextSlotStart(nowSec, cfg.intervalS))
          continue
        }
        if (nowSec >= due && !inFlight.has(cfg.id)) {
          const slotStartSec = due
          nextDue.set(cfg.id, due + cfg.intervalS)
          queue.push(() => runMonitorSlot(cfg, slotStartSec))
        }
      }
      pump()
    } catch (e) {
      console.error('scheduler tick error:', e)     // 顶层兜底，进程不退出
    }
  }, tickMs)

  return {
    stop() { stopped = true; clearInterval(timer); for (const ac of inFlight.values()) ac.abort() },
    running: () => running,
  }
}
