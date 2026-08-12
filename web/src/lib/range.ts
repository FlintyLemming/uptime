// 与后端 aggregate.ts 的 RANGE_SECONDS 保持一致
export const RANGE_SECONDS: Record<string, number> = {
  '1h': 3600, '3h': 3 * 3600, '6h': 6 * 3600, '12h': 12 * 3600,
  '24h': 86400, '7d': 7 * 86400, '30d': 30 * 86400, '90d': 90 * 86400,
}

export type StatusRange = '1h' | '3h' | '6h' | '12h' | '24h' | '30d' | '90d'
export type DetailRange = '1h' | '3h' | '6h' | '12h' | '24h' | '7d' | '30d'

// 小时档（≤24h）展示 slot 明细；日档展示 slot_daily 聚合
export const isHourRange = (r: string): boolean => (RANGE_SECONDS[r] ?? 0) <= 86400 && (RANGE_SECONDS[r] ?? 0) > 0
