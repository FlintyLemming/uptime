import { expect, test } from 'bun:test'
import { renderTemplate, formatSlotTime, type TemplateVars } from './template'

const vars: TemplateVars = {
  event: 'down', monitor_name: 'API', monitor_type: 'http', target: 'https://a.com',
  group_name: 'Core', status: 'down', error: 'connection refused "quoted"',
  attempts: '4', slot_started_at: '2026-08-11T12:30:00+08:00', down_duration_s: '', url: 'https://s.io/m/1',
}

test('renders all known placeholders', () => {
  const out = renderTemplate('{"e":"{{event}}","m":"{{monitor_name}}","t":"{{target}}"}', vars)
  expect(out).toBe('{"e":"down","m":"API","t":"https://a.com"}')
})

test('json-escapes inserted values so quotes cannot break the payload', () => {
  const out = renderTemplate('{"error":"{{error}}"}', vars)
  expect(out).toBe('{"error":"connection refused \\"quoted\\""}')
  expect(JSON.parse(out).error).toBe('connection refused "quoted"')
})

test('unknown placeholders are left untouched', () => {
  expect(renderTemplate('{{nope}} {{event}}', vars)).toBe('{{nope}} down')
})

test('formatSlotTime renders ISO8601 with timezone offset', () => {
  const sec = 1786422600                           // 2026-08-11T04:30:00Z
  expect(formatSlotTime(sec, 'Asia/Shanghai')).toBe('2026-08-11T12:30:00+08:00')
  expect(formatSlotTime(sec, 'UTC')).toBe('2026-08-11T04:30:00+00:00')
})
