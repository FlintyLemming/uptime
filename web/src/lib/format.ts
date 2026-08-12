export function fmtPct(x: number): string {
  const p = x * 100
  return (p >= 99.995 ? '100' : p.toFixed(2)) + '%'
}

export function dayLabel(unixSec: number): string {
  const d = new Date(unixSec * 1000)
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`
}

export function timeLabel(unixSec: number): string {
  const d = new Date(unixSec * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function dur(s: number): string {
  if (s < 60) return `${s} 秒`
  if (s < 3600) return `${Math.round(s / 60)} 分钟`
  return `${(s / 3600).toFixed(1)} 小时`
}
