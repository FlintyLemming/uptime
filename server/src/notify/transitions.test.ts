import { expect, test } from 'bun:test'
import { transitionEvent } from './transitions'

test('up -> down triggers down', () => {
  expect(transitionEvent(0, 2)).toBe('down')
})

test('flaky -> down triggers down', () => {
  expect(transitionEvent(1, 2)).toBe('down')
})

test('down -> up triggers recovered', () => {
  expect(transitionEvent(2, 0)).toBe('recovered')
})

test('down -> flaky triggers recovered', () => {
  expect(transitionEvent(2, 1)).toBe('recovered')
})

test('flaky never triggers anything', () => {
  expect(transitionEvent(0, 1)).toBeNull()         // up -> flaky
  expect(transitionEvent(1, 0)).toBeNull()         // flaky -> up
  expect(transitionEvent(1, 1)).toBeNull()         // flaky -> flaky
})

test('stable states trigger nothing', () => {
  expect(transitionEvent(0, 0)).toBeNull()
  expect(transitionEvent(2, 2)).toBeNull()         // 连续 down 只报一次
})

test('first-ever slot down triggers down; first-ever up triggers nothing', () => {
  expect(transitionEvent(null, 2)).toBe('down')
  expect(transitionEvent(null, 0)).toBeNull()
  expect(transitionEvent(null, 1)).toBeNull()
})

test('nodata gaps never produce fake transitions (query side skips nodata, so prev is the last real slot)', () => {
  // 场景：down, nodata, nodata, up —— 查询侧跳过 nodata 后 prev 仍是 down，产生 recovered
  expect(transitionEvent(2, 0)).toBe('recovered')
  // 场景：up, nodata, down —— prev 是 up，产生 down
  expect(transitionEvent(0, 2)).toBe('down')
  // 场景：up, nodata, up —— 无事件
  expect(transitionEvent(0, 0)).toBeNull()
})
