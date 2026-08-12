import { useEffect, useRef, useState } from 'react'

// 时间段下拉选择：7 个选项时分段按钮过宽，改用下拉框。
// 样式沿用现有设计令牌（--card/--line/--shadow/--fg-*），与主题切换、管理入口按钮同款。
export default function RangeSelect<T extends string>({ value, onChange, ranges }: {
  value: T; onChange: (v: T) => void; ranges: Array<{ key: T; label: string }>
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!wrapRef.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const current = ranges.find((r) => r.key === value)

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex cursor-pointer items-center gap-[6px] rounded-lg border px-[11px] py-[5px] font-medium hover:bg-[var(--bg-sub)]"
        style={{
          fontFamily: 'inherit', fontSize: 12.5,
          background: 'var(--card)', color: 'var(--fg)',
          borderColor: 'var(--line)', boxShadow: 'var(--shadow)',
        }}
      >
        {current?.label ?? value}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ color: 'var(--fg-3)', transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }}>
          <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute right-0 z-20 min-w-full overflow-hidden rounded-lg border p-[4px]"
          style={{ background: 'var(--card)', borderColor: 'var(--line)', boxShadow: 'var(--shadow), 0 8px 24px rgba(15,23,42,.10)', listStyle: 'none', margin: 0, marginTop: 5 }}
        >
          {ranges.map((r) => (
            <li key={r.key}>
              <button
                role="option"
                aria-selected={r.key === value}
                onClick={() => { onChange(r.key); setOpen(false) }}
                className="flex w-full cursor-pointer items-center justify-between gap-[14px] rounded-md px-[9px] py-[6px] text-left font-medium hover:bg-[var(--bg-sub)]"
                style={{
                  border: 0, fontFamily: 'inherit', fontSize: 12.5,
                  background: 'transparent',
                  color: r.key === value ? 'var(--fg)' : 'var(--fg-2)',
                }}
              >
                {r.label}
                {r.key === value && (
                  <svg width="11" height="11" viewBox="0 0 20 20" fill="none" style={{ color: 'var(--fg)' }}>
                    <path d="M4.5 10.5l3.5 3.5 7.5-7.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
