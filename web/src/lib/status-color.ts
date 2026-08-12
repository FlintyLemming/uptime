export const BAR_COLORS = {
  up: '#24c19a', degraded: '#fbbf24', partial: '#f5785c', down: '#f87171',
  nodataLight: '#e4e4e7', nodataDark: '#39393f',
} as const

export function dayColor(dy: { up: number; flaky: number; down: number }): 0 | 1 | 2 | 3 | 4 {
  const n = dy.up + dy.flaky + dy.down
  if (n === 0) return 4
  if (dy.down === 0) return dy.flaky === 0 ? 0 : 1
  return dy.down / n < 0.05 ? 2 : 3
}

export function colorOf(code: number, theme: 'light' | 'dark'): string {
  return code === 0 ? BAR_COLORS.up
    : code === 1 ? BAR_COLORS.degraded
    : code === 2 ? BAR_COLORS.partial
    : code === 3 ? BAR_COLORS.down
    : theme === 'dark' ? BAR_COLORS.nodataDark : BAR_COLORS.nodataLight
}

export const STATUS_RANK: Record<string, number> = { nodata: -1, operational: 0, degraded: 1, down: 2 }

export function worstStatus(list: string[]): string {
  return list.reduce((a, b) => ((STATUS_RANK[b] ?? -1) > (STATUS_RANK[a] ?? -1) ? b : a), 'nodata')
}
