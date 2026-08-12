import { expect, test } from 'bun:test'
import { slotStartAt, nextSlotStart, effectiveRetries } from './clock'

test('slotStartAt aligns to UTC epoch grid for arbitrary now', () => {
  const interval = 120
  for (const now of [0, 1, 119, 120, 121, 1_700_000_037, 1_700_000_159]) {
    const start = slotStartAt(now, interval)
    expect(start % interval).toBe(0)
    expect(start).toBeLessThanOrEqual(now)
    expect(now).toBeLessThan(start + interval)
  }
})

test('nextSlotStart is strictly in the future and lands on a boundary', () => {
  expect(nextSlotStart(120, 120)).toBe(240)        // 恰在边界上 → 下一格
  expect(nextSlotStart(121, 120)).toBe(240)
  expect(nextSlotStart(239, 120)).toBe(240)
})

test('interval change takes effect from next boundary', () => {
  const now = 1_700_000_037                        // 旧 interval 60 的某个 slot 中间
  expect(nextSlotStart(now, 60)).toBe(1_700_000_040)
  expect(nextSlotStart(now, 300)).toBe(1_700_000_100)
})

test('effectiveRetries: spec example 120/30/max4/timeout10s -> 3', () => {
  expect(effectiveRetries({ intervalS: 120, retryIntervalS: 30, maxRetries: 4, timeoutMs: 10_000 })).toBe(3)
})

test('effectiveRetries: budget smaller than boundary cap', () => {
  expect(effectiveRetries({ intervalS: 120, retryIntervalS: 30, maxRetries: 1, timeoutMs: 10_000 })).toBe(1)
})

test('effectiveRetries: exact divisibility boundary', () => {
  // (60000 - 10000) / 10000 = 5 整除
  expect(effectiveRetries({ intervalS: 60, retryIntervalS: 10, maxRetries: 10, timeoutMs: 10_000 })).toBe(5)
})

test('effectiveRetries: timeout close to retry interval squeezes budget', () => {
  // (120000 - 30000) / 30000 = 3
  expect(effectiveRetries({ intervalS: 120, retryIntervalS: 30, maxRetries: 10, timeoutMs: 30_000 })).toBe(3)
  // timeout 逼近但小于 retry interval: (120000 - 29999) / 30000 = 3.0000...
  expect(effectiveRetries({ intervalS: 120, retryIntervalS: 30, maxRetries: 10, timeoutMs: 29_999 })).toBe(3)
  // timeout 吃满一个 retry 间隔以上: (120000 - 60000) / 30000 = 2
  expect(effectiveRetries({ intervalS: 120, retryIntervalS: 30, maxRetries: 10, timeoutMs: 60_000 })).toBe(2)
})

test('effectiveRetries never negative', () => {
  expect(effectiveRetries({ intervalS: 60, retryIntervalS: 55, maxRetries: 10, timeoutMs: 50_000 })).toBe(0)
})
