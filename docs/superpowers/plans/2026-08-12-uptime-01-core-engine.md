# uptime 计划 01：脚手架 + 数据层 + 探测层 + slot 判定引擎

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 monorepo 脚手架与数据库层，实现四种探测器与 slot 判定引擎（纯函数核心，零 DB、零真实网络依赖可测）。

**Architecture:** Bun workspace（`server/` + `web/`）。数据库 Drizzle ORM + bun:sqlite（WAL）。探测器是无状态纯函数层；`slot-runner` 通过注入 `{ probe, now, sleep }` 运行状态机，测试全部用假实现。

**Tech Stack:** Bun ≥ 1.3、TypeScript、Drizzle ORM、bun:sqlite、bun:test。

## Global Constraints

（继承 `2026-08-12-uptime-00-overview.md` 的 Global Constraints，此处摘录与本计划直接相关的）

- 包管理 `bun install`；后端测试 `bun test`（在 `server/` 目录运行）。
- 一个 slot 至多产出一行 slot 记录；边界对齐 `floor(now_unix / interval_s) * interval_s`。
- `effective_retries = min(max_retries, floor((interval_s*1000 - timeout_ms) / (retry_interval_s*1000)))`。
- 探测器内部捕获一切异常，转成 `ProbeResult{ok:false, error}`，绝不向上抛。
- `slot-runner.ts` 不得 import 任何 `store/`、`db/`、`probes/` 具体实现之外的东西。
- 提交信息 conventional commits。

## File Structure（本计划新增）

```
package.json                        # 新建（workspace 根）
server/package.json  tsconfig.json  drizzle.config.ts
server/src/config.ts
server/src/db/schema.ts  client.ts  migrate.ts
server/src/db/schema.test.ts
server/src/probes/types.ts  http.ts  tcp.ts  ping.ts  dns.ts  index.ts
server/src/probes/{http,tcp,ping,dns}.test.ts
server/src/scheduler/clock.ts  slot-runner.ts
server/src/scheduler/{clock,slot-runner}.test.ts
server/drizzle/                     # drizzle-kit generate 产物（迁移 SQL）
```

**Interfaces:** 本计划产出的接口即总览文件「关键接口约定」中的 `ProbeConfig/ProbeResult/Probe`、`slotStartAt/nextSlotStart/effectiveRetries`、`runSlot/SlotResult/MonitorRuntimeConfig/SlotDeps`、全部 drizzle 表导出（`monitorGroup, monitor, slot, attempt, slotDaily, webhook, webhookMonitor, user, setting`）与 `openDb()`。后续计划直接 import。

---

### Task 1: Workspace 脚手架与测试冒烟

**Files:**
- Create: `package.json`
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Create: `server/src/smoke.test.ts`（冒烟测试，Task 2 后删除）

- [ ] **Step 1: 写根 package.json**

```json
{
  "name": "uptime",
  "private": true,
  "workspaces": ["server", "web"],
  "scripts": {
    "test": "cd server && bun test",
    "dev:server": "cd server && bun run --watch src/index.ts",
    "dev:web": "cd web && bunx vite"
  }
}
```

注意：`web/` 目录在计划 04 才创建，workspaces 指向不存在的目录 `bun install` 不会报错，可忽略。

- [ ] **Step 2: 写 server/package.json**

```json
{
  "name": "@uptime/server",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "bun test",
    "dev": "bun run --watch src/index.ts",
    "start": "bun run src/index.ts",
    "db:generate": "drizzle-kit generate"
  },
  "dependencies": {
    "drizzle-orm": "^0.44.0",
    "hono": "^4.7.0"
  },
  "devDependencies": {
    "@types/bun": "^1.2.0",
    "drizzle-kit": "^0.31.0",
    "typescript": "^5.7.0"
  }
}
```

（执行时若这些版本已有更新的小版本，以 `bun install` 实际解析为准，不用改文件。）

- [ ] **Step 3: 写 server/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["bun"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "noEmit": true,
    "verbatimModuleSyntax": true
  },
  "include": ["src", "drizzle.config.ts"]
}
```

- [ ] **Step 4: 安装依赖**

Run: `cd /Users/flintylemming/Projects/uptime && bun install`
Expected: 成功生成 lockfile，无错误。

- [ ] **Step 5: 写冒烟测试**

`server/src/smoke.test.ts`:

```ts
import { expect, test } from 'bun:test'

test('bun test works', () => {
  expect(1 + 1).toBe(2)
})
```

- [ ] **Step 6: 运行测试**

Run: `cd /Users/flintylemming/Projects/uptime/server && bun test`
Expected: 1 pass, 0 fail。

- [ ] **Step 7: Commit**

```bash
cd /Users/flintylemming/Projects/uptime
git add package.json bun.lock server/package.json server/tsconfig.json server/src/smoke.test.ts
git commit -m "chore: bootstrap bun workspace with server package"
```

---

### Task 2: 数据库 schema、client、迁移

**Files:**
- Create: `server/drizzle.config.ts`
- Create: `server/src/db/schema.ts`
- Create: `server/src/db/client.ts`
- Create: `server/src/db/migrate.ts`
- Create: `server/src/db/schema.test.ts`
- Delete: `server/src/smoke.test.ts`

**Interfaces:**
- Produces: drizzle 表对象导出（名称与下面 schema 一致）；`openDb(file: string): { db: DrizzleDb; sql: Database }`；`runMigrations(db, sql)`；`seedSettings(db)`。

- [ ] **Step 1: 写 drizzle.config.ts**

```ts
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
})
```

- [ ] **Step 2: 写 schema.ts（设计文档 §4.1 全表 + slot.cert_days_left）**

`server/src/db/schema.ts`:

```ts
import { integer, primaryKey, sqliteTable, text, index } from 'drizzle-orm/sqlite-core'

export const monitorGroup = sqliteTable('monitor_group', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
})

