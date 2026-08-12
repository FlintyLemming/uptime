import { describe, expect, it } from 'vitest'
import { colorOf, dayColor, BAR_COLORS } from './status-color'

describe('dayColor (spec 7.3, mirrored from mock)', () => {
  it.each([
    [{ up: 720, flaky: 0, down: 0 }, 0],
    [{ up: 719, flaky: 1, down: 0 }, 1],
    [{ up: 716, flaky: 0, down: 4 }, 2],           // 4/720 < 5%
    [{ up: 712, flaky: 0, down: 38 }, 3],          // 38/750 ≥ 5% → 完全宕机（mock dayColor）
    [{ up: 0, flaky: 0, down: 0 }, 4],
  ] as const)('dayColor(%j) === %i', (day, expected) => {
    expect(dayColor(day)).toBe(expected)
  })

  it('boundary: exactly 5% down is full-outage', () => {
    expect(dayColor({ up: 95, flaky: 0, down: 5 })).toBe(3)
    expect(dayColor({ up: 95, flaky: 0, down: 4 })).toBe(2)
  })
})

describe('colorOf', () => {
  it('maps bar codes to mock palette', () => {
    expect(colorOf(0, 'light')).toBe('#24c19a')
    expect(colorOf(1, 'light')).toBe('#fbbf24')
    expect(colorOf(2, 'light')).toBe('#f5785c')
    expect(colorOf(3, 'light')).toBe('#f87171')
    expect(colorOf(4, 'light')).toBe('#e4e4e7')
    expect(colorOf(4, 'dark')).toBe('#39393f')
  })
  it('exports the exact palette', () => {
    expect(BAR_COLORS.up).toBe('#24c19a')
    expect(BAR_COLORS.down).toBe('#f87171')
  })
})
