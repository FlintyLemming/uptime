import type { SlotStatus } from '../scheduler/slot-runner'

export type AlertEvent = 'down' | 'recovered'

/**
 * 设计文档 §6.1：prev 是上一个非 nodata slot 的状态（null = 之前没有）。
 * 只有真正的状态转换才产出事件；flaky 永远静默。
 */
export function transitionEvent(prev: SlotStatus | null, cur: SlotStatus): AlertEvent | null {
  const prevDown = prev === 2
  const curDown = cur === 2
  if (!prevDown && curDown) return 'down'
  if (prevDown && !curDown) return 'recovered'
  return null
}
