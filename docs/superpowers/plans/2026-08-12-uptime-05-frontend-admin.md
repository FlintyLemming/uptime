# uptime 计划 05：前端认证 + 管理后台

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现登录/首次设置、管理后台五个页面（监控项列表与表单、分组、Webhook、设置），含拖拽排序、实时重试提示与测试探测。

**Architecture:** 复用计划 04 脚手架与主题；`/admin/*` 套一个布局组件做 session 校验（`GET /api/auth/me`，401 跳 `/login`）；无用户时 `/setup` 可访问，否则 302 到 `/login`（前端用 `GET /api/auth/setup-status` 判断）；表单组件保持无状态受控，校验走后端返回的 errors 数组。

**Tech Stack:** React 18 + react-router-dom + Tailwind（变量体系同计划 04）。

## Global Constraints

（继承总览，摘录本计划相关）

- 表单实时显示「本间隔内实际最多重试 N 次，超出部分不会执行」——N 用前端重算的 `effectiveRetries`（公式：`min(max_retries, floor((interval_s*1000 - timeout_ms) / (retry_interval_s*1000)))`），随输入实时变化。
- `timeout_ms >= retry_interval_s * 1000` 时前端直接拒绝提交并给出原因（后端也会 400 兜底）。
- 监控项表单字段按类型切换：http 显示 method/headers/body/accepted_status_codes/follow_redirects/keyword(+invert)/json_query(+expected)/ignore_tls/check_cert_expiry；tcp 显示 port；ping 显示 packet_count；dns 显示 resolver/record_type/expected_value。
- 拖拽排序用原生 HTML5 drag events，不引第三方拖拽库；保存调 `POST /api/admin/monitors/reorder`。
- 文案中文，风格与状态页一致（CSS 变量、Inter、圆角 12 卡片）。

## File Structure（本计划新增）

```
web/src/lib/admin-api.ts
web/src/pages/{LoginPage,SetupPage}.tsx
web/src/pages/admin/{AdminLayout,MonitorsPage,MonitorEditPage,GroupsPage,WebhooksPage,SettingsPage}.tsx
web/src/components/admin/{EffectiveRetriesHint,MonitorTypeFields,WebhookTestButton}.tsx
web/src/lib/effective-retries.ts + effective-retries.test.ts
web/src/App.tsx（修改：补路由）
```

**Interfaces:** 消费计划 03 的 auth/admin 端点；`effectiveRetries(o): number` 与服务端 `clock.ts` 同公式（独立实现 + 测试）。

---

### Task 1: admin-api.ts + effective-retries（纯函数 + 测试）

**Files:**
- Create: `web/src/lib/admin-api.ts`、`effective-retries.ts`、`effective-retries.test.ts`

- [ ] **Step 1: 写失败测试**

`web/src/lib/effective-retries.test.ts`:

```ts
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
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd web && bunx vitest run src/lib/effective-retries.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

```ts
// web/src/lib/effective-retries.ts
export function effectiveRetries(o: { intervalS: number; retryIntervalS: number; maxRetries: number; timeoutMs: number }): number {
  const cap = Math.floor((o.intervalS * 1000 - o.timeoutMs) / (o.retryIntervalS * 1000))
  return Math.max(0, Math.min(o.maxRetries, cap))
}