export const monitor = sqliteTable('monitor', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  groupId: integer('group_id').references(() => monitorGroup.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  type: text('type').notNull(),                       // http | tcp | ping | dns
  target: text('target').notNull(),
  port: integer('port'),
  intervalS: integer('interval_s').notNull().default(60),
  retryIntervalS: integer('retry_interval_s').notNull().default(20),
  maxRetries: integer('max_retries').notNull().default(3),
  timeoutMs: integer('timeout_ms').notNull().default(10000),
  active: integer('active').notNull().default(1),
  sortOrder: integer('sort_order').notNull().default(0),
  config: text('config').notNull().default('{}'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

// slot 状态编码：0=up 1=flaky 2=down
export const slot = sqliteTable('slot', {
  monitorId: integer('monitor_id').notNull().references(() => monitor.id, { onDelete: 'cascade' }),
  startedAt: integer('started_at').notNull(),
  intervalS: integer('interval_s').notNull(),
  status: integer('status').notNull(),
  attempts: integer('attempts').notNull(),
  recoveredAfterS: integer('recovered_after_s'),
  latencyMs: integer('latency_ms'),
  error: text('error'),
  certDaysLeft: integer('cert_days_left'),
}, (t) => [primaryKey({ columns: [t.monitorId, t.startedAt] })])

export const attempt = sqliteTable('attempt', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  monitorId: integer('monitor_id').notNull(),
  slotStartedAt: integer('slot_started_at').notNull(),
  seq: integer('seq').notNull(),
  ok: integer('ok').notNull(),
  latencyMs: integer('latency_ms'),
  error: text('error'),
  at: integer('at').notNull(),
}, (t) => [index('attempt_monitor_slot_idx').on(t.monitorId, t.slotStartedAt)])

export const slotDaily = sqliteTable('slot_daily', {
  monitorId: integer('monitor_id').notNull().references(() => monitor.id, { onDelete: 'cascade' }),
  day: text('day').notNull(),                          // YYYY-MM-DD，按展示时区切
  up: integer('up').notNull(),
  flaky: integer('flaky').notNull(),
  down: integer('down').notNull(),
  nodata: integer('nodata').notNull(),
  downSeconds: integer('down_seconds').notNull(),
  latencyP50: integer('latency_p50'),
  latencyP95: integer('latency_p95'),
}, (t) => [primaryKey({ columns: [t.monitorId, t.day] })])

export const webhook = sqliteTable('webhook', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  url: text('url').notNull(),
  method: text('method').notNull().default('POST'),
  headers: text('headers').notNull().default('{}'),
  bodyTemplate: text('body_template').notNull(),
  enabled: integer('enabled').notNull().default(1),
})

export const webhookMonitor = sqliteTable('webhook_monitor', {
  webhookId: integer('webhook_id').notNull().references(() => webhook.id, { onDelete: 'cascade' }),
  monitorId: integer('monitor_id').notNull().references(() => monitor.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.webhookId, t.monitorId] })])

export const user = sqliteTable('user', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),       // argon2id
  createdAt: integer('created_at').notNull(),
})

export const setting = sqliteTable('setting', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})
```

- [ ] **Step 3: 写 client.ts**

`server/src/db/client.ts`:

```ts
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import * as schema from './schema'

export type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>

export function openDb(file: string): { db: DrizzleDb; sql: Database } {
  const sql = new Database(file, { create: true })
  sql.exec('PRAGMA journal_mode=WAL')
  sql.exec('PRAGMA synchronous=NORMAL')
  sql.exec('PRAGMA foreign_keys=ON')
  const db = drizzle(sql, { schema })
  return { db, sql }
}
```

- [ ] **Step 4: 写 migrate.ts**

`server/src/db/migrate.ts`:

```ts
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import { eq } from 'drizzle-orm'
import type { Database } from 'bun:sqlite'
import type { DrizzleDb } from './client'
import { setting } from './schema'

export function runMigrations(db: DrizzleDb, _sql: Database) {
  migrate(db, { migrationsFolder: new URL('../../drizzle', import.meta.url).pathname })
}

export const DEFAULT_SETTINGS: Record<string, string> = {
  display_timezone: 'Asia/Shanghai',
  site_title: 'Status',
  slot_retention_days: '90',
  attempt_retention_days: '7',
}

export function seedSettings(db: DrizzleDb) {
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    const existing = db.select().from(setting).where(eq(setting.key, key)).get()
    if (!existing) db.insert(setting).values({ key, value }).run()
  }
}
```

- [ ] **Step 5: 生成迁移 SQL**

Run: `cd /Users/flintylemming/Projects/uptime/server && bun run db:generate`
Expected: 在 `server/drizzle/` 下生成 `0000_*.sql` 与 meta 文件。

- [ ] **Step 6: 写失败测试**

`server/src/db/schema.test.ts`:

```ts
import { expect, test } from 'bun:test'
import { count, eq } from 'drizzle-orm'
import { openDb } from './client'
import { runMigrations, seedSettings, DEFAULT_SETTINGS } from './migrate'
import { monitor, monitorGroup, setting, slot } from './schema'

function freshDb() {
  const { db, sql } = openDb(':memory:')
  runMigrations(db, sql)
  seedSettings(db)
  return { db, sql }
}

test('migrations create all tables and seed settings', () => {
  const { db } = freshDb()
  const rows = db.select().from(setting).all()
  expect(rows.length).toBe(4)
  expect(db.select().from(setting).where(eq(setting.key, 'display_timezone')).get()?.value).toBe('Asia/Shanghai')
})

test('seedSettings is idempotent', () => {
  const { db } = freshDb()
  seedSettings(db)
  expect(db.select(count()).from(setting).get()?.[0]).toBe(4)
})

test('monitor fk set null on group delete; slot cascade on monitor delete', () => {
  const { db } = freshDb()
  const gId = db.insert(monitorGroup).values({ name: 'API' }).returning({ id: monitorGroup.id }).get().id
  const now = Math.floor(Date.now() / 1000)
  const mId = db.insert(monitor).values({
    groupId: gId, name: 'a', type: 'http', target: 'https://example.com',
    createdAt: now, updatedAt: now,
  }).returning({ id: monitor.id }).get().id
  db.insert(slot).values({ monitorId: mId, startedAt: 1000, intervalS: 60, status: 0, attempts: 1 }).run()

  db.delete(monitorGroup).where(eq(monitorGroup.id, gId)).run()
  expect(db.select().from(monitor).where(eq(monitor.id, mId)).get()?.groupId).toBeNull()

  db.delete(monitor).where(eq(monitor.id, mId)).run()
  expect(db.select(count()).from(slot).get()?.[0]).toBe(0)
})

test('seedSettings does not overwrite existing values', () => {
  const { db } = freshDb()
  db.update(setting).set({ value: 'UTC' }).where(eq(setting.key, 'display_timezone')).run()
  seedSettings(db)
  expect(db.select().from(setting).where(eq(setting.key, 'display_timezone')).get()?.value).toBe('UTC')
  expect(DEFAULT_SETTINGS.slot_retention_days).toBe('90')
})
```

- [ ] **Step 7: 运行测试验证失败**

Run: `cd server && bun test src/db/schema.test.ts`
Expected: FAIL（若前面步骤已完成则可能直接 PASS；若 PASS 跳到 Step 9）。

- [ ] **Step 8: 修复至通过**

Expected: `cd server && bun test src/db/schema.test.ts` → 4 pass。
注意：`:memory:` 库跑迁移要求 `drizzle/` 目录相对路径可达；`new URL('../../drizzle', import.meta.url)` 从 `src/db/migrate.ts` 解析到 `server/drizzle/`。若报错，检查 Step 5 是否生成成功。

- [ ] **Step 9: 删除冒烟测试并提交**

```bash
rm server/src/smoke.test.ts
cd /Users/flintylemming/Projects/uptime
git add -A
git commit -m "feat(db): drizzle schema, WAL client, migrations and settings seed"
```

---

### Task 3: probes/types.ts + TCP 探测

**Files:**
- Create: `server/src/probes/types.ts`
- Create: `server/src/probes/tcp.ts`
- Create: `server/src/probes/tcp.test.ts`

**Interfaces:**
- Produces: `ProbeType, ProbeConfig, ProbeResult, Probe`（见总览）；`tcpProbe: Probe`。

- [ ] **Step 1: 写 types.ts**

`server/src/probes/types.ts`:

```ts
export type ProbeType = 'http' | 'tcp' | 'ping' | 'dns'

