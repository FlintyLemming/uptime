import UptimeBar from './UptimeBar'
import { colorOf } from '../lib/status-color'
import { fmtPct } from '../lib/format'
import type { StatusMonitor } from '../lib/types'
import { Link } from 'react-router-dom'

export default function MonitorRow({ m, theme, onHover, onLeave }: {
  m: StatusMonitor & { currentColor: number }
  theme: 'light' | 'dark'
  range: '90d' | '30d' | '24h'
  onHover: (barIdx: number, rect: DOMRect, monitor: StatusMonitor) => void
  onLeave: () => void
}) {
  return (
    <div className="flex flex-col gap-[9px] border-t border-dashed py-[13px_0_15px]" style={{ borderColor: 'var(--line)', borderTopStyle: 'dashed' }}>
      <div className="flex items-center gap-[9px]">
        <span className="h-[7px] w-[7px] flex-none rounded-full" style={{ background: colorOf(m.currentColor, theme) }} />
        <Link to={`/m/${m.id}`} className="truncate font-medium hover:underline" style={{ fontSize: 13.5, color: 'var(--fg)' }}>{m.name}</Link>
        <span className="ml-auto flex flex-none items-center gap-[10px]">
          {m.flaky_count > 0 && (
            <span
              className="rounded-[20px] px-[7px] py-[2px]"
              style={{
                fontSize: 11.5, whiteSpace: 'nowrap',
                background: theme === 'dark' ? 'rgba(251,191,36,.14)' : '#fef3c7',
                color: theme === 'dark' ? '#fbbf24' : '#b45309',
              }}
            >
              {m.flaky_count} 次闪断
            </span>
          )}
          <span style={{ fontSize: 12.5, color: 'var(--fg-2)', fontVariantNumeric: 'tabular-nums' }}>{fmtPct(m.uptime)}</span>
        </span>
      </div>
      <UptimeBar
        bars={m.bars}
        theme={theme}
        onLeave={onLeave}
        onHover={(bar, rect) => onHover(m.bars.indexOf(bar), rect, m)}
      />
    </div>
  )
}
