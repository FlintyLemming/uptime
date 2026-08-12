import { expect, test } from 'bun:test'
import { dispatchWebhook } from './dispatcher'

test('succeeds on first 2xx', async () => {
  const calls: RequestInit[] = []
  const fetchImpl = (async (_url: string, init?: RequestInit) => { calls.push(init ?? {}); return new Response('ok', { status: 200 }) }) as unknown as typeof fetch
  const r = await dispatchWebhook({ method: 'POST', url: 'http://x', headers: { 'X-A': '1' }, body: '{}' }, { fetchImpl })
  expect(r.ok).toBe(true)
  expect(r.attempts).toBe(1)
  expect(calls[0]!.headers).toEqual({ 'X-A': '1' })
  expect(calls[0]!.body).toBe('{}')
})

test('retries with backoff and eventually succeeds', async () => {
  let n = 0
  const sleeps: number[] = []
  const fetchImpl = (async () => { n++; return new Response('', { status: n < 3 ? 500 : 204 }) }) as unknown as typeof fetch
  const r = await dispatchWebhook({ method: 'POST', url: 'http://x', headers: {}, body: '' },
    { fetchImpl, sleepImpl: async (ms) => { sleeps.push(ms) } })
  expect(r.ok).toBe(true)
  expect(r.attempts).toBe(3)
  expect(sleeps).toEqual([1000, 4000])
})

test('gives up after 3 retries without throwing', async () => {
  const fetchImpl = (async () => new Response('', { status: 500 })) as unknown as typeof fetch
  const r = await dispatchWebhook({ method: 'POST', url: 'http://x', headers: {}, body: '' },
    { fetchImpl, sleepImpl: async () => {} })
  expect(r.ok).toBe(false)
  expect(r.attempts).toBe(4)                       // 首发 + 3 次重试
})

test('network exception is treated as failure', async () => {
  const fetchImpl = (async () => { throw new Error('ECONNREFUSED') }) as unknown as typeof fetch
  const r = await dispatchWebhook({ method: 'POST', url: 'http://x', headers: {}, body: '' },
    { fetchImpl, sleepImpl: async () => {} })
  expect(r.ok).toBe(false)
  expect(r.attempts).toBe(4)
})
