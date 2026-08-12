import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { LineChart, Line, XAxis, YAxis, Tooltip as RTooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { fetchTimeseries } from '../lib/api'
import { useTheme } from '../lib/theme'
import { timeLabel } from '../lib/format'
import UptimeBar from '../components/UptimeBar'
import RangeTabs from '../components/RangeTabs'
import { colorOf } from '../lib/status-color'
import type { TimeseriesResponse } from '../lib/types'

type Range = '24h' | '7d' | '30d'
const RANGES: Array<{ key: Range; label: string }> = [
  { key: '24h', label: '24 小时' }, { key: '7d', label: '7 天' }, { key: '30d', label: '30 天' },
]
const SLOT_STATUS_TEXT = ['正常', '闪断', '离线'] as const

export default function MonitorDetailPage() {
  const { id } = useParams()
  const { theme } = useTheme()
  const [range, setRange] = useState<Range>('24h')
  const [data, setData] = useState<TimeseriesResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchTimeseries(Number(id), range).then(setData).catch((e) => setError(String(e.message)))
  }, [id, range])

  if (error) return <div className="p-10 text-center" style={{ color: 'var(--fg-2)' }}>加载失败：{error}</div>
  if (!data) return null

  const intervalS = data.monitor.interval_s
  const count = range === '24h' ? Math.floor(86400 / intervalS) : 0
  const bars = range === '24h'
    ? (() => {
        const byStart = new Map(data.slots.map((s) => [s.started_at, s]))
        const latest = Math.floor(Date.now() / 1000 / intervalS) * intervalS
        return Array.from({ length: count }, (_, i) => {
          const t = latest - (count - 1 - i) * intervalS
          const row = byStart.get(t)
          return { t, s: row ? (row.status === 0 ? 0 : row.status === 1 ? 1 : 3) : 4 }
        })
      })()
    : data.daily.map((d) => {
        const n = d.up + d.flaky + d.down
        return { t: Date.parse(d.day) / 1000, s: n === 0 ? 4 : d.down === 0 ? (d.flaky === 0 ? 0 : 1) : d.down / n < 0.05 ? 2 : 3 }
      })

  const cert = data.slots.find((s) => s.cert_days_left !== null)?.cert_days_left ?? data.slots.at(-1)?.cert_days_left ?? null
  const chartData = range === '24h'
    ? data.slots.filter((s) => s.latency_ms !== null).map((s) => ({ t: timeLabel(s.started_at), p50: s.latency_ms }))
    : data.daily.filter((d) => d.latency_p50 !== null).map((d) => ({ t: d.day.slice(5), p50: d.latency_p50, p95: d.latency_p95 }))

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)', color: 'var(--fg)', padding: '40px 20px 80px' }}>
      <div className="mx-auto flex max-w-[820px] flex-col gap-6">
        <Link to="/" className="w-fit" style={{ fontSize: 12.5, color: 'var(--fg-3)' }}>← 返回状态页</Link>

        <div className="flex items-center gap-[10px]">
          <span className="h-[9px] w-[9px] rounded-full" style={{ background: colorOf(bars[bars.length - 1]?.s ?? 4, theme) }} />
          <span className="font-semibold" style={{ fontSize: 16 }}>{data.monitor.name}</span>
          <span style={{ fontSize: 12.5, color: 'var(--fg-3)', fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace' }}>{data.monitor.target}</span>
          {cert !== null && (
            <span className="ml-auto rounded-[20px] px-[7px] py-[2px]" style={{ fontSize: 11.5, color: cert < 7 ? '#dc2625' : cert < 30 ? '#d97706' : 'var(--fg-2)', background: 'var(--bg-sub)' }}>
              证书剩余 {cert} 天
            </span>
          )}
        </div>

        <div className="flex items-center justify-between">
          <div className="font-semibold" style={{ fontSize: 15 }}>检查记录</div>
          <RangeTabs value={range} onChange={setRange} ranges={RANGES} />
        </div>

        <div className="flex flex-col gap-4 rounded-xl border p-[20px_22px]" style={{ borderColor: 'var(--line)', background: 'var(--card)', boxShadow: 'var(--shadow)' }}>
          <UptimeBar bars={bars} theme={theme} />
          <div className="h-[220px]">
            <ResponsiveContainer>
              <LineChart data={chartData}>
                <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="t" tick={{ fontSize: 11, fill: 'var(--fg-3)' }} minTickGap={40} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--fg-3)' }} width={44} axisLine={false} tickLine={false} unit="ms" />
                <RTooltip contentStyle={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12 }} />
                <Line type="monotone" dataKey="p50" name="p50" stroke="#24c19a" dot={false} strokeWidth={1.5} />
                <Line type="monotone" dataKey="p95" name="p95" stroke="#fbbf24" dot={false} strokeWidth={1.5} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border" style={{ borderColor: 'var(--line)', background: 'var(--card)', boxShadow: 'var(--shadow)' }}>
          <table className="w-full" style={{ fontSize: 12.5 }}>
            <thead>
              <tr style={{ color: 'var(--fg-3)', borderBottom: '1px solid var(--line)' }}>
                <th className="px-4 py-2.5 text-left font-medium">时间</th>
                <th className="px-4 py-2.5 text-left font-medium">状态</th>
                <th className="px-4 py-2.5 text-right font-medium">耗时</th>
                <th className="px-4 py-2.5 text-right font-medium">尝试</th>
                <th className="px-4 py-2.5 text-left font-medium">错误</th>
              </tr>
            </thead>
            <tbody>
              {[...data.slots].reverse().slice(0, 50).map((s) => (
                <tr key={s.started_at} style={{ borderTop: '1px solid var(--line)' }}>
                  <td className="px-4 py-2" style={{ fontVariantNumeric: 'tabular-nums' }}>{timeLabel(s.started_at)}</td>
                  <td className="px-4 py-2" style={{ color: colorOf(s.status === 0 ? 0 : s.status === 1 ? 1 : 3, theme) }}>{SLOT_STATUS_TEXT[s.status]}</td>
                  <td className="px-4 py-2 text-right">{s.latency_ms === null ? '—' : `${s.latency_ms} ms`}</td>
                  <td className="px-4 py-2 text-right">{s.attempts}</td>
                  <td className="px-4 py-2" style={{ color: 'var(--fg-3)' }}>{s.error ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
