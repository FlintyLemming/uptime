import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import UptimeBar from './UptimeBar'
import type { Bar } from '../lib/types'

const bars90: Bar[] = Array.from({ length: 90 }, (_, i) => ({ t: i, s: i === 89 ? 3 : 0 }))

describe('UptimeBar geometry (mirrors mock)', () => {
  it('renders one rect per bar inside a 668-wide viewBox', () => {
    const { container } = render(<UptimeBar bars={bars90} theme="light" />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('viewBox')).toBe('0 0 668 16')
    expect(svg.querySelectorAll('rect').length).toBe(90)
  })

  it('90 bars: step 7.42, width 5.08 (668/90 - 2.34)', () => {
    const { container } = render(<UptimeBar bars={bars90} theme="light" />)
    const first = container.querySelector('rect')!
    expect(first.getAttribute('x')).toBe('0.00')
    expect(Number(first.getAttribute('width'))).toBeCloseTo(668 / 90 - 2.34, 2)
  })

  it('24 bars use gap 6 and min width 4', () => {
    const bars24: Bar[] = Array.from({ length: 24 }, (_, i) => ({ t: i, s: 0 }))
    const { container } = render(<UptimeBar bars={bars24} theme="light" />)
    const first = container.querySelector('rect')!
    expect(Number(first.getAttribute('width'))).toBeCloseTo(668 / 24 - 6, 2)
  })

  it('colors last bar down-red and others green', () => {
    const { container } = render(<UptimeBar bars={bars90} theme="light" />)
    const rects = container.querySelectorAll('rect')
    expect(rects[0]!.getAttribute('fill')).toBe('#24c19a')
    expect(rects[89]!.getAttribute('fill')).toBe('#f87171')
  })
})