export interface ProbeConfig {
  type: ProbeType
  target: string
  port: number | null
  timeoutMs: number
  /** 类型专属配置（设计文档 §4.1 的 monitor.config JSON） */
  config: Record<string, unknown>
}

export interface ProbeResult {
  ok: boolean
  latencyMs: number | null
  error: string | null
  /** 仅 http + check_cert_expiry 时非空：证书剩余天数 */
  certDaysLeft: number | null
}

export interface Probe {
  run(cfg: ProbeConfig, signal: AbortSignal): Promise<ProbeResult>
}

/** 统一错误包装：截断过长错误信息，保留首行 */
export function shortError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.split('\n')[0]!.slice(0, 500)
}
```

- [ ] **Step 2: 写失败测试**

`server/src/probes/tcp.test.ts`:

```ts
import { afterEach, expect, test } from 'bun:test'
import { tcpProbe } from './tcp'
import type { ProbeConfig } from './types'

let server: ReturnType<typeof Bun.listen> | null = null

afterEach(() => {
  server?.stop(true)
  server = null
})

function cfg(port: number, timeoutMs = 2000): ProbeConfig {
  return { type: 'tcp', target: '127.0.0.1', port, timeoutMs, config: {} }
}

test('tcp probe succeeds against open port', async () => {
  server = await Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data() {} } })
  const r = await tcpProbe.run(cfg(server.port), AbortSignal.timeout(3000))
  expect(r.ok).toBe(true)
  expect(r.latencyMs).not.toBeNull()
  expect(r.error).toBeNull()
})

test('tcp probe fails against closed port without throwing', async () => {
  const r = await tcpProbe.run(cfg(1), AbortSignal.timeout(3000))
  expect(r.ok).toBe(false)
  expect(r.latencyMs).toBeNull()
  expect(typeof r.error).toBe('string')
})
```

- [ ] **Step 3: 运行测试验证失败**

Run: `cd server && bun test src/probes/tcp.test.ts`
Expected: FAIL（`Cannot find module './tcp'`）。

- [ ] **Step 4: 实现 tcp.ts**

`server/src/probes/tcp.ts`:

```ts
import type { Probe, ProbeConfig, ProbeResult } from './types'
import { shortError } from './types'

async function connect(host: string, port: number, timeoutMs: number, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (fn: () => void) => { if (!settled) { settled = true; cleanup(); fn() } }
    const timer = setTimeout(() => finish(() => reject(new Error('connection timeout'))), timeoutMs)
    const onAbort = () => finish(() => reject(new Error('aborted')))
    signal.addEventListener('abort', onAbort)
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', onAbort) }

    const socket = Bun.connect({
      hostname: host, port,
      socket: {
        open() { socket.end(); finish(resolve) },
        error(_s, err) { finish(() => reject(err)) },
        close() {},
        data() {},
        drain() {},
      },
    })
    socket.catch((err) => finish(() => reject(err)))
  })
}

export const tcpProbe: Probe = {
  async run(cfg: ProbeConfig, signal: AbortSignal): Promise<ProbeResult> {
    if (!cfg.port) return { ok: false, latencyMs: null, error: 'tcp probe requires a port', certDaysLeft: null }
    const started = performance.now()
    try {
      await connect(cfg.target, cfg.port, cfg.timeoutMs, signal)
      return { ok: true, latencyMs: Math.round(performance.now() - started), error: null, certDaysLeft: null }
    } catch (e) {
      return { ok: false, latencyMs: null, error: shortError(e), certDaysLeft: null }
    }
  },
}
```

- [ ] **Step 5: 运行测试验证通过**

Run: `cd server && bun test src/probes/tcp.test.ts`
Expected: 2 pass。

- [ ] **Step 6: Commit**

```bash
git add server/src/probes/
git commit -m "feat(probes): probe types and tcp probe"
```

---

### Task 4: HTTP 探测

**Files:**
- Create: `server/src/probes/http.ts`
- Create: `server/src/probes/http.test.ts`

**Interfaces:**
- Consumes: `types.ts` 全部类型。
- Produces: `httpProbe: Probe`。

`config` 字段（设计文档 §4.1 http）：`method`、`headers`（`Record<string,string>`）、`body`、`accepted_status_codes`（`string[]`，默认 `["200-299"]`）、`follow_redirects`（默认 true）、`keyword` + `keyword_invert`、`json_query` + `json_expected`、`ignore_tls`、`check_cert_expiry`。

- [ ] **Step 1: 写失败测试**

`server/src/probes/http.test.ts`:

```ts
import { afterAll, expect, test } from 'bun:test'
import { httpProbe } from './http'
import type { ProbeConfig } from './types'

const server = Bun.serve({
  port: 0,
  fetch(req) {
    const url = new URL(req.url)
    if (url.pathname === '/ok') return new Response('hello world')
    if (url.pathname === '/json') return Response.json({ status: 'pass' })
    if (url.pathname === '/bad-json') return Response.json({ status: 'fail' })
    if (url.pathname === '/teapot') return new Response('teapot', { status: 418 })
    if (url.pathname === '/redirect') return Response.redirect(`http://127.0.0.1:${server.port}/ok`, 302)
    if (url.pathname === '/slow') return new Promise<Response>((res) =>
      setTimeout(() => res(new Response('late')), 2000))
    return new Response('not found', { status: 404 })
  },
})

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
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd server && bun test src/probes/http.test.ts`
Expected: FAIL（`Cannot find module './http'`）。

- [ ] **Step 3: 实现 http.ts**

`server/src/probes/http.ts`:

```ts
import tls from 'node:tls'
import type { Probe, ProbeConfig, ProbeResult } from './types'
import { shortError } from './types'

interface HttpCfg {
  method?: string
  headers?: Record<string, string>
  body?: string
  accepted_status_codes?: string[]
  follow_redirects?: boolean
  keyword?: string
  keyword_invert?: boolean
  json_query?: string
  json_expected?: string
  ignore_tls?: boolean
  check_cert_expiry?: boolean
}

function statusAccepted(code: number, specs: string[]): boolean {
  if (specs.length === 0) return code >= 200 && code <= 299
  return specs.some((spec) => {
    const m = /^(\d{3})-(\d{3})$/.exec(spec.trim())
    if (m) return code >= Number(m[1]) && code <= Number(m[2])
    return Number(spec.trim()) === code
  })
}

function fetchCertDaysLeft(hostname: string, port: number, timeoutMs: number): Promise<number | null> {
  return new Promise((resolve) => {
    const socket = tls.connect({ host: hostname, port, rejectUnauthorized: false, servername: hostname }, () => {
      const cert = socket.getPeerCertificate()
      socket.end()
      if (!cert.valid_to) return resolve(null)
      const days = Math.floor((new Date(cert.valid_to).getTime() - Date.now()) / 86_400_000)
      resolve(days)
    })
    socket.setTimeout(timeoutMs, () => { socket.destroy(); resolve(null) })
    socket.on('error', () => resolve(null))
  })
}