export function timeoutViolatesBudget(timeoutMs: number, retryIntervalS: number): boolean {
  return timeoutMs >= retryIntervalS * 1000
}
```

`web/src/lib/admin-api.ts`：

```ts
export class ApiError extends Error {
  constructor(public status: number, public errors: string[], message: string) { super(message) }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { 'content-type': 'application/json' }, ...init })
  if (!res.ok) {
    let errors: string[] = []
    try { const body = await res.json() as { errors?: string[] }; errors = body.errors ?? [] } catch { /* ignore */ }
    throw new ApiError(res.status, errors, `${res.status}`)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export const authApi = {
  setupStatus: () => request<{ hasUser: boolean }>('/api/auth/setup-status'),
  setup: (username: string, password: string) => request('/api/auth/setup', { method: 'POST', body: JSON.stringify({ username, password }) }),
  login: (username: string, password: string) => request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  me: () => request<{ username: string }>('/api/auth/me'),
}

export interface MonitorDto {
  id: number; group_id: number | null; group_name: string | null; name: string; type: string; target: string
  port: number | null; interval_s: number; retry_interval_s: number; max_retries: number; timeout_ms: number
  active: number; sort_order: number; config: Record<string, unknown>
}

export const monitorsApi = {
  list: () => request<MonitorDto[]>('/api/admin/monitors'),
  create: (body: unknown) => request<MonitorDto>('/api/admin/monitors', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: number, body: unknown) => request<MonitorDto>(`/api/admin/monitors/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  remove: (id: number) => request<void>(`/api/admin/monitors/${id}`, { method: 'DELETE' }),
  reorder: (ids: number[]) => request('/api/admin/monitors/reorder', { method: 'POST', body: JSON.stringify({ ids }) }),
  test: (id: number) => request<{ ok: boolean; latency_ms: number | null; error: string | null; cert_days_left: number | null }>(`/api/admin/monitors/${id}/test`, { method: 'POST' }),
}

export const groupsApi = {
  list: () => request<Array<{ id: number; name: string; sort_order: number }>>('/api/admin/groups'),
  create: (name: string, sortOrder: number) => request('/api/admin/groups', { method: 'POST', body: JSON.stringify({ name, sort_order: sortOrder }) }),
  update: (id: number, name: string, sortOrder: number) => request(`/api/admin/groups/${id}`, { method: 'PATCH', body: JSON.stringify({ name, sort_order: sortOrder }) }),
  remove: (id: number) => request<void>(`/api/admin/groups/${id}`, { method: 'DELETE' }),
}

export interface WebhookDto { id: number; name: string; url: string; method: string; headers: Record<string, string>; body_template: string; enabled: number; monitor_ids: number[] | null }

export const webhooksApi = {
  list: () => request<WebhookDto[]>('/api/admin/webhooks'),
  create: (body: unknown) => request<{ id: number }>('/api/admin/webhooks', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: number, body: unknown) => request<{ id: number }>(`/api/admin/webhooks/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  remove: (id: number) => request<void>(`/api/admin/webhooks/${id}`, { method: 'DELETE' }),
  test: (id: number) => request<{ ok: boolean; attempts: number }>(`/api/admin/webhooks/${id}/test`, { method: 'POST' }),
}

export const settingsApi = {
  get: () => request<{ display_timezone: string; site_title: string; slot_retention_days: number; attempt_retention_days: number }>('/api/admin/settings'),
  put: (body: unknown) => request('/api/admin/settings', { method: 'PUT', body: JSON.stringify(body) }),
  changePassword: (current: string, next: string) => request('/api/admin/password', { method: 'POST', body: JSON.stringify({ current, next }) }),
}
```

- [ ] **Step 4: 运行测试验证通过 + Commit**

Run: `cd web && bunx vitest run src/lib/effective-retries.test.ts` → 4 pass。

```bash
git add web/src/lib/admin-api.ts web/src/lib/effective-retries.ts web/src/lib/effective-retries.test.ts
git commit -m "feat(web): admin api client and effective retries helper"
```

---

### Task 2: LoginPage + SetupPage + 路由接线

**Files:**
- Create: `web/src/pages/LoginPage.tsx`、`SetupPage.tsx`
- Modify: `web/src/App.tsx`

- [ ] **Step 1: LoginPage**

```tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { authApi } from '../lib/admin-api'

export default function LoginPage() {
  const nav = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await authApi.login(username, password)
      nav('/admin')
    } catch (err) {
      setError(err instanceof Error && err.message === '429' ? '失败次数过多，请 15 分钟后重试' : '用户名或密码错误')
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center" style={{ background: 'var(--bg)' }}>
      <form onSubmit={submit} className="flex w-[360px] flex-col gap-4 rounded-xl border p-8" style={{ borderColor: 'var(--line)', background: 'var(--card)', boxShadow: 'var(--shadow)' }}>
        <div className="font-semibold" style={{ fontSize: 16 }}>登录管理</div>
        {error && <div style={{ fontSize: 12.5, color: '#dc2625' }}>{error}</div>}
        <label className="flex flex-col gap-1" style={{ fontSize: 12.5, color: 'var(--fg-2)' }}>
          用户名
          <input value={username} onChange={(e) => setUsername(e.target.value)} className="rounded-lg border px-3 py-2" style={{ borderColor: 'var(--line)', background: 'var(--bg)', color: 'var(--fg)' }} />
        </label>
        <label className="flex flex-col gap-1" style={{ fontSize: 12.5, color: 'var(--fg-2)' }}>
          密码
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="rounded-lg border px-3 py-2" style={{ borderColor: 'var(--line)', background: 'var(--bg)', color: 'var(--fg)' }} />
        </label>
        <button type="submit" className="cursor-pointer rounded-lg py-2 font-medium" style={{ background: '#24c19a', color: '#fff', fontSize: 13.5 }}>登录</button>
      </form>
    </div>
  )
}
```

- [ ] **Step 2: SetupPage**

同 LoginPage 结构，加载时先 `authApi.setupStatus()`：`hasUser === true` → `nav('/login', { replace: true })`。表单字段：用户名、密码（≥8 位，前端校验提示）、确认密码（不一致前端报错）。提交 `authApi.setup` 成功后 `nav('/admin')`。

- [ ] **Step 3: App.tsx 补路由**

```tsx
import { Route, Routes } from 'react-router-dom'
import StatusPage from './pages/StatusPage'
import MonitorDetailPage from './pages/MonitorDetailPage'
import LoginPage from './pages/LoginPage'
import SetupPage from './pages/SetupPage'
import AdminLayout from './pages/admin/AdminLayout'
import MonitorsPage from './pages/admin/MonitorsPage'
import MonitorEditPage from './pages/admin/MonitorEditPage'
import GroupsPage from './pages/admin/GroupsPage'
import WebhooksPage from './pages/admin/WebhooksPage'
import SettingsPage from './pages/admin/SettingsPage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<StatusPage />} />
      <Route path="/m/:id" element={<MonitorDetailPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/setup" element={<SetupPage />} />
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<MonitorsPage />} />
        <Route path="monitors/new" element={<MonitorEditPage />} />
        <Route path="monitors/:id" element={<MonitorEditPage />} />
        <Route path="groups" element={<GroupsPage />} />
        <Route path="webhooks" element={<WebhooksPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  )
}
```

- [ ] **Step 4: 构建验证 + Commit**

Run: `cd web && bun run build`（admin 页面先占位 `export default function X(){ return null }` 让编译通过，后续 Task 替换）
Expected: 构建成功。

```bash
git add web/src/pages/LoginPage.tsx web/src/pages/SetupPage.tsx web/src/App.tsx web/src/pages/admin/
git commit -m "feat(web): login, setup pages and admin route skeleton"
```

---

### Task 3: AdminLayout（session 门 + 侧栏导航）

**Files:**
- Create: `web/src/pages/admin/AdminLayout.tsx`

- [ ] **Step 1: 实现**

```tsx
import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { authApi } from '../../lib/admin-api'

