import { expect, it } from 'vitest'
import { fmtPct, dur } from './format'

it('fmtPct rounds to 2 decimals and shows 100 near-perfect', () => {
  expect(fmtPct(1)).toBe('100%')
  expect(fmtPct(0.99999)).toBe('100%')
  expect(fmtPct(0.999)).toBe('99.90%')
  expect(fmtPct(0.5)).toBe('50.00%')
})

it('dur formats seconds/minutes/hours in Chinese units', () => {
  expect(dur(45)).toBe('45 秒')
  expect(dur(120)).toBe('2 分钟')
  expect(dur(7200)).toBe('2.0 小时')
})
