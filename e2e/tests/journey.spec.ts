/**
 * 端到端验收：计划 06 Task 4 的完整用户旅程（Playwright 驱动真实浏览器）
 *
 * 前置：仓库根目录 `docker compose up -d --build` 已运行，:3000 是全新实例（无用户）。
 * 宿主 0.0.0.0:9999 起一个接收端，既是 webhook 接收器，也是 tcp 监控的开放端口目标。
 * 容器访问宿主用 host.docker.internal（Docker Desktop）。
 */
import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import http from 'node:http'
import { execSync } from 'node:child_process'

const ROOT = '/Users/flintylemming/Projects/uptime'
const BASE = 'http://localhost:3000'
const RECEIVER = 'http://host.docker.internal:9999'
const USERNAME = 'admin'
const PASSWORD = 'password12345'

test.describe.configure({ mode: 'serial' })

let context: BrowserContext
let page: Page
let receiver: http.Server
const received: Array<{ path: string; body: string; at: number }> = []
const tcpMonitor = { id: 0, name: 'TCP 服务端口' }
const httpMonitor = { id: 0, name: 'Example 站点' }

function docker(cmd: string) {
  return execSync(`docker compose ${cmd}`, { cwd: ROOT, stdio: 'pipe' }).toString()
}

async function healthz(deadlineMs = 90_000): Promise<void> {
  const deadline = Date.now() + deadlineMs
  for (;;) {
    try {
      const r = await fetch(`${BASE}/healthz`)
      if (r.ok) return
    } catch { /* container not up yet */ }
    if (Date.now() > deadline) throw new Error('healthz never came up')
    await new Promise((r) => setTimeout(r, 1500))
  }
}

interface StatusDoc {
  site_title: string; timezone: string; overall: string
  groups: Array<{
    name: string; uptime: number
    monitors: Array<{ id: number; name: string; status: string; uptime: number; flaky_count: number; bars: Array<{ t: number; s: number }> }>
  }>
}

async function fetchStatus(range = '24h'): Promise<StatusDoc> {
  const r = await fetch(`${BASE}/api/status?range=${range}`)
  if (!r.ok) throw new Error(`status ${r.status}`)
  return r.json() as Promise<StatusDoc>
}

function findMonitor(doc: StatusDoc, name: string) {
  for (const g of doc.groups) {
    const m = g.monitors.find((x) => x.name === name)
    if (m) return m
  }
  return null
}

