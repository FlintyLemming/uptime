export default function StaleDataNotice({ lastUpdatedAt }: { lastUpdatedAt: number }) {
  const t = new Date(lastUpdatedAt)
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    <div className="rounded-lg border px-3 py-2" style={{ borderColor: '#fbbf24', background: 'rgba(251,191,36,.08)', color: 'var(--fg-2)', fontSize: 12.5 }}>
      数据可能已过期，最后更新于 {p(t.getHours())}:{p(t.getMinutes())}:{p(t.getSeconds())}
    </div>
  )
}
