/** slot 起点：对齐 UTC epoch，floor(now / interval) * interval */
export function slotStartAt(nowSec: number, intervalS: number): number {
  return Math.floor(nowSec / intervalS) * intervalS
}

/** 严格在 now 之后的下一个边界（now 恰在边界上时返回下一格） */
export function nextSlotStart(nowSec: number, intervalS: number): number {
  return slotStartAt(nowSec, intervalS) + intervalS
}

/** 重试预算被 slot 边界硬截断（设计文档 §3.4） */
export function effectiveRetries(o: { intervalS: number; retryIntervalS: number; maxRetries: number; timeoutMs: number }): number {
  const cap = Math.floor((o.intervalS * 1000 - o.timeoutMs) / (o.retryIntervalS * 1000))
  return Math.max(0, Math.min(o.maxRetries, cap))
}
