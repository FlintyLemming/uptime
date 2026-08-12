import UptimeBar from './UptimeBar'
import { colorOf } from '../lib/status-color'
import { fmtPct } from '../lib/format'
import type { StatusGroup } from '../lib/types'

export default function GroupRow({ g, theme, expanded, onToggle, onHover, onLeave, summary, rangeStartLabel }: {
  g: StatusGroup & { currentColor: number }
  theme: 'light' | 'dark'
  expanded: boolean
  onToggle: () => void
  onHover: (barIdx: number, rect: DOMRect, group: StatusGroup) => void
  onLeave: () => void
  summary: string
  rangeStartLabel: string
}) {
  return (
    <div className="border-t" style={{ borderColor: 'var(--line)' }}>
      <div onClick={onToggle} className="flex cursor-pointer flex-col gap-[11px] px-5 pt-4 pb-[14px] hover:bg-[var(--bg-sub)]">
        <div className="flex items-center gap-[10px]">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ color: 'var(--fg-3)', transform: `rotate(${expanded ? 90 : 0}deg)`, transition: 'transform .16s' }}>
            <path d="M4 2.5L8 6l-4 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="h-[9px] w-[9px] flex-none rounded-full" style={{ background: colorOf(g.currentColor, theme) }} />
          <span className="font-semibold whitespace-nowrap" style={{ fontSize: 14, letterSpacing: '-.005em' }}>{g.name}</span>
          <span style={{ fontSize: 12.5, color: 'var(--fg-3)' }}>{g.monitors.length} 个组件</span>
          <span className="ml-auto" style={{ fontSize: 12.5, color: 'var(--fg-2)', fontVariantNumeric: 'tabular-nums' }}>{fmtPct(g.uptime)} 可用</span>
        </div>
        <UptimeBar bars={g.bars} theme={theme} onLeave={onLeave} onHover={(bar, rect) => onHover(g.bars.indexOf(bar), rect, g)} />
        <div className="flex justify-between" style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>
          <span>{rangeStartLabel}</span>
          <span>{summary}</span>
          <span>现在</span>
        </div>
      </div>
    </div>
  )
}