const NAV = [
  { to: '/admin', label: '监控项', end: true },
  { to: '/admin/groups', label: '分组' },
  { to: '/admin/webhooks', label: 'Webhook' },
  { to: '/admin/settings', label: '设置' },
]

export default function AdminLayout() {
  const nav = useNavigate()
  const [state, setState] = useState<'loading' | 'ok' | 'unauthorized'>('loading')

  useEffect(() => {
    authApi.me().then(() => setState('ok')).catch(() => setState('unauthorized'))
  }, [])

  useEffect(() => { if (state === 'unauthorized') nav('/login', { replace: true }) }, [state, nav])

  if (state !== 'ok') return null
  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)', color: 'var(--fg)' }}>
      <div className="mx-auto flex max-w-[1040px] gap-8 px-5 py-10">
        <aside className="flex w-40 flex-none flex-col gap-1">
          <Link to="/" style={{ fontSize: 12.5, color: 'var(--fg-3)' }}>← 状态页</Link>
          <div className="my-2 font-semibold" style={{ fontSize: 15 }}>管理</div>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className="rounded-lg px-3 py-2" style={({ isActive }) => ({ fontSize: 13.5, color: isActive ? 'var(--fg)' : 'var(--fg-2)', background: isActive ? 'var(--bg-sub)' : 'transparent' })}>
              {n.label}
            </NavLink>
          ))}
          <button
            onClick={() => authApi.logout().then(() => nav('/login'))}
            className="mt-auto cursor-pointer rounded-lg px-3 py-2 text-left"
            style={{ fontSize: 13.5, color: 'var(--fg-3)' }}
          >
            退出登录
          </button>
        </aside>
        <main className="min-w-0 flex-1"><Outlet /></main>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 构建验证 + Commit**

```bash
cd web && bun run build && cd /Users/flintylemming/Projects/uptime
git add web/src/pages/admin/AdminLayout.tsx
git commit -m "feat(web): admin layout with session gate and nav"
```

