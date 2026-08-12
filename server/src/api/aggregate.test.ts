import { expect, test } from 'bun:test'
import { dayBarColor, slotBarColor, uptimeRatio, mergeGroupBars, buildStatusPayload } from './aggregate'

test('dayBarColor follows spec 7.3', () => {
  expect(dayBarColor({ up: 100, flaky: 0, down: 0 })).toBe(0)
  expect(dayBarColor({ up: 99, flaky: 1, down: 0 })).toBe(1)
  expect(dayBarColor({ up: 96, flaky: 0, down: 4 })).toBe(2)   // 4/100 < 5%
  expect(dayBarColor({ up: 95, flaky: 0, down: 5 })).toBe(3)   // 5/100 >= 5%
  expect(dayBarColor({ up: 0, flaky: 0, down: 0 })).toBe(4)
})

test('dayBarColor uses down/(up+flaky+down) even when flaky present', () => {
  expect(dayBarColor({ up: 91, flaky: 5, down: 4 })).toBe(2)   // 4/100 < 5%
  expect(dayBarColor({ up: 90, flaky: 5, down: 5 })).toBe(3)   // 5/100 >= 5%
})

test('slotBarColor maps slot status to bar codes', () => {
  expect(slotBarColor(0)).toBe(0)
  expect(slotBarColor(1)).toBe(1)
  expect(slotBarColor(2)).toBe(3)
})

test('uptimeRatio: flaky counts as available, zero denominator -> 1', () => {
  expect(uptimeRatio(9, 1, 0)).toBe(1)
  expect(uptimeRatio(1, 0, 1)).toBe(0.5)
  expect(uptimeRatio(0, 0, 0)).toBe(1)
})

test('mergeGroupBars takes per-position worst, ignoring nodata', () => {
  const a = [{ t: 1, s: 0 }, { t: 2, s: 4 }, { t: 3, s: 1 }]
  const b = [{ t: 1, s: 4 }, { t: 2, s: 4 }, { t: 3, s: 0 }]
  expect(mergeGroupBars([a, b])).toEqual([{ t: 1, s: 0 }, { t: 2, s: 4 }, { t: 3, s: 1 }])
  expect(mergeGroupBars([[{ t: 1, s: 2 }], [{ t: 1, s: 3 }]])).toEqual([{ t: 1, s: 3 }])
})

test('buildStatusPayload aggregates groups and overall for daily range', () => {
  const nowSec = 1786560600
  const daily = Array.from({ length: 90 }, () => ({ day: '', up: 100, flaky: 0, down: 0, nodata: 0 }))
  const dailyB = Array.from({ length: 90 }, (_, i) => i === 89 ? { day: '', up: 0, flaky: 0, down: 100, nodata: 0 } : { day: '', up: 100, flaky: 0, down: 0, nodata: 0 })
  const payload = buildStatusPayload({
    siteTitle: 'Status', timezone: 'UTC', range: '90d', nowSec,
    groups: [
      { id: 1, name: 'API', monitors: [
        { id: 10, name: 'a', daily, slots: [], currentStatus: 0, intervalS: 60 },
        { id: 11, name: 'b', daily: dailyB, slots: [], currentStatus: 2, intervalS: 60 },
      ]},
      { id: null, name: '未分组', monitors: [] },
    ],
  })
  expect(payload.overall).toBe('down')
  expect(payload.groups[0]!.status).toBe('down')
  expect(payload.groups[0]!.monitors[0]!.bars.length).toBe(90)
  expect(payload.groups[0]!.monitors[1]!.bars[89]!.s).toBe(3)
  // 加权 uptime: (90*100 + (89*100)) / (90*100 + 89*100 + 100)
  const expected = (90 * 100 + 89 * 100) / (90 * 100 + 89 * 100 + 100)
  expect(payload.groups[0]!.uptime).toBeCloseTo(expected, 10)
  expect(payload.groups[1]!.uptime).toBe(1)        // 空组按 100%
  expect(payload.groups[1]!.status).toBe('nodata')
  // tooltip 明细字段
  expect(payload.groups[0]!.monitors[0]!.interval_s).toBe(60)
  expect(payload.groups[0]!.monitors[0]!.daily.length).toBe(90)
  expect(payload.groups[0]!.monitors[0]!.daily[0]).toEqual({ up: 100, flaky: 0, down: 0, nodata: 0 })
  expect(payload.groups[0]!.monitors[0]!.slots_meta).toEqual([])
  expect(payload.groups[0]!.down_seconds).toBe(100 * 60)
  expect(payload.groups[1]!.down_seconds).toBe(0)
})

