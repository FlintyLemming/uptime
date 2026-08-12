import { expect, test } from 'bun:test'
import { runSlot } from './slot-runner'
import type { MonitorRuntimeConfig, SlotDeps } from './slot-runner'
import type { Probe, ProbeResult } from '../probes/types'

/** 可编程假时钟：秒，可手动推进 */
function fakeClock(startSec: number) {
  let t = startSec
  return {
    now: () => t,
    advance: (sec: number) => { t += sec },
    sleep: async (ms: number) => { t += ms / 1000 },
  }
}

function fakeProbe(results: ProbeResult[]): Probe & { callCount: () => number } {
  let i = 0
  return {
    callCount: () => i,
    async run(_cfg, _signal) {
      const r = results[Math.min(i, results.length - 1)]!
      i++
      return r
    },
  }
}

const ok = (latencyMs = 12): ProbeResult => ({ ok: true, latencyMs, error: null, certDaysLeft: null })
const fail = (error = 'connection refused'): ProbeResult => ({ ok: false, latencyMs: null, error, certDaysLeft: null })

function cfg(over: Partial<MonitorRuntimeConfig> = {}): MonitorRuntimeConfig {
  return {
    id: 1, type: 'http', target: 'http://x', port: null,
    intervalS: 120, retryIntervalS: 30, maxRetries: 3, timeoutMs: 10_000,
    config: {}, ...over,
  }
}

test('first attempt success -> up, attempts=1, probe called once', async () => {
  const clock = fakeClock(120)
  const probe = fakeProbe([ok()])
  const deps: SlotDeps = { probe, now: clock.now, sleep: clock.sleep }
  const r = await runSlot(cfg(), deps, 120, new AbortController().signal)
  expect(r.status).toBe(0)
  expect(r.attempts).toBe(1)
  expect(r.latencyMs).toBe(12)
  expect(r.attemptRows.length).toBe(1)
  expect(probe.callCount()).toBe(1)
})

test('first fails, retry 2 succeeds -> flaky, attempts=3, recovered_after_s correct', async () => {
  const clock = fakeClock(120)
  const probe = fakeProbe([fail(), fail(), ok(20)])
  const deps: SlotDeps = { probe, now: clock.now, sleep: clock.sleep }
  const r = await runSlot(cfg(), deps, 120, new AbortController().signal)
  expect(r.status).toBe(1)
  expect(r.attempts).toBe(3)
  expect(r.latencyMs).toBe(20)
  expect(r.recoveredAfterS).toBe(60)               // t=0 首检, +30 重试1, +60 重试2 成功
  expect(r.attemptRows.map((a) => [a.seq, a.ok])).toEqual([[0, false], [1, false], [2, true]])
})

test('all attempts fail -> down, error is the last failure', async () => {
  const clock = fakeClock(0)
  const probe = fakeProbe([fail('err-1'), fail('err-2'), fail('err-3'), fail('err-4')])
  const deps: SlotDeps = { probe, now: clock.now, sleep: clock.sleep }
  const r = await runSlot(cfg({ maxRetries: 3 }), deps, 0, new AbortController().signal)
  expect(r.status).toBe(2)
  expect(r.attempts).toBe(4)
  expect(r.error).toBe('err-4')
  expect(r.latencyMs).toBeNull()
  expect(r.recoveredAfterS).toBeNull()
})

test('retry budget truncated by boundary: 120/30/max4/timeout10s -> 3 retries then down', async () => {
  const clock = fakeClock(0)
  const probe = fakeProbe([fail()])                // 无限失败
  const deps: SlotDeps = { probe, now: clock.now, sleep: clock.sleep }
  const r = await runSlot(cfg({ maxRetries: 4 }), deps, 0, new AbortController().signal)
  expect(r.status).toBe(2)
  expect(r.attempts).toBe(4)                       // 首检 + 3 次重试（第 4 次被边界截断）
  expect(clock.now()).toBeLessThanOrEqual(120)
})

test('three consecutive down slots produce exactly three SlotResults (kuma regression)', async () => {
  // kuma 在同样场景会写出 12 行心跳；这里无论重试多少次，每个 slot 恒定 1 个结果
  const results = []
  let t = 0
  for (let i = 0; i < 3; i++) {
    const clock = fakeClock(t)
    const probe = fakeProbe([fail()])
    const deps: SlotDeps = { probe, now: clock.now, sleep: clock.sleep }
    results.push(await runSlot(cfg({ maxRetries: 3 }), deps, t, new AbortController().signal))
    t += 120
  }
  expect(results.length).toBe(3)
  expect(results.every((r) => r.status === 2)).toBe(true)
})

test('slot boundary aborts the in-flight probe via signal', async () => {
  const clock = fakeClock(0)
  let sawAbort = false
  const probe: Probe = {
    async run(_c, signal) {
      // 模拟一次慢探测：等待直到被 abort
      return await new Promise<ProbeResult>((resolve) => {
        signal.addEventListener('abort', () => { sawAbort = true; resolve(fail('aborted')) })
      })
    },
  }
  const ac = new AbortController()
  const deps: SlotDeps = { probe, now: clock.now, sleep: clock.sleep }
  const p = runSlot(cfg(), deps, 0, ac.signal)
  await Bun.sleep(10)                             // 让 runSlot 进入探测
  ac.abort()                                       // 模拟 slot 边界到达
  const r = await p
  expect(sawAbort).toBe(true)
  expect(r.status).toBe(2)                         // abort 后按 down 收尾
})

test('flaky slot recovers on first retry: attempts=2, recovered_after_s=retry_interval', async () => {
  const clock = fakeClock(0)
  const probe = fakeProbe([fail(), ok()])
  const deps: SlotDeps = { probe, now: clock.now, sleep: clock.sleep }
  const r = await runSlot(cfg({ retryIntervalS: 20 }), deps, 0, new AbortController().signal)
  expect(r.status).toBe(1)
  expect(r.attempts).toBe(2)
  expect(r.recoveredAfterS).toBe(20)
})
