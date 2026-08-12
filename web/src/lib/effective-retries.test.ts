import { expect, it } from 'vitest'
import { effectiveRetries, timeoutViolatesBudget } from './effective-retries'

it('matches the spec example: 120/30/max4/timeout10s -> 3', () => {
  expect(effectiveRetries({ intervalS: 120, retryIntervalS: 30, maxRetries: 4, timeoutMs: 10000 })).toBe(3)
})

it('caps at max_retries when budget is larger', () => {
  expect(effectiveRetries({ intervalS: 300, retryIntervalS: 10, maxRetries: 2, timeoutMs: 5000 })).toBe(2)
})

it('never negative', () => {
  expect(effectiveRetries({ intervalS: 60, retryIntervalS: 55, maxRetries: 10, timeoutMs: 50000 })).toBe(0)
})

it('timeoutViolatesBudget flags timeout >= retry_interval*1000', () => {
  expect(timeoutViolatesBudget(20000, 20)).toBe(true)
  expect(timeoutViolatesBudget(19999, 20)).toBe(false)
})