---

### Task 4: MonitorsPage（列表 + 拖拽排序 + 快速启停 + 删除 + 测试探测）

**Files:**
- Create: `web/src/pages/admin/MonitorsPage.tsx`

- [ ] **Step 1: 实现**

```tsx
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { monitorsApi, type MonitorDto } from '../../lib/admin-api'

export default function MonitorsPage() {
  const [monitors, setMonitors] = useState<MonitorDto[]>([])
  const [dragId, setDragId] = useState<number | null>(null)
  const [testResults, setTestResults] = useState<Record<number, { ok: boolean; latency_ms: number | null; error: string | null }>>({})

  const load = useCallback(() => monitorsApi.list().then(setMonitors).catch(() => {}), [])
  useEffect(() => { load() }, [load])

  const onDrop = (targetId: number) => {
    if (dragId === null || dragId === targetId) return
    const ids = monitors.map((m) => m.id)
    const from = ids.indexOf(dragId), to = ids.indexOf(targetId)
    ids.splice(from, 1)
    ids.splice(to, 0, dragId)
    setMonitors((prev) => [...prev].sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id)))
    monitorsApi.reorder(ids).then(load)
    setDragId(null)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="font-semibold" style={{ fontSize: 15 }}>监控项（{monitors.length}）</div>
        <Link to="/admin/monitors/new" className="rounded-lg px-3 py-1.5 font-medium" style={{ background: '#24c19a', color: '#fff', fontSize: 13 }}>新建监控项</Link>
      </div>
      <div className="overflow-hidden rounded-xl border" style={{ borderColor: 'var(--line)', background: 'var(--card)', boxShadow: 'var(--shadow)' }}>
        {monitors.length === 0 && <div className="px-5 py-8 text-center" style={{ fontSize: 13, color: 'var(--fg-3)' }}>还没有监控项，点右上角新建。</div>}
        {monitors.map((m) => (
          <div
            key={m.id}
            draggable
            onDragStart={() => setDragId(m.id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => onDrop(m.id)}
            className="flex items-center gap-3 border-t px-4 py-3"
            style={{ borderColor: 'var(--line)', cursor: 'grab', opacity: dragId === m.id ? 0.5 : 1 }}
          >
            <span style={{ color: 'var(--fg-3)', fontSize: 12 }}>⠿</span>
            <span className="h-2 w-2 rounded-full" style={{ background: m.active ? '#24c19a' : 'var(--line)' }} />
            <Link to={`/admin/monitors/${m.id}`} className="font-medium hover:underline" style={{ fontSize: 13.5 }}>{m.name}</Link>
            <span style={{ fontSize: 11.5, color: 'var(--fg-3)', fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace' }}>{m.type} · {m.target}{m.port ? `:${m.port}` : ''}</span>
            {m.group_name && <span className="rounded-full px-2 py-0.5" style={{ fontSize: 11, background: 'var(--bg-sub)', color: 'var(--fg-2)' }}>{m.group_name}</span>}
            <span className="ml-auto flex items-center gap-2">
              {testResults[m.id] && (
                <span style={{ fontSize: 11.5, color: testResults[m.id]!.ok ? '#24c19a' : '#dc2625' }}>
                  {testResults[m.id]!.ok ? `${testResults[m.id]!.latency_ms}ms` : testResults[m.id]!.error}
                </span>
              )}
              <button className="cursor-pointer rounded-md border px-2 py-1" style={{ fontSize: 11.5, borderColor: 'var(--line)', color: 'var(--fg-2)' }}
                onClick={() => monitorsApi.test(m.id).then((r) => setTestResults((p) => ({ ...p, [m.id]: r })))}>测试</button>
              <button className="cursor-pointer rounded-md border px-2 py-1" style={{ fontSize: 11.5, borderColor: 'var(--line)', color: 'var(--fg-2)' }}
                onClick={() => monitorsApi.update(m.id, { ...toBody(m), active: m.active ? 0 : 1 }).then(load)}>
                {m.active ? '停用' : '启用'}
              </button>
              <button className="cursor-pointer rounded-md border px-2 py-1" style={{ fontSize: 11.5, borderColor: 'var(--line)', color: '#dc2625' }}
                onClick={() => { if (confirm(`删除监控项「${m.name}」？其历史数据会一并删除。`)) monitorsApi.remove(m.id).then(load) }}>删除</button>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function toBody(m: MonitorDto) {
  return {
    group_id: m.group_id, name: m.name, type: m.type, target: m.target, port: m.port,
    interval_s: m.interval_s, retry_interval_s: m.retry_interval_s, max_retries: m.max_retries,
    timeout_ms: m.timeout_ms, active: m.active, sort_order: m.sort_order, config: m.config,
  }
}
```