test('buildStatusPayload 24h uses slots with nodata gaps', () => {
  const nowSec = 1786560600                        // 对齐到 60s 边界
  const intervalS = 60
  const slots = [{ startedAt: nowSec - intervalS, status: 0, intervalS, recoveredAfterS: null }]  // 只有 1 个 slot
  const payload = buildStatusPayload({
    siteTitle: 'S', timezone: 'UTC', range: '24h', nowSec,
    groups: [{ id: null, name: '未分组', monitors: [{ id: 1, name: 'm', daily: [], slots, currentStatus: 0, intervalS }] }],
  })
  const bars = payload.groups[0]!.monitors[0]!.bars
  expect(bars.length).toBe(1440)                   // 86400/60
  expect(bars[1439]!.s).toBe(0)                    // 最新位置 = up
  expect(bars[1438]!.s).toBe(4)                    // 其余为 nodata
  expect(payload.groups[0]!.monitors[0]!.uptime).toBe(1)
  // slots_meta 与 bars 同序：最新位置有 meta，其余为 null
  const meta = payload.groups[0]!.monitors[0]!.slots_meta
  expect(meta.length).toBe(1440)
  expect(meta[1439]).toEqual({ interval_s: 60, recovered_after_s: null })
  expect(meta[1438]).toBeNull()
  expect(payload.groups[0]!.monitors[0]!.daily).toEqual([])
})

test('buildStatusPayload 24h uptime counts flaky once: (up+flaky)/(up+flaky+down)', () => {
  const nowSec = 1786560600
  const intervalS = 60
  const slots = [
    { startedAt: nowSec - intervalS * 3, status: 1, intervalS, recoveredAfterS: 30 },   // flaky
    { startedAt: nowSec - intervalS * 2, status: 2, intervalS, recoveredAfterS: null }, // down
  ]
  const payload = buildStatusPayload({
    siteTitle: 'S', timezone: 'UTC', range: '24h', nowSec,
    groups: [{ id: null, name: '未分组', monitors: [{ id: 1, name: 'm', daily: [], slots, currentStatus: 2, intervalS }] }],
  })
  const mon = payload.groups[0]!.monitors[0]!
  expect(mon.uptime).toBe(0.5)                     // (0+1)/(0+1+1)
  expect(mon.flaky_count).toBe(1)
  // slots_meta 里能取到 recovered_after_s（tooltip「恢复用时」）
  const metaAt = mon.slots_meta.filter((x) => x !== null)
  expect(metaAt).toContainEqual({ interval_s: 60, recovered_after_s: 30 })
  expect(payload.groups[0]!.down_seconds).toBe(60)  // 1 个 down slot × 60s
})

test('overall is degraded when flaky present but no down', () => {
  const payload = buildStatusPayload({
    siteTitle: 'S', timezone: 'UTC', range: '90d', nowSec: 1786560600,
    groups: [{ id: 1, name: 'g', monitors: [
      { id: 1, name: 'a', daily: Array.from({ length: 90 }, () => ({ day: '', up: 100, flaky: 0, down: 0, nodata: 0 })), slots: [], currentStatus: 1, intervalS: 60 },
    ]}],
  })
  expect(payload.overall).toBe('degraded')
})