export const httpProbe: Probe = {
  async run(cfg: ProbeConfig, signal: AbortSignal): Promise<ProbeResult> {
    const c = cfg.config as HttpCfg
    const started = performance.now()
    const timeout = AbortSignal.timeout(cfg.timeoutMs)
    const signalAll = AbortSignal.any([signal, timeout])
    let res: Response
    let body = ''
    try {
      res = await fetch(cfg.target, {
        method: (c.method ?? 'GET').toUpperCase(),
        headers: c.headers,
        body: c.method && c.method.toUpperCase() !== 'GET' ? c.body : undefined,
        redirect: c.follow_redirects === false ? 'manual' : 'follow',
        signal: signalAll,
        tls: c.ignore_tls ? { rejectUnauthorized: false } : undefined,
      } as RequestInit)
      // manual redirect 时不读 body（302 可能无 body）
      if (!(c.follow_redirects === false && res.status >= 300 && res.status < 400)) body = await res.text()
    } catch (e) {
      const msg = timeout.aborted && !signal.aborted ? 'request timeout' : shortError(e)
      return { ok: false, latencyMs: null, error: msg, certDaysLeft: null }
    }
    const latency = Math.round(performance.now() - started)

    if (!statusAccepted(res.status, c.accepted_status_codes ?? [])) {
      return { ok: false, latencyMs: latency, error: `unexpected status code ${res.status}`, certDaysLeft: null }
    }
    if (c.keyword) {
      const found = body.includes(c.keyword)
      if (found === !!c.keyword_invert) {
        return { ok: false, latencyMs: latency, error: c.keyword_invert ? `keyword "${c.keyword}" found` : `keyword "${c.keyword}" not found`, certDaysLeft: null }
      }
    }
    if (c.json_query !== undefined) {
      let parsed: unknown
      try { parsed = JSON.parse(body) } catch {
        return { ok: false, latencyMs: latency, error: 'json parse failed', certDaysLeft: null }
      }
      const actual = String((parsed as Record<string, unknown>)[c.json_query] ?? '')
      if (actual !== String(c.json_expected ?? '')) {
        return { ok: false, latencyMs: latency, error: `json "${c.json_query}" expected "${c.json_expected}", got "${actual}"`, certDaysLeft: null }
      }
    }

    let certDaysLeft: number | null = null
    if (c.check_cert_expiry) {
      try {
        const u = new URL(cfg.target)
        if (u.protocol === 'https:') certDaysLeft = await fetchCertDaysLeft(u.hostname, Number(u.port || 443), cfg.timeoutMs)
      } catch { certDaysLeft = null }
    }
    return { ok: true, latencyMs: latency, error: null, certDaysLeft }
  },
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd server && bun test src/probes/http.test.ts`
Expected: 9 pass。

- [ ] **Step 5: Commit**

```bash
git add server/src/probes/http.ts server/src/probes/http.test.ts
git commit -m "feat(probes): http probe with status/keyword/json/redirect/tls checks"
```

---

### Task 5: PING 探测

**Files:**
- Create: `server/src/probes/ping.ts`
- Create: `server/src/probes/ping.test.ts`

**Interfaces:**
- Produces: `pingProbe: Probe`；导出 `runPingCommand`（供测试注入替换）、`parsePingOutput`（纯函数，可单测）。

实现说明：Bun 没有原生 ICMP 接口，通过子进程调用系统 `ping`（macOS/Linux 均可）。Docker 部署时的权限问题在计划 05 处理。`packet_count` 默认 1。

- [ ] **Step 1: 写失败测试**

`server/src/probes/ping.test.ts`:

```ts
import { expect, test, mock } from 'bun:test'
import { pingProbe, parsePingOutput, setRunnerForTest } from './ping'
import type { ProbeConfig } from './types'

function cfg(target = '127.0.0.1', config: Record<string, unknown> = {}): ProbeConfig {
  return { type: 'ping', target, port: null, timeoutMs: 2000, config }
}

test('parsePingOutput detects success and extracts rtt', () => {
  const out = 'PING example.com (93.184.216.34): 56 data bytes\n64 bytes from 93.184.216.34: icmp_seq=0 ttl=56 time=3.456 ms\n--- example.com ping statistics ---\n1 packets transmitted, 1 packets received, 0.0% packet loss\nround-trip min/avg/max/stddev = 3.456/3.456/3.456/0.000 ms\n'
  expect(parsePingOutput(out)).toEqual({ ok: true, latencyMs: 3.456 })
})

test('parsePingOutput detects 100% loss as failure', () => {
  const out = 'PING nohost (10.255.255.1): 56 data bytes\n--- nohost ping statistics ---\n1 packets transmitted, 0 packets received, 100.0% packet loss\n'
  expect(parsePingOutput(out)).toEqual({ ok: false, latencyMs: null })
})

test('ping probe uses injected runner and packet_count', async () => {
  const runner = mock(async (_args: string[]) => ({ exitCode: 0, stdout: '64 bytes from 127.0.0.1: icmp_seq=0 ttl=64 time=0.045 ms\n1 packets transmitted, 1 packets received, 0.0% packet loss\n', stderr: '' }))
  setRunnerForTest(runner)
  const r = await pingProbe.run(cfg('127.0.0.1', { packet_count: 3 }), AbortSignal.timeout(3000))
  expect(r.ok).toBe(true)
  expect(r.latencyMs).toBe(0)
  const args = runner.mock.calls[0]![0]!
  expect(args.join(' ')).toContain('-c 3')
  setRunnerForTest(null)
})

test('ping probe failure never throws', async () => {
  setRunnerForTest(async () => ({ exitCode: 2, stdout: '', stderr: 'ping: cannot resolve host' }))
  const r = await pingProbe.run(cfg('nohost.invalid'), AbortSignal.timeout(3000))
  expect(r.ok).toBe(false)
  expect(r.error).toContain('cannot resolve host')
  setRunnerForTest(null)
})
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd server && bun test src/probes/ping.test.ts`
Expected: FAIL（`Cannot find module './ping'`）。

- [ ] **Step 3: 实现 ping.ts**

`server/src/probes/ping.ts`:

```ts
import type { Probe, ProbeConfig, ProbeResult } from './types'
import { shortError } from './types'

export interface PingRunResult { exitCode: number; stdout: string; stderr: string }
type Runner = (args: string[], timeoutMs: number, signal: AbortSignal) => Promise<PingRunResult>

/** 解析系统 ping 输出：有 reply 行取 time= 作为延迟，否则看丢包率 */
export function parsePingOutput(stdout: string): { ok: boolean; latencyMs: number | null } {
  const timeMatch = /time[=<]\s*([\d.]+)\s*ms/.exec(stdout)
  const lossMatch = /([\d.]+)% packet loss/.exec(stdout)
  if (lossMatch && Number(lossMatch[1]) >= 100 && !timeMatch) return { ok: false, latencyMs: null }
  if (timeMatch) return { ok: true, latencyMs: Number(timeMatch[1]) }
  return { ok: false, latencyMs: null }
}

const systemRunner: Runner = async (args, timeoutMs, signal) => {
  const proc = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe' })
  const timer = setTimeout(() => proc.kill(), timeoutMs)
  const onAbort = () => proc.kill()
  signal.addEventListener('abort', onAbort)
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    return { exitCode, stdout, stderr }
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
  }
}

let runner: Runner = systemRunner
export function setRunnerForTest(r: Runner | null) { runner = r ?? systemRunner }

const isDarwin = process.platform === 'darwin'

