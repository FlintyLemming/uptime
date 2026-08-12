import { BAR_COLORS } from '../lib/status-color'

export default function Legend({ theme, updatedText }: { theme: 'light' | 'dark'; updatedText: string }) {
  const items = [
    { color: BAR_COLORS.up, label: '正常' },
    { color: BAR_COLORS.degraded, label: '闪断（重试后恢复）' },
    { color: BAR_COLORS.partial, label: '部分中断' },
    { color: BAR_COLORS.down, label: '离线' },
    { color: theme === 'dark' ? BAR_COLORS.nodataDark : BAR_COLORS.nodataLight, label: '无数据' },
  ]
  return (
    <div className="flex flex-wrap items-center gap-[18px]" style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>
      {items.map((l) => (
        <span key={l.label} className="flex items-center gap-1.5">
          <span className="h-[14px] w-[5px] rounded-[1px]" style={{ background: l.color }} />
          {l.label}
        </span>
      ))}
      <span className="ml-auto">{updatedText}</span>
    </div>
  )
}
