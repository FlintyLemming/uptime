import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchStatus } from '../lib/api'
import { useTheme } from '../lib/theme'
import { dayLabel, timeLabel, dur } from '../lib/format'
import { RANGE_SECONDS, isHourRange, type StatusRange } from '../lib/range'
import type { StatusResponse, StatusGroup, StatusMonitor, SlotMeta } from '../lib/types'
import ThemeToggle from '../components/ThemeToggle'
import RangeSelect from '../components/RangeSelect'
import StatusBanner from '../components/StatusBanner'
import GroupRow from '../components/GroupRow'
import MonitorRow from '../components/MonitorRow'
import Legend from '../components/Legend'
import BarTooltip, { type TipState } from '../components/BarTooltip'
import StaleDataNotice from '../components/StaleDataNotice'

type Range = StatusRange
const RANGES: Array<{ key: Range; label: string }> = [
  { key: '1h', label: '1 小时' }, { key: '3h', label: '3 小时' }, { key: '6h', label: '6 小时' },
  { key: '12h', label: '12 小时' }, { key: '24h', label: '24 小时' }, { key: '30d', label: '30 天' }, { key: '90d', label: '90 天' },
]
const OPEN_KEY = 'uptime-open-groups'
const statusToCode = (s: string) => (s === 'operational' ? 0 : s === 'degraded' ? 1 : s === 'down' ? 3 : 4)

// slot 分支文案（对照 mock onEnter 的 slot 分支；秒数用实际 interval/recovered 数据填）
function slotLines(code: number, meta: SlotMeta | null): { line1: string; line2: string } {
  if (code === 4 || !meta) return { line1: '无数据', line2: '该时段没有采集到数据' }
  const interval = dur(meta.interval_s)
  if (code === 0) return { line1: '正常 · 首检成功', line2: `检查间隔 ${interval}` }
  if (code === 1) {
    return {
      line1: '闪断 · 重试后恢复',
      line2: meta.recovered_after_s !== null ? `恢复用时 ${dur(meta.recovered_after_s)}` : `检查间隔 ${interval}`,
    }
  }
  return { line1: '离线 · 重试用尽', line2: `本间隔宕机 ${interval}` }
}

// 日条文案（对照 mock onEnter 的 day 分支）
function dayLines(t: number, agg: { up: number; flaky: number; down: number }, downSeconds: number) {
  const total = agg.up + agg.flaky + agg.down
  return {
    title: dayLabel(t),
    line1: total === 0 ? '无数据（服务未在运行）' : `正常 ${agg.up} · 闪断 ${agg.flaky} · 离线 ${agg.down}`,
    line2: agg.down > 0 ? `累计宕机 ${dur(downSeconds)}` : total === 0 ? '不计入可用率' : '当日 100% 可达',
  }
}

function groupSummary(g: StatusGroup): string {
  const flaky = g.monitors.reduce((a, m) => a + m.flaky_count, 0)
  if (flaky > 0) return `范围内 ${flaky} 次闪断`
  if (g.down_seconds > 0) return `累计宕机 ${dur(g.down_seconds)}`
  return '无异常'
}

function rangeStartLabel(range: Range): string {
  const sec = RANGE_SECONDS[range]!
  return isHourRange(range)
    ? `${sec / 3600} 小时前（每条 = 1 个检查间隔）`
    : `${sec / 86400} 天前`
}