function buildArgs(target: string, count: number, timeoutMs: number): string[] {
  const timeoutS = Math.max(1, Math.ceil(timeoutMs / 1000))
  // macOS: -t <秒> 是整体超时；Linux: -W <秒> 是单包超时
  return isDarwin
    ? ['ping', '-c', String(count), '-t', String(timeoutS), target]
    : ['ping', '-c', String(count), '-W', String(timeoutS), target]
}

export const pingProbe: Probe = {
  async run(cfg: ProbeConfig, signal: AbortSignal): Promise<ProbeResult> {
    const count = Math.max(1, Number(cfg.config.packet_count ?? 1))
    const started = performance.now()
    try {
      const { exitCode, stdout, stderr } = await runner(buildArgs(cfg.target, count, cfg.timeoutMs), cfg.timeoutMs, signal)
      const parsed = parsePingOutput(stdout)
      if (parsed.ok) {
        return { ok: true, latencyMs: parsed.latencyMs === null ? Math.round(performance.now() - started) : Math.round(parsed.latencyMs), error: null, certDaysLeft: null }
      }
      const err = stderr.trim() || (exitCode === 0 ? 'no reply received' : `ping exited with code ${exitCode}`)
      return { ok: false, latencyMs: null, error: shortError(err), certDaysLeft: null }
    } catch (e) {
      return { ok: false, latencyMs: null, error: shortError(e), certDaysLeft: null }
    }
  },
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd server && bun test src/probes/ping.test.ts`
Expected: 4 pass。

- [ ] **Step 5: Commit**

```bash
git add server/src/probes/ping.ts server/src/probes/ping.test.ts
git commit -m "feat(probes): ping probe via system ping with injectable runner"
```

---

### Task 6: DNS 探测

**Files:**
- Create: `server/src/probes/dns.ts`
- Create: `server/src/probes/dns.test.ts`

**Interfaces:**
- Produces: `dnsProbe: Probe`；导出纯函数 `buildDnsQuery(domain, recordType): Uint8Array` 与 `parseDnsResponse(buf): string[]` 供测试。

`config` 字段：`resolver`（默认 `1.1.1.1`）、`record_type`（默认 `A`）、`expected_value`（可选）。实现方式：用 Bun UDP socket 直接向 resolver 发 DNS 报文（端口 53），第一期只支持 A / AAAA / CNAME / TXT 应答解析。

- [ ] **Step 1: 写失败测试**

`server/src/probes/dns.test.ts`:

```ts
import { afterAll, expect, test } from 'bun:test'
import { dnsProbe, buildDnsQuery, parseDnsResponse } from './dns'
import type { ProbeConfig } from './types'

/** 最小 DNS 应答构造：回显 query，把 A 记录 1.2.3.4 放进 answer */
function buildAResponse(query: Uint8Array): Uint8Array {
  const out = Uint8Array.from(query)
  out[2] = 0x81; out[3] = 0x80                     // QR=1, RCODE=0
  out[6] = 0; out[7] = 1                            // ANCOUNT=1
  const answer = new Uint8Array([
    0xc0, 0x0c,                                     // name: pointer to qname
    0x00, 0x01,                                     // TYPE A
    0x00, 0x01,                                     // CLASS IN
    0x00, 0x00, 0x00, 0x3c,                         // TTL 60
    0x00, 0x04,                                     // RDLENGTH
    1, 2, 3, 4,                                     // RDATA
  ])
  const merged = new Uint8Array(out.length + answer.length)
  merged.set(out); merged.set(answer, out.length)
  return merged
}

const udp = await Bun.udpSocket({
  port: 0, hostname: '127.0.0.1',
  socket: { data(socket, data, addr) { socket.send(buildAResponse(data), addr.port, addr.address) }, error() {} },
})

afterAll(() => udp.close())

function cfg(config: Record<string, unknown>): ProbeConfig {
  return { type: 'dns', target: 'example.com', port: null, timeoutMs: 2000, config }
}

test('buildDnsQuery encodes qname and type', () => {
  const q = buildDnsQuery('a.b', 'A')
  expect(q[4]).toBe(0); expect(q[5]).toBe(1)       // QDCOUNT=1
  expect(q[12]).toBe(1)                            // label len 'a'
  expect(q[13]).toBe(0x61)                         // 'a'
  expect(q[q.length - 2]).toBe(0); expect(q[q.length - 1]).toBe(1)  // TYPE A
})

test('parseDnsResponse extracts A record', () => {
  const q = buildDnsQuery('example.com', 'A')
  const values = parseDnsResponse(buildAResponse(q))
  expect(values).toEqual(['1.2.3.4'])
})

test('dns probe success without expected_value', async () => {
  const r = await dnsProbe.run(cfg({ resolver: '127.0.0.1', resolver_port: udp.port }), AbortSignal.timeout(3000))
  expect(r.ok).toBe(true)
  expect(r.latencyMs).not.toBeNull()
})

test('dns probe expected_value mismatch fails', async () => {
  const r = await dnsProbe.run(cfg({ resolver: '127.0.0.1', resolver_port: udp.port, expected_value: '9.9.9.9' }), AbortSignal.timeout(3000))
  expect(r.ok).toBe(false)
  expect(r.error).toContain('9.9.9.9')
})

test('dns probe expected_value match succeeds', async () => {
  const r = await dnsProbe.run(cfg({ resolver: '127.0.0.1', resolver_port: udp.port, expected_value: '1.2.3.4' }), AbortSignal.timeout(3000))
  expect(r.ok).toBe(true)
})
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd server && bun test src/probes/dns.test.ts`
Expected: FAIL（`Cannot find module './dns'`）。

- [ ] **Step 3: 实现 dns.ts**

`server/src/probes/dns.ts`:

```ts
import type { Probe, ProbeConfig, ProbeResult } from './types'
import { shortError } from './types'

const TYPE_CODES: Record<string, number> = { A: 1, AAAA: 28, CNAME: 5, TXT: 16, NS: 2, MX: 15 }

export function buildDnsQuery(domain: string, recordType: string): Uint8Array {
  const type = TYPE_CODES[recordType.toUpperCase()] ?? 1
  const labels = domain.split('.').filter(Boolean)
  const qnameLen = labels.reduce((n, l) => n + 1 + l.length, 0) + 1
  const buf = new Uint8Array(12 + qnameLen + 4)
  const id = Math.floor(Math.random() * 0xffff)
  const dv = new DataView(buf.buffer)
  dv.setUint16(0, id)
  dv.setUint16(2, 0x0100)                          // RD=1
  dv.setUint16(4, 1)                               // QDCOUNT
  let off = 12
  for (const label of labels) {
    buf[off++] = label.length
    for (let i = 0; i < label.length; i++) buf[off++] = label.charCodeAt(i)
  }
  buf[off++] = 0
  dv.setUint16(off, type); dv.setUint16(off + 2, 1) // QTYPE, QCLASS IN
  return buf
}

function readName(_buf: Uint8Array, off: number): number {
  // 跳过名字：支持压缩指针与标签序列，返回名字之后的偏移
  let i = off
  for (;;) {
    const len = _buf[i]!
    if (len === 0) return i + 1
    if ((len & 0xc0) === 0xc0) return i + 2        // 压缩指针：2 字节
    i += 1 + len
  }
}

export function parseDnsResponse(buf: Uint8Array): string[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const qd = dv.getUint16(4), an = dv.getUint16(6)
  let off = 12
  for (let i = 0; i < qd; i++) { off = readName(buf, off); off += 4 }
  const values: string[] = []
  for (let i = 0; i < an; i++) {
    off = readName(buf, off)
    const type = dv.getUint16(off), rdlen = dv.getUint16(off + 8)
    const rdata = off + 10
    if (type === 1 && rdlen === 4) values.push(`${buf[rdata]}.${buf[rdata + 1]}.${buf[rdata + 2]}.${buf[rdata + 3]}`)
    else if (type === 28 && rdlen === 16) {
      const parts: string[] = []
      for (let p = 0; p < 16; p += 2) parts.push(((buf[rdata + p]! << 8) | buf[rdata + p + 1]!).toString(16))
      values.push(parts.join(':').replace(/\b0+\b/g, '').replace(/:{2,}/g, '::'))
    } else if (type === 16) {
      values.push(new TextDecoder().decode(buf.subarray(rdata + 1, rdata + rdlen)))
    } else if (type === 5 || type === 2) {
      values.push('<cname-or-ns>')                 // CNAME/NS 只计“解析成功”
    }
    off = rdata + rdlen
  }
  return values
}

function udpQuery(query: Uint8Array, resolver: string, port: number, timeoutMs: number, signal: AbortSignal): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = <T>(fn: () => T) => { if (!settled) { settled = true; clearTimeout(timer); signal.removeEventListener('abort', onAbort); socket.close(); return fn() } }
    const timer = setTimeout(() => finish(() => reject(new Error('dns query timeout'))), timeoutMs)
    const onAbort = () => finish(() => reject(new Error('aborted')))
    signal.addEventListener('abort', onAbort)
    let socket: ReturnType<Awaited<ReturnType<typeof Bun.udpSocket>>['close']> & { send: (d: Uint8Array, port: number, addr: string) => void; close: () => void }
    Bun.udpSocket({
      hostname: '0.0.0.0', port: 0,
      socket: {
        data(_s, data) { finish(() => resolve(Uint8Array.from(data))) },
        error(_s, err) { finish(() => reject(err)) },
      },
    }).then((s) => { socket = s as never; s.send(query, port, resolver) })
      .catch((e) => finish(() => reject(e)))
  })
}