/** 轮询 /api/status，直到谓词满足（调度器数据是异步产出的） */
async function waitStatus(pred: (d: StatusDoc) => boolean, timeoutMs = 180_000, label = 'condition', range = '24h'): Promise<StatusDoc> {
  const deadline = Date.now() + timeoutMs
  let last: StatusDoc | null = null
  for (;;) {
    try {
      last = await fetchStatus(range)
      if (pred(last)) return last
    } catch { /* 容器可能短暂不可用 */ }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${label}; last overall=${last ? last.overall : 'none'}`)
    }
    await new Promise((r) => setTimeout(r, 2000))
  }
}

test.beforeAll(async ({ browser }) => {
  // webhook 接收端 + tcp 探测目标（0.0.0.0 使容器经 host.docker.internal 可达）
  receiver = http.createServer((req, res) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => {
      received.push({ path: req.url ?? '', body: data, at: Date.now() })
      res.end('ok')
    })
  })
  await new Promise<void>((resolve) => receiver.listen(9999, '0.0.0.0', resolve))

  await healthz()
  context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  page = await context.newPage()
})

test.afterAll(async () => {
  await context?.close()
  receiver?.close()
})

test('0. healthz 与初始状态', async () => {
  const r = await fetch(`${BASE}/healthz`)
  expect(r.status).toBe(200)
  expect(await r.json()).toEqual({ ok: true, db: 'ok' })
  const setup = await fetch(`${BASE}/api/auth/setup-status`)
  expect(await setup.json()).toEqual({ hasUser: false })
})

test('1. 状态页空态正常', async () => {
  await page.goto('/')
  // 空态：overall = nodata → 横幅「状态未知」
  await expect(page.getByText('状态未知')).toBeVisible()
  await expect(page.getByText('没有采集到任何数据。')).toBeVisible()
  await expect(page.getByText('系统状态')).toBeVisible()
  await expect(page.getByText('每个记号代表一个检查间隔，间隔内的重试不单独计入 —— 记号密度恒等于检查间隔。灰色缺口表示该时段没有采集到数据，不计入可用率分母。')).toBeVisible()
})

test('2. /setup 首次设置并进入管理页；已有用户后 /setup 跳 /login', async () => {
  await page.goto('/setup')
  await page.getByLabel('用户名').fill(USERNAME)
  await page.getByLabel('密码（至少 8 位）').fill(PASSWORD)
  await page.getByLabel('确认密码').fill(PASSWORD)
  await page.getByRole('button', { name: '创建账号' }).click()
  await page.waitForURL('**/admin')
  await expect(page.getByText('监控项（0）')).toBeVisible()

  await page.goto('/setup')
  await page.waitForURL('**/login')
  await expect(page.getByText('登录管理')).toBeVisible()
})

test('3. 未登录访问管理页被踢回登录；错误密码被拒绝；正确密码可登录', async () => {
  const anon = await context.browser()!.newContext()
  const anonPage = await anon.newPage()
  await anonPage.goto('/admin')
  await anonPage.waitForURL('**/login')
  // 错误密码
  await anonPage.getByLabel('用户名').fill(USERNAME)
  await anonPage.getByLabel('密码').fill('wrong-password')
  await anonPage.getByRole('button', { name: '登录' }).click()
  await expect(anonPage.getByText('用户名或密码错误')).toBeVisible()
  // 正确密码
  await anonPage.getByLabel('密码').fill(PASSWORD)
  await anonPage.getByRole('button', { name: '登录' }).click()
  await anonPage.waitForURL('**/admin')
  await expect(anonPage.getByText('监控项（0）')).toBeVisible()
  await anon.close()
})

test('4. 建分组「API」', async () => {
  await page.goto('/admin/groups')
  await page.getByPlaceholder('新分组名称').fill('API')
  await page.getByRole('button', { name: '添加' }).click()
  await expect(page.getByText('分组（1）')).toBeVisible()
  await expect(page.locator('input[value="API"]')).toBeVisible()
})

test('5. 建 http 监控（example.com, 60s）与 tcp 监控（宿主开放端口, 10s）', async () => {
  // http 监控
  await page.goto('/admin/monitors/new')
  await page.getByLabel('名称').fill(httpMonitor.name)
  await page.getByLabel('类型').selectOption('http')
  await page.getByLabel('URL').fill('https://example.com')
  await page.getByLabel('分组').selectOption({ label: 'API' })
  await page.getByLabel('检查间隔（秒）').fill('60')
  // 实时有效重试提示：60/20/3/10000 → floor((60000-10000)/20000)=2 < 3
  await expect(page.getByText('本间隔内实际最多重试 2 次，超出部分不会执行')).toBeVisible()
  await page.getByRole('button', { name: '保存' }).click()
  await page.waitForURL('**/admin')
  await expect(page.getByText('监控项（1）')).toBeVisible()

  // tcp 监控：目标 = 宿主接收端端口；10s 间隔加快故障/恢复节奏
  await page.goto('/admin/monitors/new')
  await page.getByLabel('名称').fill(tcpMonitor.name)
  await page.getByLabel('类型').selectOption('tcp')
  await page.getByLabel('主机').fill('host.docker.internal')
  await page.getByLabel('端口').fill('9999')
  await page.getByLabel('分组').selectOption({ label: 'API' })
  await page.getByLabel('检查间隔（秒）').fill('10')
  await page.getByLabel('重试间隔（秒）').fill('2')
  await page.getByLabel('最大重试次数').fill('2')
  await page.getByLabel('超时（毫秒）').fill('1500')
  await page.getByRole('button', { name: '保存' }).click()
  await page.waitForURL('**/admin')
  await expect(page.getByText('监控项（2）')).toBeVisible()

  // 管理页「测试」按钮：http 探测直接打通（行按创建顺序排列，http 在第一行）
  await page.getByRole('button', { name: '测试' }).first().click()
  await expect(page.getByText(/ms$/).first()).toBeVisible({ timeout: 20_000 })

  // 记下 id，供后续编辑/详情用
  const doc = await fetchStatus()
  httpMonitor.id = findMonitor(doc, httpMonitor.name)?.id ?? 0
  tcpMonitor.id = findMonitor(doc, tcpMonitor.name)?.id ?? 0
  expect(httpMonitor.id).toBeGreaterThan(0)
  expect(tcpMonitor.id).toBeGreaterThan(0)
})

test('6. 等待数据：状态页出现绿条，横幅「所有系统运行正常」', async () => {
  // 24h 视图直接吃 slot；90d 视图吃 slot_daily（小时级 rollup，全新实例无历史绿条，不在此断言）
  await waitStatus(
    (d) => {
      const h = findMonitor(d, httpMonitor.name)
      const t = findMonitor(d, tcpMonitor.name)
      return !!h && !!t && h.bars.some((b) => b.s === 0) && t.bars.some((b) => b.s === 0)
    },
    180_000,
    '两个监控都出现 up slot（24h）',
  )

  await page.goto('/')
  await expect(page.getByText('所有系统运行正常')).toBeVisible()
  await expect(page.getByText('我们目前没有发现任何问题。')).toBeVisible()
  await expect(page.getByText('API')).toBeVisible()
  await expect(page.getByText('2 个组件')).toBeVisible()
  // 展开分组才能看到监控行
  await page.getByText('API').first().click()
  await expect(page.getByText(httpMonitor.name).first()).toBeVisible()
  await expect(page.getByText(tcpMonitor.name).first()).toBeVisible()

  // 90d 条形几何（对照 mock 公式 step=668/n, w=max(4, step-2.34)）
  const bar = page.locator('svg[viewBox="0 0 668 16"]').first()
  await expect(bar).toBeVisible()
  expect(await bar.locator('rect').count()).toBe(90)
  const w = parseFloat((await bar.locator('rect').first().getAttribute('width'))!)
  expect(w).toBeCloseTo(Math.max(4, 668 / 90 - 2.34), 1)
  // 全新实例：90d 日桶尚未 rollup（小时任务），全部为 nodata 灰
  expect(await bar.locator('rect[fill="#e4e4e7"]').count()).toBeGreaterThan(0)

  // 24h 档直接吃 slot：切档后自动等待出现绿条（「未分组」空组的条恒为灰，故只挑含绿条的 svg）
  await page.getByRole('button', { name: '24 小时' }).click()
  const greenBars = page.locator('svg[viewBox="0 0 668 16"]').filter({ has: page.locator('rect[fill="#24c19a"]') })
  await expect(greenBars.first()).toBeVisible({ timeout: 10_000 })
  // 最近一根条（监控行最后一根）应为绿
  await expect(greenBars.last().locator('rect').last()).toHaveAttribute('fill', '#24c19a', { timeout: 10_000 })

  await page.screenshot({ path: 'screenshots/status-90d-light.png', fullPage: true })
})

test('7. 图例/说明段/tooltip/24 小时档（对照 mock）', async () => {
  await page.goto('/')
  for (const label of ['正常', '闪断（重试后恢复）', '部分中断', '离线', '无数据']) {
    await expect(page.getByText(label, { exact: true })).toBeVisible()
  }
  await expect(page.getByText(/每 30 秒自动刷新 · 时区/)).toBeVisible()

  // 确保分组展开（状态持久化在 localStorage，可能已展开）
  if (!(await page.getByText(httpMonitor.name).first().isVisible().catch(() => false))) {
    await page.getByText('API').first().click()
  }
  await expect(page.getByText(httpMonitor.name).first()).toBeVisible()

  // 切换到 24 小时档：label 用「24 小时」，起始标签说明每条 = 1 个检查间隔（每个分组行各有一条）
  await page.getByRole('button', { name: '24 小时' }).click()
  await expect(page.getByText('24 小时前（每条 = 1 个检查间隔）').first()).toBeVisible()

  // 24h 档 tooltip（slot 分支文案）：interval 秒级的 24h 条形有上千根（step 远小于 1px，
  // mock 的几何公式下条形彼此重叠），物理 hover 单根条不现实，故直接向绿条派发
  // mouseover（React 事件委托，等价于真实悬停），并顺带验证 nodata 灰条分支。
  const monitorBar = page.locator('svg[viewBox="0 0 668 16"]').filter({ has: page.locator('rect[fill="#24c19a"]') }).last()
  await monitorBar.locator('rect[fill="#24c19a"]').first().evaluate((el) => {
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }))
  })
  await expect(page.getByText('正常 · 首检成功')).toBeVisible()
  await expect(page.getByText(/检查间隔 \d+ 秒/)).toBeVisible()

  const grayBar = page.locator('svg[viewBox="0 0 668 16"]').filter({ has: page.locator('rect[fill="#e4e4e7"]') }).last()
  await grayBar.locator('rect[fill="#e4e4e7"]').first().evaluate((el) => {
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }))
  })
  await expect(page.getByText('该时段没有采集到数据', { exact: true })).toBeVisible()

  // tcp 监控 interval=10s → 8640 根条（记号密度恒等于检查间隔）
  const doc = await fetchStatus('24h')
  expect(findMonitor(doc, tcpMonitor.name)!.bars.length).toBe(Math.floor(86400 / 10))
})

test('8. 详情页：条形图 + 延迟折线 + slot 表格', async () => {
  await page.goto(`/m/${tcpMonitor.id}`)
  await expect(page.getByText(tcpMonitor.name).first()).toBeVisible()
  await expect(page.locator('svg[viewBox="0 0 668 16"]')).toBeVisible()
  await expect(page.locator('.recharts-surface')).toBeVisible()
  expect(await page.locator('table tbody tr').count()).toBeGreaterThan(0)
  await expect(page.getByText('正常').first()).toBeVisible()

  await page.goto(`/m/${httpMonitor.id}`)
  await expect(page.locator('.recharts-surface')).toBeVisible()
  await page.screenshot({ path: 'screenshots/detail-light.png', fullPage: true })
})

test('9. webhook 管理：新建 + 发送测试（假 down 事件）', async () => {
  await page.goto('/admin/webhooks')
  await page.getByRole('button', { name: '新建 Webhook' }).click()
  await page.getByLabel('名称').fill('E2E 接收端')
  await page.getByLabel('URL', { exact: true }).fill(`${RECEIVER}/hook`)
  await page.getByRole('button', { name: '保存' }).click()
  await expect(page.getByText('Webhook（1）')).toBeVisible()
  await expect(page.getByText('E2E 接收端')).toBeVisible()

  const before = received.length
  await page.getByRole('button', { name: '发送测试' }).click()
  await expect(page.getByRole('button', { name: '发送成功' })).toBeVisible({ timeout: 20_000 })
  await expect.poll(() => received.length, { timeout: 10_000 }).toBeGreaterThan(before)
  const last = received.at(-1)!
  expect(last.path).toBe('/hook')
  expect(last.body).toContain('"event": "down"')
  expect(last.body).toContain('test event from uptime admin')
})

test('10. 造故障：tcp 目标改为 127.0.0.1:1 → 变红 + 真实 down webhook', async () => {
  await page.goto(`/admin/monitors/${tcpMonitor.id}`)
  await page.getByLabel('主机').fill('127.0.0.1')
  await page.getByRole('button', { name: '保存' }).click()
  await page.waitForURL('**/admin')

  await waitStatus(
    (d) => findMonitor(d, tcpMonitor.name)?.status === 'down',
    120_000,
    'tcp 监控变 down',
  )

  await page.goto('/')
  await expect(page.getByText('1 个服务当前宕机')).toBeVisible()
  await expect(page.getByText('我们已经发现问题并正在处理中。')).toBeVisible()
  // 横幅圆点变红（down = #f87171）
  expect(await page.locator('circle[fill="#f87171"]').count()).toBeGreaterThan(0)
  await page.screenshot({ path: 'screenshots/status-down.png', fullPage: true })

  // 真实 down 转换的 webhook：event=down、监控名正确、非测试事件
  await expect.poll(
    () => received.filter((r) => r.body.includes('"event": "down"') && r.body.includes(tcpMonitor.name) && !r.body.includes('test event')).length,
    { timeout: 60_000 },
  ).toBeGreaterThan(0)
})

test('11. 修好目标 → 恢复绿 + recovered webhook', async () => {
  await page.goto(`/admin/monitors/${tcpMonitor.id}`)
  await page.getByLabel('主机').fill('host.docker.internal')
  await page.getByRole('button', { name: '保存' }).click()
  await page.waitForURL('**/admin')

  await waitStatus(
    (d) => findMonitor(d, tcpMonitor.name)?.status === 'operational',
    120_000,
    'tcp 监控恢复',
  )

  await page.goto('/')
  await expect(page.getByText('所有系统运行正常')).toBeVisible()

  await expect.poll(
    () => received.filter((r) => r.body.includes('"event": "recovered"') && r.body.includes(tcpMonitor.name)).length,
    { timeout: 60_000 },
  ).toBeGreaterThan(0)
})

test('12. 设置页：改站点标题与时区，状态页即时变化', async () => {
  await page.goto('/admin/settings')
  await page.getByLabel('站点标题').fill('E2E 状态页')
  await page.getByLabel(/显示时区/).fill('UTC')
  await page.getByRole('button', { name: '保存设置' }).click()
  await expect(page.getByText('保存成功')).toBeVisible()

  await page.goto('/')
  await expect(page.getByText('E2E 状态页')).toBeVisible()
  await expect(page.getByText('每 30 秒自动刷新 · 时区 UTC')).toBeVisible()
})

test('13. 暗色模式（对照 mock 变量）', async () => {
  await page.goto('/')
  await page.getByTitle('切换深浅色').click()
  await expect(page.locator('html')).toHaveClass(/dark/)
  // 暗色 nodata 色值 #39393f（等 React 重渲染后再断言）
  const bar = page.locator('svg[viewBox="0 0 668 16"]').first()
  await expect(bar.locator('rect[fill="#39393f"]').first()).toBeVisible({ timeout: 10_000 })
  // 背景变暗（--bg: #09090b）
  const bg = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim())
  expect(bg).toBe('#09090b')
  await page.screenshot({ path: 'screenshots/status-dark.png', fullPage: true })
  await page.getByTitle('切换深浅色').click()
})

test('14. 容器重启：session 失效、数据仍在', async () => {
  docker('restart')
  await healthz()

  // 旧 session（内存 Map）已失效：/admin 被踢回 /login
  await page.goto('/admin')
  await page.waitForURL('**/login')
  await expect(page.getByText('登录管理')).toBeVisible()

  // 重新登录后历史数据仍在
  await page.getByLabel('用户名').fill(USERNAME)
  await page.getByLabel('密码').fill(PASSWORD)
  await page.getByRole('button', { name: '登录' }).click()
  await page.waitForURL('**/admin')
  await expect(page.getByText('监控项（2）')).toBeVisible()

  // 状态页仍有重启前的历史绿条
  const doc = await waitStatus(
    (d) => (findMonitor(d, httpMonitor.name)?.bars.some((b) => b.s === 0) ?? false),
    30_000,
    '重启后历史数据',
  )
  expect(findMonitor(doc, tcpMonitor.name)).not.toBeNull()
})

test('15. 断后端 30s+：出现「数据可能已过期」且数据不清空', async () => {
  await page.goto('/')
  await expect(page.getByText('E2E 状态页')).toBeVisible()

  docker('stop')
  // 轮询间隔 30s：最多 ~45s 内看到提示条
  await expect(page.getByText(/数据可能已过期，最后更新于/)).toBeVisible({ timeout: 50_000 })
  // 旧数据仍在渲染
  await expect(page.getByText('API')).toBeVisible()
  await expect(page.getByText(httpMonitor.name)).toBeVisible()
  await page.screenshot({ path: 'screenshots/status-stale.png', fullPage: true })

  docker('up -d')
  await healthz()
  await page.reload()
  await expect(page.getByText(/数据可能已过期/)).toBeHidden()
  await expect(page.getByText('E2E 状态页')).toBeVisible()
})
