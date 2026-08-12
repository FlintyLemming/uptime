export interface TipState { x: number; y: number; title: string; line1: string; line2: string }

export default function BarTooltip({ tip }: { tip: TipState | null }) {
  if (!tip) return null
  return (
    <div
      className="pointer-events-none fixed z-50 rounded-lg px-[11px] py-[9px] text-[11.5px] leading-[1.6] whitespace-nowrap shadow-[0_8px_24px_rgba(0,0,0,.18)]"
      style={{ left: tip.x, top: tip.y, transform: 'translate(-50%,-100%)', background: 'var(--fg)', color: 'var(--bg)' }}
    >
      <div className="mb-[2px] font-semibold">{tip.title}</div>
      <div className="opacity-75">{tip.line1}</div>
      <div className="opacity-75">{tip.line2}</div>
    </div>
  )
}
