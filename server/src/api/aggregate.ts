export type Range = '90d' | '30d' | '24h'
export type EntityStatus = 'operational' | 'degraded' | 'down' | 'nodata'

const STATUS_RANK: Record<EntityStatus, number> = { nodata: -1, operational: 0, degraded: 1, down: 2 }

export interface BarPoint { t: number; s: number }

export interface MonitorSeriesInput {
  id: number; name: string
  daily: Array<{ day: string; up: number; flaky: number; down: number }>
  slots: Array<{ startedAt: number; status: number; intervalS: number }>
  currentStatus: number | null                     // 0=up 1=flaky 2=down；null = 无数据
  intervalS: number
}

export interface GroupInput { id: number | null; name: string; monitors: MonitorSeriesInput[] }

export function dayBarColor(d: { up: number; flaky: number; down: number }): 0 | 1 | 2 | 3 | 4 {
  const n = d.up + d.flaky + d.down
  if (n === 0) return 4
  if (d.down === 0) return d.flaky === 0 ? 0 : 1
  return d.down / n < 0.05 ? 2 : 3
}

export function slotBarColor(status: number): 0 | 1 | 3 {
  return status === 0 ? 0 : status === 1 ? 1 : 3
}

export function uptimeRatio(up: number, flaky: number, down: number): number {
  const denom = up + flaky + down
  return denom === 0 ? 1 : (up + flaky) / denom
}

export function mergeGroupBars(bars: BarPoint[][]): BarPoint[] {
  if (bars.length === 0) return []
  const len = bars[0]!.length
  const out: BarPoint[] = []
  for (let i = 0; i < len; i++) {
    let worst = 4, any = false
    for (const series of bars) {
      const s = series[i]!.s
      if (s === 4) continue
      any = true
      if (s > worst || worst === 4) worst = s
    }
    out.push({ t: bars[0]![i]!.t, s: any ? worst : 4 })
  }
  return out
}

function worstStatus(list: EntityStatus[]): EntityStatus {
  let best: EntityStatus = 'nodata'
  for (const s of list) if (STATUS_RANK[s] > STATUS_RANK[best]) best = s
  return best
}

export function buildStatusPayload(input: {
  siteTitle: string; timezone: string; range: Range; nowSec: number; groups: GroupInput[]
}) {
  const { range, nowSec } = input
  const groupsOut = input.groups.map((g) => {
    let up = 0, flaky = 0, down = 0
    const monitors = g.monitors.map((m) => {
      let bars: BarPoint[] = []
      let mUp = 0, mFlaky = 0, mDown = 0
      if (range === '24h') {
        const count = Math.floor(86400 / m.intervalS)
        const byStart = new Map(m.slots.map((s) => [s.startedAt, s]))
        // 末位 = 最近一个已开始的 slot；nowSec 恰在边界上时不包含刚启动的那个
        const latestStart = Math.floor((nowSec - 1) / m.intervalS) * m.intervalS
        for (let i = count - 1; i >= 0; i--) {
          const t = latestStart - i * m.intervalS
          const row = byStart.get(t)
          bars.push({ t, s: row ? slotBarColor(row.status) : 4 })
          // flaky 只计入 mFlaky：uptime% = (up+flaky)/(up+flaky+down)，不可重复计数
          if (row) { if (row.status === 0) mUp++; else if (row.status === 1) mFlaky++; else mDown++ }
        }
      } else {
        const n = range === '30d' ? 30 : 90
        const dayMs = 86400
        const todayStart = Math.floor(nowSec / dayMs) * dayMs    // 仅用于生成 t 轴；day 字符串对齐由查询侧保证
        const byIdx = new Map(m.daily.map((d, i) => [i, d]))
        for (let i = 0; i < n; i++) {
          const d = byIdx.get(m.daily.length - n + i)
          const t = todayStart - (n - 1 - i) * dayMs
          bars.push({ t, s: d ? dayBarColor(d) : 4 })
          if (d) { mUp += d.up; mFlaky += d.flaky; mDown += d.down }
        }
      }
      up += mUp; flaky += mFlaky; down += mDown
      const cur: EntityStatus = m.currentStatus === null ? 'nodata'
        : m.currentStatus === 0 ? 'operational'
        : m.currentStatus === 1 ? 'degraded' : 'down'
      return { id: m.id, name: m.name, status: cur, uptime: uptimeRatio(mUp, mFlaky, mDown), flaky_count: mFlaky, bars }
    })
    return {
      id: g.id, name: g.name,
      status: monitors.length === 0 ? 'nodata' as EntityStatus : worstStatus(monitors.map((m) => m.status)),
      uptime: uptimeRatio(up, flaky, down),
      monitors, bars: mergeGroupBars(monitors.map((m) => m.bars)),
    }
  })

  const allCur = groupsOut.flatMap((g) => g.monitors.map((m) => m.status))
  const overall = allCur.length === 0 ? 'nodata' as EntityStatus : worstStatus(allCur)
  return {
    site_title: input.siteTitle, timezone: input.timezone, generated_at: nowSec,
    overall, groups: groupsOut,
  }
}
