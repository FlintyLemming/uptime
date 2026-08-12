import type { EntityStatus } from '../lib/types'

const CHECK_ICON = 'M11 17l4 4 8-8'
const ALERT_ICON = 'M17 10v8M17 23.2v.1'

export default function StatusBanner({ status, downCount }: { status: EntityStatus; downCount: number }) {
  const meta =
    status === 'down'
      ? { title: downCount > 1 ? `${downCount} 个服务当前宕机` : '1 个服务当前宕机', sub: '我们已经发现问题并正在处理中。', color: '#f87171', icon: ALERT_ICON }
      : status === 'degraded'
        ? { title: '部分服务性能下降', sub: '部分服务出现闪断，重试后已恢复，可用性未中断。', color: '#fbbf24', icon: ALERT_ICON }
        : status === 'nodata'
          ? { title: '状态未知', sub: '没有采集到任何数据。', color: '#e4e4e7', icon: ALERT_ICON }
          : { title: '所有系统运行正常', sub: '我们目前没有发现任何问题。', color: '#24c19a', icon: CHECK_ICON }
  return (
    <div className="flex items-start gap-[14px] rounded-xl border p-[20px_22px]" style={{ borderColor: 'var(--line)', background: 'var(--card)', boxShadow: 'var(--shadow)' }}>
      <div className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-full">
        <svg width="34" height="34" viewBox="0 0 34 34" fill="none">
          <circle cx="17" cy="17" r="16" fill={meta.color} />
          <path d={meta.icon} stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <div className="flex flex-col gap-[3px]">
        <div className="font-semibold" style={{ fontSize: 18, letterSpacing: '-.01em' }}>{meta.title}</div>
        <div style={{ fontSize: 13.5, color: 'var(--fg-2)' }}>{meta.sub}</div>
      </div>
    </div>
  )
}
