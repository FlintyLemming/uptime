export default function RangeTabs<T extends string>({ value, onChange, ranges }: {
  value: T; onChange: (v: T) => void; ranges: Array<{ key: T; label: string }>
}) {
  return (
    <div className="flex gap-[2px] rounded-[9px] border p-[3px]" style={{ borderColor: 'var(--line)', background: 'var(--bg-sub)' }}>
      {ranges.map((r) => (
        <button
          key={r.key}
          onClick={() => onChange(r.key)}
          className="cursor-pointer rounded-md px-[11px] py-[5px] font-medium"
          style={{
            border: 0, fontFamily: 'inherit', fontSize: 12.5,
            background: value === r.key ? 'var(--card)' : 'transparent',
            color: value === r.key ? 'var(--fg)' : 'var(--fg-3)',
            boxShadow: value === r.key ? 'var(--shadow)' : 'none',
          }}
        >
          {r.label}
        </button>
      ))}
    </div>
  )
}