export default function StatusPage() {
  const { theme } = useTheme()
  const [range, setRange] = useState<Range>('90d')
  const [data, setData] = useState<StatusResponse | null>(null)
  const [stale, setStale] = useState(false)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number>(Date.now())
  const [tip, setTip] = useState<TipState | null>(null)
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    try { return Object.fromEntries((JSON.parse(localStorage.getItem(OPEN_KEY) ?? '[]') as string[]).map((k) => [k, true])) }
    catch { return {} }
  })

  const load = useCallback(() => {
    fetchStatus(range)
      .then((d) => { setData(d); setStale(false); setLastUpdatedAt(Date.now()) })
      .catch(() => setStale(true))
  }, [range])

  useEffect(() => {
    load()
    const timer = setInterval(load, 30_000)
    return () => clearInterval(timer)
  }, [load])

  const toggleGroup = (id: number | null) => {
    setOpen((prev) => {
      const key = String(id)
      const next = { ...prev, [key]: !prev[key] }
      localStorage.setItem(OPEN_KEY, JSON.stringify(Object.keys(next).filter((k) => next[k])))
      return next
    })
  }

  // tooltip：组行（成员对应位聚合；slot 条取造成该状态的那个成员的 meta）
  const hoverGroupBar = (barIdx: number, rect: DOMRect, g: StatusGroup) => {
    const bar = g.bars[barIdx]
    if (!bar) return
    const x = rect.left + rect.width / 2, y = rect.top - 8
    if (isHourRange(range)) {
      const donor = g.monitors.find((m) => m.bars[barIdx]?.s === bar.s && m.slots_meta[barIdx]) ?? null
      setTip({ x, y, title: timeLabel(bar.t), ...slotLines(bar.s, donor ? donor.slots_meta[barIdx] ?? null : null) })
      return
    }
    let up = 0, flaky = 0, down = 0, downSeconds = 0
    for (const m of g.monitors) {
      const day = m.daily[barIdx]
      if (day) { up += day.up; flaky += day.flaky; down += day.down; downSeconds += day.down * m.interval_s }
    }
    setTip({ x, y, ...dayLines(bar.t, { up, flaky, down }, downSeconds) })
  }

  // tooltip：监控行（只用该 monitor 自己的明细）
  const hoverMonitorBar = (barIdx: number, rect: DOMRect, m: StatusMonitor) => {
    const bar = m.bars[barIdx]
    if (!bar) return
    const x = rect.left + rect.width / 2, y = rect.top - 8
    if (isHourRange(range)) {
      setTip({ x, y, title: timeLabel(bar.t), ...slotLines(bar.s, m.slots_meta[barIdx] ?? null) })
      return
    }
    const day = m.daily[barIdx]
    setTip({
      x, y,
      ...dayLines(bar.t, day ?? { up: 0, flaky: 0, down: 0 }, day ? day.down * m.interval_s : 0),
    })
  }

  const downCount = useMemo(() => data ? data.groups.flatMap((g) => g.monitors).filter((m) => m.status === 'down').length : 0, [data])

  if (!data) return null
  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)', color: 'var(--fg)', padding: '40px 20px 80px' }}>
      <div className="mx-auto flex max-w-[820px] flex-col gap-6">
        {stale && <StaleDataNotice lastUpdatedAt={lastUpdatedAt} />}

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-[10px]">
            <div className="flex h-[26px] w-[26px] items-center justify-center rounded-[7px]" style={{ background: '#24c19a' }}>
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none"><path d="M4.5 10.5l3.5 3.5 7.5-7.5" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
            <div className="font-semibold" style={{ fontSize: 16, letterSpacing: '-.01em' }}>{data.site_title}</div>
          </div>
          <div className="flex items-center gap-1.5">
            <ThemeToggle />
            <a href="/admin" title="管理" className="flex h-8 w-8 items-center justify-center rounded-lg border" style={{ borderColor: 'var(--line)', background: 'var(--card)', color: 'var(--fg-2)' }}>
              <svg width="15" height="15" viewBox="0 0 20 20" fill="none">
                <path d="M3 6h14M3 14h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <circle cx="7.5" cy="6" r="2.1" fill="var(--card)" stroke="currentColor" strokeWidth="1.5" />
                <circle cx="13" cy="14" r="2.1" fill="var(--card)" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </a>
          </div>
        </div>

        <StatusBanner status={data.overall} downCount={downCount} />

        <div className="mt-2 flex items-center justify-between">
          <div className="font-semibold" style={{ fontSize: 15 }}>系统状态</div>
          <RangeSelect value={range} onChange={(r) => { setRange(r); setTip(null) }} ranges={RANGES} />
        </div>

        <div className="overflow-hidden rounded-xl border" style={{ borderColor: 'var(--line)', background: 'var(--card)', boxShadow: 'var(--shadow)' }}>
          {data.groups.map((g) => (
            <div key={String(g.id)}>
              <GroupRow
                g={{ ...g, currentColor: statusToCode(g.status) }}
                theme={theme}
                expanded={!!open[String(g.id)]}
                onToggle={() => toggleGroup(g.id)}
                onHover={hoverGroupBar}
                onLeave={() => setTip(null)}
                summary={groupSummary(g)}
                rangeStartLabel={rangeStartLabel(range)}
              />
              {open[String(g.id)] && (
                <div className="flex flex-col px-5 pb-1.5 pl-[30px]">
                  {g.monitors.map((m) => (
                    <MonitorRow key={m.id} m={{ ...m, currentColor: statusToCode(m.status) }} theme={theme} range={range} onHover={hoverMonitorBar} onLeave={() => setTip(null)} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        <Legend theme={theme} updatedText={`每 30 秒自动刷新 · 时区 ${data.timezone}`} />

        <div style={{ fontSize: 11.5, color: 'var(--fg-3)', lineHeight: 1.7, borderTop: '1px solid var(--line)', paddingTop: 16 }}>
          每个记号代表一个检查间隔，间隔内的重试不单独计入 —— 记号密度恒等于检查间隔。灰色缺口表示该时段没有采集到数据，不计入可用率分母。
        </div>
      </div>
      <BarTooltip tip={tip} />
    </div>
  )
}
