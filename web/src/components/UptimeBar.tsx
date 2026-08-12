import { colorOf } from '../lib/status-color'
import type { Bar } from '../lib/types'

export interface UptimeBarProps {
  bars: Bar[]
  theme: 'light' | 'dark'
  onHover?: (bar: Bar, rect: DOMRect) => void
  onLeave?: () => void
}

export default function UptimeBar({ bars, theme, onHover, onLeave }: UptimeBarProps) {
  const n = bars.length
  const step = 668 / n
  const gap = n >= 90 ? 2.34 : n >= 30 ? 5 : 6
  const w = Math.max(4, step - gap)
  return (
    <svg viewBox="0 0 668 16" width="100%" height={16} preserveAspectRatio="none" onMouseLeave={onLeave}>
      {bars.map((b, i) => (
        <rect
          key={i}
          x={(i * step).toFixed(2)}
          y={0}
          width={w.toFixed(2)}
          height={16}
          rx={1}
          fill={colorOf(b.s, theme)}
          onMouseEnter={(e) => onHover?.(b, e.currentTarget.getBoundingClientRect())}
        />
      ))}
    </svg>
  )
}
