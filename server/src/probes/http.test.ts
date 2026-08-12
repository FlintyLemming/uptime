import { afterAll, expect, test } from 'bun:test'
import { httpProbe } from './http'
import type { ProbeConfig } from './types'

let baseUrl = ''
const server = Bun.serve({
  port: 0,
  fetch(req): Response | Promise<Response> {
    const url = new URL(req.url)
    if (url.pathname === '/ok') return new Response('hello world')
    if (url.pathname === '/json') return Response.json({ status: 'pass' })
    if (url.pathname === '/bad-json') return Response.json({ status: 'fail' })
    if (url.pathname === '/teapot') return new Response('teapot', { status: 418 })
    if (url.pathname === '/redirect') return Response.redirect(`${baseUrl}/ok`, 302)
    if (url.pathname === '/slow') return new Promise<Response>((res) =>
      setTimeout(() => res(new Response('late')), 2000))
    return new Response('not found', { status: 404 })
  },
})
baseUrl = `http://127.0.0.1:${server.port}`

afterAll(() => server.stop(true))

function cfg(path: string, config: Record<string, unknown> = {}, timeoutMs = 3000): ProbeConfig {
  return { type: 'http', target: `http://127.0.0.1:${server.port}${path}`, port: null, timeoutMs, config }
}

test('http success with default accepted codes', async () => {
  const r = await httpProbe.run(cfg('/ok'), AbortSignal.timeout(4000))
  expect(r.ok).toBe(true)
  expect(r.latencyMs).not.toBeNull()
})

test('status code outside accepted range fails with message', async () => {
  const r = await httpProbe.run(cfg('/teapot'), AbortSignal.timeout(4000))
  expect(r.ok).toBe(false)
  expect(r.error).toContain('418')
})

test('custom accepted codes accept 418', async () => {
  const r = await httpProbe.run(cfg('/teapot', { accepted_status_codes: ['418'] }), AbortSignal.timeout(4000))
  expect(r.ok).toBe(true)
})

test('range accepted codes like 200-299', async () => {
  const r = await httpProbe.run(cfg('/ok', { accepted_status_codes: ['200-299', '418'] }), AbortSignal.timeout(4000))
  expect(r.ok).toBe(true)
})

test('keyword match and mismatch', async () => {
  expect((await httpProbe.run(cfg('/ok', { keyword: 'hello' }), AbortSignal.timeout(4000))).ok).toBe(true)
  expect((await httpProbe.run(cfg('/ok', { keyword: 'goodbye' }), AbortSignal.timeout(4000))).ok).toBe(false)
})

test('keyword invert flips match', async () => {
  expect((await httpProbe.run(cfg('/ok', { keyword: 'hello', keyword_invert: true }), AbortSignal.timeout(4000))).ok).toBe(false)
  expect((await httpProbe.run(cfg('/ok', { keyword: 'goodbye', keyword_invert: true }), AbortSignal.timeout(4000))).ok).toBe(true)
})

test('json_query with expected value', async () => {
  expect((await httpProbe.run(cfg('/json', { json_query: 'status', json_expected: 'pass' }), AbortSignal.timeout(4000))).ok).toBe(true)
  const bad = await httpProbe.run(cfg('/bad-json', { json_query: 'status', json_expected: 'pass' }), AbortSignal.timeout(4000))
  expect(bad.ok).toBe(false)
  expect(bad.error).toContain('json')
})

test('follow_redirects default true, false keeps 302', async () => {
  expect((await httpProbe.run(cfg('/redirect'), AbortSignal.timeout(4000))).ok).toBe(true)
  const r = await httpProbe.run(cfg('/redirect', { follow_redirects: false, accepted_status_codes: ['300-399'] }), AbortSignal.timeout(4000))
  expect(r.ok).toBe(true)
})

test('timeout becomes ProbeResult error, never throws', async () => {
  const r = await httpProbe.run(cfg('/slow', {}, 200), AbortSignal.timeout(4000))
  expect(r.ok).toBe(false)
  expect(r.error).toContain('timeout')
})