- [ ] **Step 2: 联调验收**

后端起好、登录后：新建两个监控项 → 拖拽换序 → 刷新后顺序保持 → 停用/启用/删除生效。

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/admin/MonitorsPage.tsx
git commit -m "feat(web): monitors list with drag reorder, toggle, delete and test"
```

---

### Task 5: MonitorEditPage（表单 + 实时重试提示）

**Files:**
- Create: `web/src/pages/admin/MonitorEditPage.tsx`
- Create: `web/src/components/admin/EffectiveRetriesHint.tsx`、`MonitorTypeFields.tsx`

- [ ] **Step 1: EffectiveRetriesHint**

```tsx
import { effectiveRetries, timeoutViolatesBudget } from '../../lib/effective-retries'

export default function EffectiveRetriesHint({ intervalS, retryIntervalS, maxRetries, timeoutMs }: {
  intervalS: number; retryIntervalS: number; maxRetries: number; timeoutMs: number
}) {
  if (timeoutViolatesBudget(timeoutMs, retryIntervalS)) {
    return <div style={{ fontSize: 12.5, color: '#dc2625' }}>超时时间必须小于重试间隔（{retryIntervalS}s），否则超时会吃掉重试节奏。</div>
  }
  const n = effectiveRetries({ intervalS, retryIntervalS, maxRetries, timeoutMs })
  return (
    <div style={{ fontSize: 12.5, color: n < maxRetries ? '#d97706' : 'var(--fg-3)' }}>
      本间隔内实际最多重试 {n} 次，超出部分不会执行
    </div>
  )
}
```

- [ ] **Step 2: MonitorTypeFields（按类型渲染 config 字段）**

输入 `type: string` 与 `config: Record<string, unknown>` 及 `onChange(patch)`，渲染（受控）：
- http：method（select GET/POST/PUT/DELETE/PATCH）、headers（textarea，每行 `Key: Value` 解析成对象）、body（textarea，非 GET 时显示）、accepted_status_codes（text，逗号分隔，默认 `200-299`）、follow_redirects（checkbox）、keyword（text）+ keyword_invert（checkbox）、json_query + json_expected（text）、ignore_tls、check_cert_expiry（checkbox）；
- tcp：无 config 字段（port 在主表单）；
- ping：packet_count（number，默认 1）；
- dns：resolver（text 默认 1.1.1.1）、record_type（select A/AAAA/CNAME/TXT）、expected_value（text 可选）。

实现为一个 switch 返回 JSX 的函数组件，字段样式与 Task 2 的输入框一致（`rounded-lg border px-3 py-2` + 变量色）。

- [ ] **Step 3: MonitorEditPage**

```tsx
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { monitorsApi, groupsApi } from '../../lib/admin-api'
import EffectiveRetriesHint from '../../components/admin/EffectiveRetriesHint'
import MonitorTypeFields from '../../components/admin/MonitorTypeFields'
import { timeoutViolatesBudget } from '../../lib/effective-retries'

const DEFAULTS = {
  name: '', type: 'http', target: '', port: null as number | null, group_id: null as number | null,
  interval_s: 60, retry_interval_s: 20, max_retries: 3, timeout_ms: 10000, active: 1, config: {} as Record<string, unknown>,
}

const INPUT = 'rounded-lg border px-3 py-2'
const inputStyle = { borderColor: 'var(--line)', background: 'var(--bg)', color: 'var(--fg)', fontSize: 13.5 }

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1" style={{ fontSize: 12.5, color: 'var(--fg-2)' }}>
      {label}
      {children}
    </label>
  )
}