export const dnsProbe: Probe = {
  async run(cfg: ProbeConfig, signal: AbortSignal): Promise<ProbeResult> {
    const resolver = String(cfg.config.resolver ?? '1.1.1.1')
    const resolverPort = Number(cfg.config.resolver_port ?? 53)   // resolver_port 仅供测试注入
    const recordType = String(cfg.config.record_type ?? 'A')
    const expected = cfg.config.expected_value ? String(cfg.config.expected_value) : null
    const started = performance.now()
    try {
      const query = buildDnsQuery(cfg.target, recordType)
      const response = await udpQuery(query, resolver, resolverPort, cfg.timeoutMs, signal)
      const values = parseDnsResponse(response)
      const latency = Math.round(performance.now() - started)
      if (expected !== null) {
        if (values.includes(expected)) return { ok: true, latencyMs: latency, error: null, certDaysLeft: null }
        return { ok: false, latencyMs: latency, error: `expected ${expected}, resolved to ${values.join(', ') || '(empty)'}`, certDaysLeft: null }
      }
      if (values.length > 0) return { ok: true, latencyMs: latency, error: null, certDaysLeft: null }
      return { ok: false, latencyMs: latency, error: 'no answer records', certDaysLeft: null }
    } catch (e) {
      return { ok: false, latencyMs: null, error: shortError(e), certDaysLeft: null }
    }
  },
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd server && bun test src/probes/dns.test.ts`
Expected: 5 pass。

- [ ] **Step 5: Commit**

```bash
git add server/src/probes/dns.ts server/src/probes/dns.test.ts
git commit -m "feat(probes): dns probe over raw udp with resolver/record/expected checks"
```

---

### Task 7: probe registry

**Files:**
- Create: `server/src/probes/index.ts`

**Interfaces:**
- Produces: `getProbe(type: ProbeType): Probe`；`probeConfigFromMonitor(m: { type, target, port, timeoutMs, config }): ProbeConfig`（config 为已解析的 JSON 对象）。

- [ ] **Step 1: 实现 index.ts（小文件，直接写并冒烟验证）**

`server/src/probes/index.ts`:

```ts
import { httpProbe } from './http'
import { tcpProbe } from './tcp'
import { pingProbe } from './ping'
import { dnsProbe } from './dns'
import type { Probe, ProbeConfig, ProbeType } from './types'

const REGISTRY: Record<ProbeType, Probe> = {
  http: httpProbe,
  tcp: tcpProbe,
  ping: pingProbe,
  dns: dnsProbe,
}

export function getProbe(type: ProbeType): Probe {
  const p = REGISTRY[type]
  if (!p) throw new Error(`unknown probe type: ${type}`)
  return p
}

export function probeConfigFromMonitor(m: {
  type: ProbeType; target: string; port: number | null; timeoutMs: number; config: Record<string, unknown>
}): ProbeConfig {
  return { type: m.type, target: m.target, port: m.port, timeoutMs: m.timeoutMs, config: m.config }
}

export type { Probe, ProbeConfig, ProbeResult, ProbeType } from './types'
```

- [ ] **Step 2: 验证类型检查通过**

Run: `cd server && bunx tsc --noEmit`
Expected: 无输出（无类型错误）。

- [ ] **Step 3: Commit**

```bash
git add server/src/probes/index.ts
git commit -m "feat(probes): registry mapping monitor type to probe"
```

---

### Task 8: scheduler/clock.ts

**Files:**
- Create: `server/src/scheduler/clock.ts`
- Create: `server/src/scheduler/clock.test.ts`

**Interfaces:**
- Produces: `slotStartAt(nowSec, intervalS): number`、`nextSlotStart(nowSec, intervalS): number`、`effectiveRetries(opts): number`（签名见总览）。

- [ ] **Step 1: 写失败测试（设计文档 §11 clock.test.ts 三条全覆盖）**

`server/src/scheduler/clock.test.ts`:

```ts
import { expect, test } from 'bun:test'
import { slotStartAt, nextSlotStart, effectiveRetries } from './clock'

test('slotStartAt aligns to UTC epoch grid for arbitrary now', () => {
  const interval = 120
  for (const now of [0, 1, 119, 120, 121, 1_700_000_037, 1_700_000_159]) {
    const start = slotStartAt(now, interval)
    expect(start % interval).toBe(0)
    expect(start).toBeLessThanOrEqual(now)
    expect(now).toBeLessThan(start + interval)
  }
})

test('nextSlotStart is strictly in the future and lands on a boundary', () => {
  expect(nextSlotStart(120, 120)).toBe(240)        // 恰在边界上 → 下一格
  expect(nextSlotStart(121, 120)).toBe(240)
  expect(nextSlotStart(239, 120)).toBe(240)
})

test('interval change takes effect from next boundary', () => {
  const now = 1_700_000_037                        // 旧 interval 60 的某个 slot 中间
  expect(nextSlotStart(now, 60)).toBe(1_700_000_040)
  expect(nextSlotStart(now, 300)).toBe(1_700_000_100)
})

test('effectiveRetries: spec example 120/30/max4/timeout10s -> 3', () => {
  expect(effectiveRetries({ intervalS: 120, retryIntervalS: 30, maxRetries: 4, timeoutMs: 10_000 })).toBe(3)
})

test('effectiveRetries: budget smaller than boundary cap', () => {
  expect(effectiveRetries({ intervalS: 120, retryIntervalS: 30, maxRetries: 1, timeoutMs: 10_000 })).toBe(1)
})

test('effectiveRetries: exact divisibility boundary', () => {
  // (60000 - 10000) / 10000 = 5 整除
  expect(effectiveRetries({ intervalS: 60, retryIntervalS: 10, maxRetries: 10, timeoutMs: 10_000 })).toBe(5)
})

test('effectiveRetries: timeout close to retry interval squeezes budget', () => {
  // (120000 - 30000) / 30000 = 3
  expect(effectiveRetries({ intervalS: 120, retryIntervalS: 30, maxRetries: 10, timeoutMs: 30_000 })).toBe(3)
  // timeout 逼近但小于 retry interval: (120000 - 29999) / 30000 = 3.0000...
  expect(effectiveRetries({ intervalS: 120, retryIntervalS: 30, maxRetries: 10, timeoutMs: 29_999 })).toBe(3)
  // timeout 吃满一个 retry 间隔以上: (120000 - 60000) / 30000 = 2
  expect(effectiveRetries({ intervalS: 120, retryIntervalS: 30, maxRetries: 10, timeoutMs: 60_000 })).toBe(2)
})

test('effectiveRetries never negative', () => {
  expect(effectiveRetries({ intervalS: 60, retryIntervalS: 55, maxRetries: 10, timeoutMs: 50_000 })).toBe(0)
})
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd server && bun test src/scheduler/clock.test.ts`
Expected: FAIL（`Cannot find module './clock'`）。

- [ ] **Step 3: 实现 clock.ts**

`server/src/scheduler/clock.ts`:

```ts
/** slot 起点：对齐 UTC epoch，floor(now / interval) * interval */
export function slotStartAt(nowSec: number, intervalS: number): number {
  return Math.floor(nowSec / intervalS) * intervalS
}

/** 严格在 now 之后的下一个边界（now 恰在边界上时返回下一格） */
export function nextSlotStart(nowSec: number, intervalS: number): number {
  return slotStartAt(nowSec, intervalS) + intervalS
}

/** 重试预算被 slot 边界硬截断（设计文档 §3.4） */
export function effectiveRetries(o: { intervalS: number; retryIntervalS: number; maxRetries: number; timeoutMs: number }): number {
  const cap = Math.floor((o.intervalS * 1000 - o.timeoutMs) / (o.retryIntervalS * 1000))
  return Math.max(0, Math.min(o.maxRetries, cap))
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd server && bun test src/scheduler/clock.test.ts`
Expected: 8 pass。

- [ ] **Step 5: Commit**

```bash
git add server/src/scheduler/clock.ts server/src/scheduler/clock.test.ts
git commit -m "feat(scheduler): slot boundary and effective retry budget pure functions"
```

---

### Task 9: scheduler/slot-runner.ts — slot 状态机

**Files:**
- Create: `server/src/scheduler/slot-runner.ts`
- Create: `server/src/scheduler/slot-runner.test.ts`

**Interfaces:**
- Consumes: `clock.ts` 的 `effectiveRetries`；`probes/types.ts` 的 `Probe/ProbeResult`。
- Produces: `runSlot(cfg, deps, slotStartSec, signal): Promise<SlotResult>`、`SlotResult`、`AttemptRow`、`SlotStatus`、`MonitorRuntimeConfig`、`SlotDeps`（签名见总览）。
- 约束：本文件不得 import `../db/`、`../store/`。

- [ ] **Step 1: 写失败测试（设计文档 §11 slot-runner 全部用例）**

`server/src/scheduler/slot-runner.test.ts`:

```ts
import { expect, test } from 'bun:test'
import { runSlot } from './slot-runner'
import type { MonitorRuntimeConfig, SlotDeps } from './slot-runner'
import type { Probe, ProbeResult } from '../probes/types'

/** 可编程假时钟：秒，可手动推进 */
function fakeClock(startSec: number) {
  let t = startSec
  return {
    now: () => t,
    advance: (sec: number) => { t += sec },
    sleep: async (ms: number) => { t += ms / 1000 },
  }
}

function fakeProbe(results: ProbeResult[]): Probe & { callCount: () => number } {
  let i = 0
  return {
    callCount: () => i,
    async run(_cfg, _signal) {
      const r = results[Math.min(i, results.length - 1)]!
      i++
      return r
    },
  }
}

const ok = (latencyMs = 12): ProbeResult => ({ ok: true, latencyMs, error: null, certDaysLeft: null })
const fail = (error = 'connection refused'): ProbeResult => ({ ok: false, latencyMs: null, error, certDaysLeft: null })

function cfg(over: Partial<MonitorRuntimeConfig> = {}): MonitorRuntimeConfig {
  return {
    id: 1, type: 'http', target: 'http://x', port: null,
    intervalS: 120, retryIntervalS: 30, maxRetries: 3, timeoutMs: 10_000,
    config: {}, ...over,
  }
}

test('first attempt success -> up, attempts=1, probe called once', async () => {
  const clock = fakeClock(120)
  const probe = fakeProbe([ok()])
  const deps: SlotDeps = { probe, now: clock.now, sleep: clock.sleep }
  const r = await runSlot(cfg(), deps, 120, new AbortController().signal)
  expect(r.status).toBe(0)
  expect(r.attempts).toBe(1)
  expect(r.latencyMs).toBe(12)
  expect(r.attemptRows.length).toBe(1)
  expect(probe.callCount()).toBe(1)
})

test('first fails, retry 2 succeeds -> flaky, attempts=3, recovered_after_s correct', async () => {
  const clock = fakeClock(120)
  const probe = fakeProbe([fail(), fail(), ok(20)])
  const deps: SlotDeps = { probe, now: clock.now, sleep: clock.sleep }
  const r = await runSlot(cfg(), deps, 120, new AbortController().signal)
  expect(r.status).toBe(1)
  expect(r.attempts).toBe(3)
  expect(r.latencyMs).toBe(20)
  expect(r.recoveredAfterS).toBe(60)               // t=0 首检, +30 重试1, +60 重试2 成功
  expect(r.attemptRows.map((a) => [a.seq, a.ok])).toEqual([[0, false], [1, false], [2, true]])
})

test('all attempts fail -> down, error is the last failure', async () => {
  const clock = fakeClock(0)
  const probe = fakeProbe([fail('err-1'), fail('err-2'), fail('err-3'), fail('err-4')])
  const deps: SlotDeps = { probe, now: clock.now, sleep: clock.sleep }
  const r = await runSlot(cfg({ maxRetries: 3 }), deps, 0, new AbortController().signal)
  expect(r.status).toBe(2)
  expect(r.attempts).toBe(4)
  expect(r.error).toBe('err-4')
  expect(r.latencyMs).toBeNull()
  expect(r.recoveredAfterS).toBeNull()
})

test('retry budget truncated by boundary: 120/30/max4/timeout10s -> 3 retries then down', async () => {
  const clock = fakeClock(0)
  const probe = fakeProbe([fail()])                // 无限失败
  const deps: SlotDeps = { probe, now: clock.now, sleep: clock.sleep }
  const r = await runSlot(cfg({ maxRetries: 4 }), deps, 0, new AbortController().signal)
  expect(r.status).toBe(2)
  expect(r.attempts).toBe(4)                       // 首检 + 3 次重试（第 4 次被边界截断）
  expect(clock.now()).toBeLessThanOrEqual(120)
})

test('three consecutive down slots produce exactly three SlotResults (kuma regression)', async () => {
  // kuma 在同样场景会写出 12 行心跳；这里无论重试多少次，每个 slot 恒定 1 个结果
  const results = []
  let t = 0
  for (let i = 0; i < 3; i++) {
    const clock = fakeClock(t)
    const probe = fakeProbe([fail()])
    const deps: SlotDeps = { probe, now: clock.now, sleep: clock.sleep }
    results.push(await runSlot(cfg({ maxRetries: 3 }), deps, t, new AbortController().signal))
    t += 120
  }
  expect(results.length).toBe(3)
  expect(results.every((r) => r.status === 2)).toBe(true)
})

test('slot boundary aborts the in-flight probe via signal', async () => {
  const clock = fakeClock(0)
  let sawAbort = false
  const probe: Probe = {
    async run(_c, signal) {
      // 模拟一次慢探测：等待直到被 abort
      return await new Promise<ProbeResult>((resolve) => {
        signal.addEventListener('abort', () => { sawAbort = true; resolve(fail('aborted')) })
      })
    },
  }
  const ac = new AbortController()
  const deps: SlotDeps = { probe, now: clock.now, sleep: clock.sleep }
  const p = runSlot(cfg(), deps, 0, ac.signal)
  await Bun.sleep(10)                             // 让 runSlot 进入探测
  ac.abort()                                       // 模拟 slot 边界到达
  const r = await p
  expect(sawAbort).toBe(true)
  expect(r.status).toBe(2)                         // abort 后按 down 收尾
})

test('flaky slot recovers on first retry: attempts=2, recovered_after_s=retry_interval', async () => {
  const clock = fakeClock(0)
  const probe = fakeProbe([fail(), ok()])
  const deps: SlotDeps = { probe, now: clock.now, sleep: clock.sleep }
  const r = await runSlot(cfg({ retryIntervalS: 20 }), deps, 0, new AbortController().signal)
  expect(r.status).toBe(1)
  expect(r.attempts).toBe(2)
  expect(r.recoveredAfterS).toBe(20)
})
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd server && bun test src/scheduler/slot-runner.test.ts`
Expected: FAIL（`Cannot find module './slot-runner'`）。

- [ ] **Step 3: 实现 slot-runner.ts**

`server/src/scheduler/slot-runner.ts`:

```ts
import { effectiveRetries } from './clock'
import { probeConfigFromMonitor, type Probe, type ProbeResult } from '../probes'

export type SlotStatus = 0 | 1 | 2                 // up | flaky | down

export interface AttemptRow {
  seq: number                                      // 0=首检, 1..n=重试
  ok: boolean
  latencyMs: number | null
  error: string | null
  at: number                                       // unix 秒
}

export interface SlotResult {
  status: SlotStatus
  attempts: number
  recoveredAfterS: number | null
  latencyMs: number | null
  error: string | null
  certDaysLeft: number | null
  attemptRows: AttemptRow[]
}

export interface MonitorRuntimeConfig {
  id: number
  type: 'http' | 'tcp' | 'ping' | 'dns'
  target: string
  port: number | null
  intervalS: number
  retryIntervalS: number
  maxRetries: number
  timeoutMs: number
  config: Record<string, unknown>
}

export interface SlotDeps {
  probe: Probe
  now: () => number                                // unix 秒
  sleep: (ms: number, signal: AbortSignal) => Promise<void>
}

/**
 * 运行单个 slot 的状态机（设计文档 §3.3）：
 * 首检成功=up；重试后成功=flaky；预算用尽/撞上边界=down。
 * 至多产出 1 个 SlotResult，与实际探测次数无关。
 */
export async function runSlot(
  cfg: MonitorRuntimeConfig,
  deps: SlotDeps,
  slotStartSec: number,
  signal: AbortSignal,
): Promise<SlotResult> {
  const { probe, now, sleep } = deps
  const probeCfg = probeConfigFromMonitor({ type: cfg.type, target: cfg.target, port: cfg.port, timeoutMs: cfg.timeoutMs, config: cfg.config })
  const budget = effectiveRetries(cfg)
  const attemptRows: AttemptRow[] = []
  let lastError: string | null = null
  let certDaysLeft: number | null = null

  for (let seq = 0; seq <= budget; seq++) {
    if (signal.aborted) break
    const attemptStart = now()
    const r: ProbeResult = await probe.run(probeCfg, signal)
    attemptRows.push({ seq, ok: r.ok, latencyMs: r.latencyMs, error: r.error, at: attemptStart })
    if (r.certDaysLeft !== null) certDaysLeft = r.certDaysLeft

    if (r.ok) {
      if (seq === 0) {
        return { status: 0, attempts: 1, recoveredAfterS: null, latencyMs: r.latencyMs, error: null, certDaysLeft, attemptRows }
      }
      return { status: 1, attempts: seq + 1, recoveredAfterS: Math.round(now() - slotStartSec), latencyMs: r.latencyMs, error: null, certDaysLeft, attemptRows }
    }
    lastError = r.error
    if (seq === budget || signal.aborted) break

    // 重试节奏：对齐 slot 起点 + retry_interval * (seq+1)，且不超过 slot 边界
    const nextAtMs = (slotStartSec + cfg.retryIntervalS * (seq + 1)) * 1000
    const waitMs = nextAtMs - now() * 1000
    if (waitMs <= 0) break                          // 已撞边界，直接判 down
    await sleep(waitMs, signal)
  }

  return { status: 2, attempts: attemptRows.length, recoveredAfterS: null, latencyMs: null, error: lastError, certDaysLeft, attemptRows }
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd server && bun test src/scheduler/slot-runner.test.ts`
Expected: 7 pass。

- [ ] **Step 5: 全量回归 + 类型检查**

Run: `cd server && bun test && bunx tsc --noEmit`
Expected: 全部 pass；tsc 无错误。

- [ ] **Step 6: Commit**

```bash
git add server/src/scheduler/slot-runner.ts server/src/scheduler/slot-runner.test.ts
git commit -m "feat(scheduler): slot state machine with injected probe/clock/sleep"
```

---

## 计划 01 验收清单

- `cd server && bun test`：全绿（db 4 + tcp 2 + http 9 + ping 4 + dns 5 + clock 8 + slot-runner 7 = 39 个测试）。
- `bunx tsc --noEmit` 无错误。
- `slot-runner.ts` 与 `clock.ts` 未 import `db/`、`store/`（grep 验证：`grep -r "from '../db" server/src/scheduler/` 无输出）。
- `web/mock/` 未被改动。
