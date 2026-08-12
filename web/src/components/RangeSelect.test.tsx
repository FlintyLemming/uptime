import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, within } from '@testing-library/react'
import RangeSelect from './RangeSelect'

const RANGES = [
  { key: '1h', label: '1 小时' }, { key: '3h', label: '3 小时' }, { key: '24h', label: '24 小时' }, { key: '90d', label: '90 天' },
]

describe('RangeSelect', () => {
  it('shows the current label and opens on click', () => {
    const { getByRole, getByText, queryByRole } = render(<RangeSelect value="24h" onChange={() => {}} ranges={RANGES} />)
    expect(getByRole('button').textContent).toContain('24 小时')
    expect(queryByRole('listbox')).toBeNull()
    fireEvent.click(getByRole('button'))
    expect(getByRole('listbox')).toBeTruthy()
    expect(getByText('1 小时')).toBeTruthy()
  })

  it('selects an option, calls onChange and closes', () => {
    const onChange = vi.fn()
    const { getByRole, getByText, queryByRole } = render(<RangeSelect value="24h" onChange={onChange} ranges={RANGES} />)
    fireEvent.click(getByRole('button'))
    fireEvent.click(getByText('3 小时'))
    expect(onChange).toHaveBeenCalledWith('3h')
    expect(queryByRole('listbox')).toBeNull()
  })

  it('marks the selected option with aria-selected', () => {
    const { getByRole, getByText } = render(<RangeSelect value="90d" onChange={() => {}} ranges={RANGES} />)
    fireEvent.click(getByRole('button'))
    const list = getByRole('listbox')
    expect(within(list).getByText('90 天').closest('button')!.getAttribute('aria-selected')).toBe('true')
    expect(within(list).getByText('1 小时').closest('button')!.getAttribute('aria-selected')).toBe('false')
  })

  it('closes on Escape', () => {
    const { getByRole, queryByRole } = render(<RangeSelect value="24h" onChange={() => {}} ranges={RANGES} />)
    fireEvent.click(getByRole('button'))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(queryByRole('listbox')).toBeNull()
  })
})