export default function MonitorEditPage() {
  const { id } = useParams()
  const nav = useNavigate()
  const isNew = !id
  const [form, setForm] = useState(DEFAULTS)
  const [groups, setGroups] = useState<Array<{ id: number; name: string }>>([])
  const [errors, setErrors] = useState<string[]>([])

  useEffect(() => { groupsApi.list().then(setGroups).catch(() => {}) }, [])
  useEffect(() => {
    if (isNew) return
    monitorsApi.list().then((list) => {
      const m = list.find((x) => x.id === Number(id))
      if (m) setForm({ name: m.name, type: m.type, target: m.target, port: m.port, group_id: m.group_id, interval_s: m.interval_s, retry_interval_s: m.retry_interval_s, max_retries: m.max_retries, timeout_ms: m.timeout_ms, active: m.active, config: m.config })
    })
  }, [id, isNew])

  const set = <K extends keyof typeof DEFAULTS>(k: K, v: (typeof DEFAULTS)[K]) => setForm((f) => ({ ...f, [k]: v }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (timeoutViolatesBudget(form.timeout_ms, form.retry_interval_s)) {
      setErrors(['超时时间必须小于重试间隔']); return
    }
    const body = { ...form, sort_order: 0 }
    try {
      if (isNew) await monitorsApi.create(body)
      else await monitorsApi.update(Number(id), body)
      nav('/admin')
    } catch (err) {
      setErrors((err as { errors?: string[] }).errors ?? ['保存失败'])
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5 rounded-xl border p-6" style={{ borderColor: 'var(--line)', background: 'var(--card)', boxShadow: 'var(--shadow)' }}>
      <div className="font-semibold" style={{ fontSize: 15 }}>{isNew ? '新建监控项' : '编辑监控项'}</div>
      {errors.length > 0 && (
        <div className="rounded-lg px-3 py-2" style={{ background: 'rgba(220,38,37,.08)', fontSize: 12.5, color: '#dc2625' }}>
          {errors.map((e) => <div key={e}>{e}</div>)}
        </div>
      )}
      {/* 通用字段 */}
      <Field label="名称"><input value={form.name} onChange={(e) => set('name', e.target.value)} className={INPUT} style={inputStyle} /></Field>
      <Field label="类型">
        <select value={form.type} onChange={(e) => set('type', e.target.value)} className={INPUT} style={inputStyle}>
          <option value="http">HTTP</option><option value="tcp">TCP</option><option value="ping">Ping</option><option value="dns">DNS</option>
        </select>
      </Field>
      <Field label={form.type === 'http' ? 'URL' : form.type === 'dns' ? '域名' : '主机'}>
        <input value={form.target} onChange={(e) => set('target', e.target.value)} className={INPUT} style={inputStyle} placeholder={form.type === 'http' ? 'https://example.com' : 'example.com'} />
      </Field>
      {form.type === 'tcp' && (
        <Field label="端口"><input type="number" value={form.port ?? ''} onChange={(e) => set('port', e.target.value === '' ? null : Number(e.target.value))} className={INPUT} style={inputStyle} /></Field>
      )}
      <Field label="分组">
        <select value={form.group_id ?? ''} onChange={(e) => set('group_id', e.target.value === '' ? null : Number(e.target.value))} className={INPUT} style={inputStyle}>
          <option value="">未分组</option>
          {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="检查间隔（秒）"><input type="number" value={form.interval_s} onChange={(e) => set('interval_s', Number(e.target.value))} className={INPUT} style={inputStyle} /></Field>
        <Field label="重试间隔（秒）"><input type="number" value={form.retry_interval_s} onChange={(e) => set('retry_interval_s', Number(e.target.value))} className={INPUT} style={inputStyle} /></Field>
        <Field label="最大重试次数"><input type="number" value={form.max_retries} onChange={(e) => set('max_retries', Number(e.target.value))} className={INPUT} style={inputStyle} /></Field>
        <Field label="超时（毫秒）"><input type="number" value={form.timeout_ms} onChange={(e) => set('timeout_ms', Number(e.target.value))} className={INPUT} style={inputStyle} /></Field>
      </div>
      <EffectiveRetriesHint intervalS={form.interval_s} retryIntervalS={form.retry_interval_s} maxRetries={form.max_retries} timeoutMs={form.timeout_ms} />
      <MonitorTypeFields type={form.type} config={form.config} onChange={(patch) => set('config', { ...form.config, ...patch })} />
      <div className="flex gap-2">
        <button type="submit" className="cursor-pointer rounded-lg px-4 py-2 font-medium" style={{ background: '#24c19a', color: '#fff', fontSize: 13.5 }}>保存</button>
        <button type="button" onClick={() => nav('/admin')} className="cursor-pointer rounded-lg border px-4 py-2" style={{ borderColor: 'var(--line)', fontSize: 13.5, color: 'var(--fg-2)' }}>取消</button>
      </div>
    </form>
  )
}
```

（注释「…此处实现时展开为 8 个 label/input…」处必须写全 8 个字段，模式与 LoginPage 输入框相同；不允许留注释占位。）

- [ ] **Step 4: 联调验收**

浏览器验证：新建 http 监控 → 改 interval=120/retry=30/max=4/timeout=10000 → 提示显示「实际最多重试 3 次」→ timeout 改成 30000 → 变红色错误文案且提交被拒 → 正常保存后出现在列表。

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/admin/MonitorEditPage.tsx web/src/components/admin/
git commit -m "feat(web): monitor form with live effective-retries hint"
```

---

### Task 6: GroupsPage + WebhooksPage + SettingsPage

**Files:**
- Create: `web/src/pages/admin/GroupsPage.tsx`、`WebhooksPage.tsx`、`SettingsPage.tsx`
- Create: `web/src/components/admin/WebhookTestButton.tsx`

- [ ] **Step 1: GroupsPage**

卡片内表格：名称（inline 编辑 input）、sort_order（number）、删除按钮（confirm 提示「删除分组不会删除其中的监控项，它们会变成未分组」）。底部「新建分组」行：input + 添加按钮。全部走 `groupsApi`。

- [ ] **Step 2: WebhookTestButton**

```tsx
import { useState } from 'react'
import { webhooksApi } from '../../lib/admin-api'

export default function WebhookTestButton({ id }: { id: number }) {
  const [state, setState] = useState<'idle' | 'sending' | 'ok' | 'fail'>('idle')
  return (
    <button
      className="cursor-pointer rounded-md border px-2 py-1"
      style={{ fontSize: 11.5, borderColor: 'var(--line)', color: state === 'fail' ? '#dc2625' : state === 'ok' ? '#24c19a' : 'var(--fg-2)' }}
      onClick={() => { setState('sending'); webhooksApi.test(id).then((r) => setState(r.ok ? 'ok' : 'fail')).catch(() => setState('fail')) }}
    >
      {state === 'sending' ? '发送中…' : state === 'ok' ? '发送成功' : state === 'fail' ? '发送失败' : '发送测试'}
    </button>
  )
}
```

- [ ] **Step 3: WebhooksPage**

列表（名称 / URL / 启用开关 / 测试按钮 / 删除）+ 新建/编辑弹层表单：name、url、method（select）、headers（textarea 每行 `Key: Value`）、body_template（textarea，新建时预填默认模板：

```
{
  "event": "{{event}}",
  "monitor": "{{monitor_name}}",
  "target": "{{target}}",
  "error": "{{error}}",
  "time": "{{slot_started_at}}",
  "url": "{{url}}"
}
```

）、monitor_ids（多选 checkbox 列表，不选 = 全部监控项）、enabled。全部走 `webhooksApi`。

- [ ] **Step 4: SettingsPage**

四块：
1. 站点设置：site_title（text）、display_timezone（text，提交后提示「时区已变更，历史日桶正在重建」——后端同步重建，文案说明 90 天前的日桶保持原值）。
2. 保留期：slot_retention_days（number，前端强制 ≥90，小于时红字提示并禁用提交）、attempt_retention_days（number ≥1）。
3. 修改密码：current/next/confirm 三字段，走 `settingsApi.changePassword`，成功提示。
4. 保存按钮统一 PUT settings；错误用后端 errors 数组渲染。

- [ ] **Step 5: 联调验收 + 测试回归**

浏览器验证三个页面 CRUD；时区改成 UTC 后后端日志/数据库 `slot_daily` 被重建（可用 `bun -e` 查库验证）。

Run: `cd web && bunx vitest run && bun run build`
Expected: 全绿。

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/admin/GroupsPage.tsx web/src/pages/admin/WebhooksPage.tsx web/src/pages/admin/SettingsPage.tsx web/src/components/admin/WebhookTestButton.tsx
git commit -m "feat(web): groups, webhooks and settings admin pages"
```

---

## 计划 05 验收清单

- `cd web && bunx vitest run`（含 effective-retries 4 个测试）与 `bun run build` 全绿。
- 手工验收：setup → login → 五个管理页 CRUD 全通；限流文案出现（连错 5 次）；无用户时 `/setup` 可用，有用户时跳 `/login`。
- `web/mock/` 未被改动。
