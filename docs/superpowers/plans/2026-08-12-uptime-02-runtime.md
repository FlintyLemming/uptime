# uptime 计划 02：store 层 + 调度器 + rollup/retention + notify

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把计划 01 的判定引擎接上持久化与时间：store 层（每表一个薄封装）、每秒 tick 的调度器 + 并发池、每小时 rollup（slot_daily）与保留期清理、Webhook 状态转换/模板/投递。

**Architecture:** `scheduler.ts` 是唯一缝合「判定」与「持久化」的位置；rollup 幂等 upsert；notify 链路为纯函数（transitions）→ 渲染（template）→ 投递（dispatcher），投递失败永不阻塞探测。

**Tech Stack:** Bun、Drizzle ORM、bun:test。依赖计划 01 已完成（schema/client/probes/clock/slot-runner 均可用）。

## Global Constraints

（继承总览 Global Constraints，摘录本计划相关）

- `uptime% = (up + flaky) / (up + flaky + down)`，nodata 不进分母。
- 组状态 = 最差成员；组 uptime% = 分子和/分母和（加权）。
- 告警仅 `down`/`recovered`；flaky 不触发；nodata 不参与转换判定（用「上一个非 nodata slot」判定）。
- Webhook：超时 10s，退避 1s/4s/16s 共 3 次重试，失败记日志放弃。
- 保留期：attempt 默认 7 天、slot 默认 90 天，阈值读 `setting` 表；`slot_daily` 永不删；删后 `PRAGMA incremental_vacuum`。
- slot 写库失败：记日志、丢弃该 slot（呈现 nodata），不重试、不阻塞下一 slot。
- tick 循环顶层 try/catch，进程不退出。
- `slot_daily.day` 按 `display_timezone` 切日（用 `Intl` API，不引第三方时区库）。

## File Structure（本计划新增）

```
server/src/store/{monitors,slots,attempts,daily,webhooks,settings}.ts
server/src/rollup/{daily,retention}.ts + daily.test.ts
server/src/notify/{transitions,template,dispatcher}.ts + transitions.test.ts + template.test.ts
server/src/scheduler/scheduler.ts + scheduler.test.ts
server/src/config.ts
```

**Interfaces:** 见各 Task。供计划 03（API）消费的主要是：`settingsStore`（get/set 全部设置）、`monitorsStore`（CRUD + reorder）、`slotsStore`（查询窗口）、`dailyStore`（查询窗口/重建）、`webhooksStore`（CRUD）、`rollupDaily(db, nowSec)`、`runRetention(db, sql, nowSec)`、`buildApp(db, sql, deps)` 在计划 03 出现，本计划不涉及。

---

### Task 1: config.ts（环境变量）

**Files:**
- Create: `server/src/config.ts`

- [ ] **Step 1: 实现**

```ts
export interface AppConfig {
  dataDir: string
  dbFile: string
  port: number
  probeConcurrency: number
}

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const dataDir = env.DATA_DIR ?? './data'
  return {
    dataDir,
    dbFile: `${dataDir}/uptime.db`,
    port: Number(env.PORT ?? 3000),
    probeConcurrency: Math.max(1, Number(env.PROBE_CONCURRENCY ?? 20)),
  }
}
```

- [ ] **Step 2: 类型检查 + Commit**

```bash
cd server && bunx tsc --noEmit
cd /Users/flintylemming/Projects/uptime
git add server/src/config.ts && git commit -m "feat(config): DATA_DIR/PORT/PROBE_CONCURRENCY env handling"
```

---

### Task 2: store/settings.ts + store/monitors.ts

**Files:**
- Create: `server/src/store/settings.ts`
- Create: `server/src/store/monitors.ts`

**Interfaces:**
- Produces（settings）：
  - `getSettings(db): Settings`，`Settings = { display_timezone: string; site_title: string; slot_retention_days: number; attempt_retention_days: number }`
  - `getSetting(db, key): string | null`、`setSetting(db, key, value): void`
  - 校验：`validateSettings(input): string[]` 返回错误列表（`slot_retention_days < 90` 报错；时区必须能被 `Intl.DateTimeFormat` 接受）。
- Produces（monitors）：
  - `MonitorRow`（drizzle 行类型）、`createMonitor(db, input): MonitorRow`、`updateMonitor(db, id, input): MonitorRow | null`、`deleteMonitor(db, id): void`、`listMonitors(db): MonitorRow[]`（按 group sort_order, monitor sort_order 排序）、`reorderMonitors(db, ids: number[]): void`、`toRuntimeConfig(row): MonitorRuntimeConfig`（解析 config JSON）。
  - `validateMonitor(input): string[]`：必填 name/type/target；type ∈ {http,tcp,ping,dns}；tcp 必须有 port(1-65535)；http target 必须是合法 URL；`timeout_ms < retry_interval_s * 1000`（Global Constraint）；interval_s ≥ 10；retry_interval_s ≥ 1。
  - `createMonitor`/`updateMonitor` 的 input 类型：`{ groupId, name, type, target, port, intervalS, retryIntervalS, maxRetries, timeoutMs, active, sortOrder, config }`，config 为对象（内部 JSON.stringify 存库）。`createdAt/updatedAt` 用 `Math.floor(Date.now()/1000)`。

- [ ] **Step 1: 实现 settings.ts**

```ts
import { eq } from 'drizzle-orm'
import { setting } from '../db/schema'
import type { DrizzleDb } from '../db/client'

export interface Settings {
  display_timezone: string
  site_title: string
  slot_retention_days: number
  attempt_retention_days: number
}

export function getSetting(db: DrizzleDb, key: string): string | null {
  return db.select().from(setting).where(eq(setting.key, key)).get()?.value ?? null
}

export function setSetting(db: DrizzleDb, key: string, value: string): void {
  const existing = db.select().from(setting).where(eq(setting.key, key)).get()
  if (existing) db.update(setting).set({ value }).where(eq(setting.key, key)).run()
  else db.insert(setting).values({ key, value }).run()
}

export function getSettings(db: DrizzleDb): Settings {
  return {
    display_timezone: getSetting(db, 'display_timezone') ?? 'Asia/Shanghai',
    site_title: getSetting(db, 'site_title') ?? 'Status',
    slot_retention_days: Number(getSetting(db, 'slot_retention_days') ?? '90'),
    attempt_retention_days: Number(getSetting(db, 'attempt_retention_days') ?? '7'),
  }
}

export function validateSettings(input: Partial<Settings>): string[] {
  const errors: string[] = []
  if (input.slot_retention_days !== undefined && input.slot_retention_days < 90) {
    errors.push('slot_retention_days must be >= 90')
  }
  if (input.attempt_retention_days !== undefined && input.attempt_retention_days < 1) {
    errors.push('attempt_retention_days must be >= 1')
  }
  if (input.display_timezone !== undefined) {
    try { new Intl.DateTimeFormat('en-US', { timeZone: input.display_timezone }) }
    catch { errors.push(`invalid timezone: ${input.display_timezone}`) }
  }
  return errors
}
```

- [ ] **Step 2: 实现 monitors.ts**

```ts
import { asc, eq } from 'drizzle-orm'
import { monitor, monitorGroup } from '../db/schema'
import type { DrizzleDb } from '../db/client'
import type { MonitorRuntimeConfig } from '../scheduler/slot-runner'

export type MonitorRow = typeof monitor.$inferSelect
export type MonitorInput = {
  groupId: number | null; name: string; type: string; target: string; port: number | null
  intervalS: number; retryIntervalS: number; maxRetries: number; timeoutMs: number
  active: number; sortOrder: number; config: Record<string, unknown>
}

const PROBE_TYPES = ['http', 'tcp', 'ping', 'dns']

export function validateMonitor(input: MonitorInput): string[] {
  const errors: string[] = []
  if (!input.name?.trim()) errors.push('name is required')
  if (!PROBE_TYPES.includes(input.type)) errors.push(`type must be one of ${PROBE_TYPES.join(', ')}`)
  if (!input.target?.trim()) errors.push('target is required')
  if (input.type === 'http') {
    try { new URL(input.target) } catch { errors.push('http target must be a valid URL') }
  }
  if (input.type === 'tcp' && !(input.port && input.port >= 1 && input.port <= 65535)) {
    errors.push('tcp monitor requires port between 1 and 65535')
  }
  if (input.intervalS < 10) errors.push('interval_s must be >= 10')
  if (input.retryIntervalS < 1) errors.push('retry_interval_s must be >= 1')
  if (input.timeoutMs >= input.retryIntervalS * 1000) {
    errors.push('timeout_ms must be smaller than retry_interval_s * 1000')
  }
  return errors
}

function nowSec() { return Math.floor(Date.now() / 1000) }

export function createMonitor(db: DrizzleDb, input: MonitorInput): MonitorRow {
  return db.insert(monitor).values({ ...input, config: JSON.stringify(input.config), createdAt: nowSec(), updatedAt: nowSec() })
    .returning().get()
}

export function updateMonitor(db: DrizzleDb, id: number, input: MonitorInput): MonitorRow | null {
  const rows = db.update(monitor)
    .set({ ...input, config: JSON.stringify(input.config), updatedAt: nowSec() })
    .where(eq(monitor.id, id)).returning().all()
  return rows[0] ?? null
}

export function deleteMonitor(db: DrizzleDb, id: number): void {
  db.delete(monitor).where(eq(monitor.id, id)).run()
}

export function getMonitor(db: DrizzleDb, id: number): MonitorRow | null {
  return db.select().from(monitor).where(eq(monitor.id, id)).get() ?? null
}

export function listMonitors(db: DrizzleDb): MonitorRow[] {
  return db.select().from(monitor)
    .leftJoin(monitorGroup, eq(monitor.groupId, monitorGroup.id))
    .orderBy(asc(monitorGroup.sortOrder), asc(monitor.sortOrder), asc(monitor.id))
    .all().map((r) => r.monitor)
}

export function reorderMonitors(db: DrizzleDb, ids: number[]): void {
  ids.forEach((id, i) => db.update(monitor).set({ sortOrder: i }).where(eq(monitor.id, id)).run())
}

export function toRuntimeConfig(row: MonitorRow): MonitorRuntimeConfig {
  return {
    id: row.id, type: row.type as MonitorRuntimeConfig['type'], target: row.target, port: row.port,
    intervalS: row.intervalS, retryIntervalS: row.retryIntervalS, maxRetries: row.maxRetries,
    timeoutMs: row.timeoutMs, config: JSON.parse(row.config) as Record<string, unknown>,
  }
}
```

- [ ] **Step 3: 类型检查 + 手工冒烟（bun REPL 级验证）**

Run: `cd server && bunx tsc --noEmit`
Expected: 无错误。

Run: `cd server && bun -e "import('./src/store/monitors').then(m => console.log(m.validateMonitor({ groupId: null, name: 'x', type: 'tcp', target: 'h', port: null, intervalS: 60, retryIntervalS: 20, maxRetries: 3, timeoutMs: 10000, active: 1, sortOrder: 0, config: {} })))"`
Expected: 输出 `["tcp monitor requires port between 1 and 65535"]`。

Run: `cd server && bun -e "import('./src/store/monitors').then(m => console.log(m.validateMonitor({ groupId: null, name: 'x', type: 'http', target: 'https://a.com', port: null, intervalS: 60, retryIntervalS: 20, maxRetries: 3, timeoutMs: 30000, active: 1, sortOrder: 0, config: {} })))"`
Expected: 输出包含 timeout 错误的数组。

- [ ] **Step 4: Commit**

```bash
git add server/src/store/settings.ts server/src/store/monitors.ts
git commit -m "feat(store): settings and monitors stores with validation"
```

---

### Task 3: store/slots.ts + store/attempts.ts + store/daily.ts

**Files:**
- Create: `server/src/store/slots.ts`
- Create: `server/src/store/attempts.ts`
- Create: `server/src/store/daily.ts`

**Interfaces:**
- slots：
  - `insertSlot(db, row: { monitorId, startedAt, intervalS, status, attempts, recoveredAfterS, latencyMs, error, certDaysLeft }): void`
  - `insertAttempts(db, monitorId, slotStartedAt, rows: AttemptRow[]): void`（`AttemptRow` 来自 slot-runner）
  - `slotsInRange(db, monitorId, fromSec, toSec): SlotRow[]`（`startedAt >= fromSec and < toSec`，按 startedAt 升序）
  - `lastNonNodataSlotBefore(db, monitorId, beforeSec): SlotRow | null`（`startedAt < beforeSec` 的最近一行；slot 表本身不存 nodata 行，任何存在行即非 nodata）
  - `SlotRow` = `typeof slot.$inferSelect`
- attempts：
  - `attemptsInRange(db, monitorId, fromSec, toSec): AttemptDbRow[]`（按 `slotStartedAt` 过滤）
- daily：
  - `DailyRow` = `typeof slotDaily.$inferSelect`
  - `upsertDaily(db, row: Omit<DailyRow, never>): void`（按 `(monitor_id, day)` upsert，幂等）
  - `dailyInRange(db, monitorId, fromDay: string, toDay: string): DailyRow[]`（`day >= fromDay and <= toDay`，字典序比较，升序）
  - `deleteDailyBefore(db, day: string): void`（保留策略不用删 daily，但时区重建场景保留该接口：`deleteDailyForMonitors(db, monitorIds, fromDay, toDay)` 用于重建前清理）

- [ ] **Step 1: 实现 slots.ts**

```ts
import { and, asc, desc, eq, gte, lt } from 'drizzle-orm'
import { slot, attempt } from '../db/schema'
import type { DrizzleDb } from '../db/client'
import type { AttemptRow } from '../scheduler/slot-runner'

export type SlotRow = typeof slot.$inferSelect

export function insertSlot(db: DrizzleDb, row: typeof slot.$inferInsert): void {
  db.insert(slot).values(row).onConflictDoNothing().run()
}

export function insertAttempts(db: DrizzleDb, monitorId: number, slotStartedAt: number, rows: AttemptRow[]): void {
  if (rows.length === 0) return
  db.insert(attempt).values(rows.map((r) => ({ monitorId, slotStartedAt, seq: r.seq, ok: r.ok ? 1 : 0, latencyMs: r.latencyMs, error: r.error, at: r.at }))).run()
}

export function slotsInRange(db: DrizzleDb, monitorId: number, fromSec: number, toSec: number): SlotRow[] {
  return db.select().from(slot)
    .where(and(eq(slot.monitorId, monitorId), gte(slot.startedAt, fromSec), lt(slot.startedAt, toSec)))
    .orderBy(asc(slot.startedAt)).all()
}

export function lastNonNodataSlotBefore(db: DrizzleDb, monitorId: number, beforeSec: number): SlotRow | null {
  return db.select().from(slot)
    .where(and(eq(slot.monitorId, monitorId), lt(slot.startedAt, beforeSec)))
    .orderBy(desc(slot.startedAt)).get() ?? null
}

export function latestSlot(db: DrizzleDb, monitorId: number): SlotRow | null {
  return db.select().from(slot).where(eq(slot.monitorId, monitorId)).orderBy(desc(slot.startedAt)).get() ?? null
}
```

- [ ] **Step 2: 实现 attempts.ts**

```ts
import { and, asc, eq, gte, lt } from 'drizzle-orm'
import { attempt } from '../db/schema'
import type { DrizzleDb } from '../db/client'

export type AttemptDbRow = typeof attempt.$inferSelect

export function attemptsInRange(db: DrizzleDb, monitorId: number, fromSec: number, toSec: number): AttemptDbRow[] {
  return db.select().from(attempt)
    .where(and(eq(attempt.monitorId, monitorId), gte(attempt.slotStartedAt, fromSec), lt(attempt.slotStartedAt, toSec)))
    .orderBy(asc(attempt.slotStartedAt), asc(attempt.seq)).all()
}
```

- [ ] **Step 3: 实现 daily.ts**

```ts
import { and, asc, eq, gte, lte } from 'drizzle-orm'
import { slotDaily } from '../db/schema'
import type { DrizzleDb } from '../db/client'

export type DailyRow = typeof slotDaily.$inferSelect

export function upsertDaily(db: DrizzleDb, row: typeof slotDaily.$inferInsert): void {
  db.insert(slotDaily).values(row)
    .onConflictDoUpdate({
      target: [slotDaily.monitorId, slotDaily.day],
      set: { up: row.up, flaky: row.flaky, down: row.down, nodata: row.nodata, downSeconds: row.downSeconds, latencyP50: row.latencyP50, latencyP95: row.latencyP95 },
    }).run()
}

export function dailyInRange(db: DrizzleDb, monitorId: number, fromDay: string, toDay: string): DailyRow[] {
  return db.select().from(slotDaily)
    .where(and(eq(slotDaily.monitorId, monitorId), gte(slotDaily.day, fromDay), lte(slotDaily.day, toDay)))
    .orderBy(asc(slotDaily.day)).all()
}

export function deleteDailyRange(db: DrizzleDb, monitorId: number, fromDay: string, toDay: string): void {
  db.delete(slotDaily)
    .where(and(eq(slotDaily.monitorId, monitorId), gte(slotDaily.day, fromDay), lte(slotDaily.day, toDay))).run()
}
```

- [ ] **Step 4: 类型检查 + Commit**

```bash
cd server && bunx tsc --noEmit
cd /Users/flintylemming/Projects/uptime
git add server/src/store/slots.ts server/src/store/attempts.ts server/src/store/daily.ts
git commit -m "feat(store): slots, attempts and daily stores"
```

---

### Task 4: store/webhooks.ts

**Files:**
- Create: `server/src/store/webhooks.ts`

**Interfaces:**
- Produces:
  - `WebhookRow`（含 `monitors: number[]` 的视图类型 `WebhookWithMonitors`）
  - `createWebhook(db, input): WebhookRow`、`updateWebhook(db, id, input): WebhookRow | null`、`deleteWebhook(db, id)`、`listWebhooks(db): WebhookWithMonitors[]`、`getWebhook(db, id)`
  - `monitorsForWebhook(db, webhookId): number[]`（关联表为空 = 全部监控项，返回 `[]` 表示“全部”）
  - `validateWebhook(input): string[]`：name/url 必填；url 合法；method ∈ {GET,POST,PUT}；body_template 非空。
  - input 类型：`{ name, url, method, headers: Record<string,string>, bodyTemplate, enabled, monitorIds: number[] | null }`（`null` = 全部监控项）。

- [ ] **Step 1: 实现**

```ts
import { eq } from 'drizzle-orm'
import { webhook, webhookMonitor } from '../db/schema'
import type { DrizzleDb } from '../db/client'

export type WebhookRow = typeof webhook.$inferSelect
export interface WebhookWithMonitors extends WebhookRow { monitorIds: number[] }

export interface WebhookInput {
  name: string; url: string; method: string
  headers: Record<string, string>; bodyTemplate: string; enabled: number
  monitorIds: number[] | null                      // null = 全部监控项
}

export function validateWebhook(input: WebhookInput): string[] {
  const errors: string[] = []
  if (!input.name?.trim()) errors.push('name is required')
  try { new URL(input.url) } catch { errors.push('url must be a valid URL') }
  if (!['GET', 'POST', 'PUT'].includes(input.method)) errors.push('method must be GET, POST or PUT')
  if (!input.bodyTemplate?.trim()) errors.push('body_template is required')
  return errors
}

function syncMonitors(db: DrizzleDb, webhookId: number, monitorIds: number[] | null): void {
  db.delete(webhookMonitor).where(eq(webhookMonitor.webhookId, webhookId)).run()
  if (monitorIds && monitorIds.length > 0) {
    db.insert(webhookMonitor).values(monitorIds.map((monitorId) => ({ webhookId, monitorId }))).run()
  }
}

export function createWebhook(db: DrizzleDb, input: WebhookInput): WebhookRow {
  const row = db.insert(webhook).values({
    name: input.name, url: input.url, method: input.method,
    headers: JSON.stringify(input.headers), bodyTemplate: input.bodyTemplate, enabled: input.enabled,
  }).returning().get()
  syncMonitors(db, row.id, input.monitorIds)
  return row
}

export function updateWebhook(db: DrizzleDb, id: number, input: WebhookInput): WebhookRow | null {
  const rows = db.update(webhook).set({
    name: input.name, url: input.url, method: input.method,
    headers: JSON.stringify(input.headers), bodyTemplate: input.bodyTemplate, enabled: input.enabled,
  }).where(eq(webhook.id, id)).returning().all()
  const row = rows[0]
  if (row) syncMonitors(db, id, input.monitorIds)
  return row ?? null
}

export function deleteWebhook(db: DrizzleDb, id: number): void {
  db.delete(webhook).where(eq(webhook.id, id)).run()
}

export function getWebhook(db: DrizzleDb, id: number): WebhookRow | null {
  return db.select().from(webhook).where(eq(webhook.id, id)).get() ?? null
}

export function listWebhooks(db: DrizzleDb): WebhookWithMonitors[] {
  return db.select().from(webhook).all().map((row) => ({
    ...row,
    monitorIds: db.select().from(webhookMonitor).where(eq(webhookMonitor.webhookId, row.id)).all().map((r) => r.monitorId),
  }))
}

/** 关联表为空表示“全部监控项” */
export function monitorsForWebhook(db: DrizzleDb, webhookId: number): number[] {
  return db.select().from(webhookMonitor).where(eq(webhookMonitor.webhookId, webhookId)).all().map((r) => r.monitorId)
}
```

- [ ] **Step 2: 类型检查 + Commit**

```bash
cd server && bunx tsc --noEmit
cd /Users/flintylemming/Projects/uptime
git add server/src/store/webhooks.ts
git commit -m "feat(store): webhooks store with monitor associations"
```

---

### Task 5: notify/transitions.ts

**Files:**
- Create: `server/src/notify/transitions.ts`
- Create: `server/src/notify/transitions.test.ts`

**Interfaces:**
- Produces: `type AlertEvent = 'down' | 'recovered'`；`transitionEvent(prev: SlotStatus | null, cur: SlotStatus): AlertEvent | null`。`prev` 是**上一个非 nodata slot** 的状态（slot 表不存 nodata 行，查询侧保证）；`null` 表示历史里没有任何非 nodata slot。规则（设计文档 §6.1）：prev 非 down 且 cur=down → `down`；prev 是 down 且 cur 是 up/flaky → `recovered`；flaky 进出都不触发；prev=null 且 cur=down → 触发 `down`（第一次见到就是 down 也要告警）；prev=null 且 cur≠down → null。

- [ ] **Step 1: 写失败测试（设计文档 §11 transitions 全部用例）**

`server/src/notify/transitions.test.ts`:

```ts
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
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd server && bun test src/notify/transitions.test.ts`
Expected: FAIL（`Cannot find module './transitions'`）。

- [ ] **Step 3: 实现 transitions.ts**

```ts
import type { SlotStatus } from '../scheduler/slot-runner'

export type AlertEvent = 'down' | 'recovered'

/**
 * 设计文档 §6.1：prev 是上一个非 nodata slot 的状态（null = 之前没有）。
 * 只有真正的状态转换才产出事件；flaky 永远静默。
 */
export function transitionEvent(prev: SlotStatus | null, cur: SlotStatus): AlertEvent | null {
  const prevDown = prev === 2
  const curDown = cur === 2
  if (!prevDown && curDown) return 'down'
  if (prevDown && !curDown) return 'recovered'
  return null
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd server && bun test src/notify/transitions.test.ts`
Expected: 8 pass。

- [ ] **Step 5: Commit**

```bash
git add server/src/notify/transitions.ts server/src/notify/transitions.test.ts
git commit -m "feat(notify): pure transition detection for down/recovered events"
```

---

### Task 6: notify/template.ts

**Files:**
- Create: `server/src/notify/template.ts`
- Create: `server/src/notify/template.test.ts`

**Interfaces:**
- Produces:
  - `type TemplateVars = { event: string; monitor_name: string; monitor_type: string; target: string; group_name: string; status: string; error: string; attempts: string; slot_started_at: string; down_duration_s: string; url: string }`
  - `renderTemplate(template: string, vars: TemplateVars): string`：替换 `{{var}}`；插入值做 **JSON 字符串转义**（即 `JSON.stringify(value).slice(1, -1)`，处理引号/换行/反斜杠）；未知占位符原样保留。
  - `formatSlotTime(unixSec: number, timezone: string): string`：ISO8601 带时区偏移，例如 `2026-08-11T12:30:00+08:00`。

- [ ] **Step 1: 写失败测试**

`server/src/notify/template.test.ts`:

```ts
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
  const sec = 1786560600                           // 2026-08-11T04:30:00Z
  expect(formatSlotTime(sec, 'Asia/Shanghai')).toBe('2026-08-11T12:30:00+08:00')
  expect(formatSlotTime(sec, 'UTC')).toBe('2026-08-11T04:30:00+00:00')
})
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd server && bun test src/notify/template.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 template.ts**

```ts
export interface TemplateVars {
  event: string
  monitor_name: string
  monitor_type: string
  target: string
  group_name: string
  status: string
  error: string
  attempts: string
  slot_started_at: string
  down_duration_s: string
  url: string
}

/** JSON 字符串内部转义：转义引号/反斜杠/控制字符，去掉 JSON.stringify 的首尾引号 */
function jsonEscape(value: string): string {
  return JSON.stringify(value).slice(1, -1)
}

export function renderTemplate(template: string, vars: TemplateVars): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    if (key in vars) return jsonEscape(vars[key as keyof TemplateVars])
    return match
  })
}

/** unix 秒 → 指定时区的 ISO8601（带偏移） */
export function formatSlotTime(unixSec: number, timezone: string): string {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZoneName: 'longOffset',
  })
  const parts = Object.fromEntries(dtf.formatToParts(new Date(unixSec * 1000)).map((p) => [p.type, p.value]))
  const offset = (parts.timeZoneName ?? 'GMT+00:00').replace('GMT', '') || '+00:00'
  const off = offset === '' ? '+00:00' : offset
  // en-US hour12:false 在午夜可能给出 '24'，规范化
  const hour = parts.hour === '24' ? '00' : parts.hour
  return `${parts.year}-${parts.month}-${parts.day}T${hour}:${parts.minute}:${parts.second}${off}`
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd server && bun test src/notify/template.test.ts`
Expected: 4 pass。若 `formatSlotTime` 因 ICU 差异失败，检查 `timeZoneName: 'longOffset'` 输出并微调解析（保持测试断言不变，它是设计文档要求的格式）。

- [ ] **Step 5: Commit**

```bash
git add server/src/notify/template.ts server/src/notify/template.test.ts
git commit -m "feat(notify): webhook template rendering with json escaping"
```

---

### Task 7: notify/dispatcher.ts

**Files:**
- Create: `server/src/notify/dispatcher.ts`
- Create: `server/src/notify/dispatcher.test.ts`

**Interfaces:**
- Produces:
  - `interface DispatchOptions { fetchImpl?: typeof fetch; sleepImpl?: (ms: number) => Promise<void>; timeoutMs?: number; retries?: number; backoffMs?: number[] }`（全部可注入，生产默认 10s/3 次/[1000,4000,16000]）
  - `dispatchWebhook(o: { method, url, headers: Record<string,string>, body }, opts?: DispatchOptions): Promise<{ ok: boolean; attempts: number }>`
  - 2xx 即成功；失败/异常按退避重试；重试用尽返回 `{ok:false}`，绝不抛异常。

- [ ] **Step 1: 写失败测试**

`server/src/notify/dispatcher.test.ts`:

```ts
import { expect, test } from 'bun:test'
import { dispatchWebhook } from './dispatcher'

test('succeeds on first 2xx', async () => {
  const calls: RequestInit[] = []
  const fetchImpl = (async (_url: string, init?: RequestInit) => { calls.push(init ?? {}); return new Response('ok', { status: 200 }) }) as typeof fetch
  const r = await dispatchWebhook({ method: 'POST', url: 'http://x', headers: { 'X-A': '1' }, body: '{}' }, { fetchImpl })
  expect(r.ok).toBe(true)
  expect(r.attempts).toBe(1)
  expect(calls[0]!.headers).toEqual({ 'X-A': '1' })
  expect(calls[0]!.body).toBe('{}')
})

test('retries with backoff and eventually succeeds', async () => {
  let n = 0
  const sleeps: number[] = []
  const fetchImpl = (async () => { n++; return new Response('', { status: n < 3 ? 500 : 204 }) }) as typeof fetch
  const r = await dispatchWebhook({ method: 'POST', url: 'http://x', headers: {}, body: '' },
    { fetchImpl, sleepImpl: async (ms) => { sleeps.push(ms) } })
  expect(r.ok).toBe(true)
  expect(r.attempts).toBe(3)
  expect(sleeps).toEqual([1000, 4000])
})

test('gives up after 3 retries without throwing', async () => {
  const fetchImpl = (async () => new Response('', { status: 500 })) as typeof fetch
  const r = await dispatchWebhook({ method: 'POST', url: 'http://x', headers: {}, body: '' },
    { fetchImpl, sleepImpl: async () => {} })
  expect(r.ok).toBe(false)
  expect(r.attempts).toBe(4)                       // 首发 + 3 次重试
})

test('network exception is treated as failure', async () => {
  const fetchImpl = (async () => { throw new Error('ECONNREFUSED') }) as typeof fetch
  const r = await dispatchWebhook({ method: 'POST', url: 'http://x', headers: {}, body: '' },
    { fetchImpl, sleepImpl: async () => {} })
  expect(r.ok).toBe(false)
  expect(r.attempts).toBe(4)
})
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd server && bun test src/notify/dispatcher.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 dispatcher.ts**

```ts
export interface DispatchOptions {
  fetchImpl?: typeof fetch
  sleepImpl?: (ms: number) => Promise<void>
  timeoutMs?: number
  retries?: number
  backoffMs?: number[]
}

const DEFAULTS = { timeoutMs: 10_000, retries: 3, backoffMs: [1_000, 4_000, 16_000] }

export async function dispatchWebhook(
  o: { method: string; url: string; headers: Record<string, string>; body: string },
  opts: DispatchOptions = {},
): Promise<{ ok: boolean; attempts: number }> {
  const doFetch = opts.fetchImpl ?? fetch
  const sleep = opts.sleepImpl ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  const timeoutMs = opts.timeoutMs ?? DEFAULTS.timeoutMs
  const retries = opts.retries ?? DEFAULTS.retries
  const backoff = opts.backoffMs ?? DEFAULTS.backoffMs

  let attempts = 0
  for (let i = 0; i <= retries; i++) {
    attempts++
    try {
      const res = await doFetch(o.url, { method: o.method, headers: o.headers, body: o.body, signal: AbortSignal.timeout(timeoutMs) })
      if (res.status >= 200 && res.status < 300) return { ok: true, attempts }
    } catch { /* 网络异常按失败重试 */ }
    if (i < retries) await sleep(backoff[Math.min(i, backoff.length - 1)]!)
  }
  console.error(`webhook dispatch failed after ${attempts} attempts: ${o.url}`)
  return { ok: false, attempts }
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd server && bun test src/notify/dispatcher.test.ts`
Expected: 4 pass。

- [ ] **Step 5: Commit**

```bash
git add server/src/notify/dispatcher.ts server/src/notify/dispatcher.test.ts
git commit -m "feat(notify): webhook dispatcher with timeout and backoff retries"
```

---

### Task 8: rollup/daily.ts（slot → slot_daily）

**Files:**
- Create: `server/src/rollup/daily.ts`
- Create: `server/src/rollup/daily.test.ts`

**Interfaces:**
- Consumes: `store/slots.ts`、`store/daily.ts`、`store/settings.ts`。
- Produces:
  - `dayOfSlot(startedAtSec: number, intervalSec: number, timezone: string): string` — slot 归属的展示时区日期 `YYYY-MM-DD`。slot 跨天时归属 **slot 起点** 所在日。
  - `rollupDaily(db, fromSec: number, toSec: number, timezone: string): void` — 把 `[fromSec, toSec)` 内的 slot 按 `(monitorId, day)` 聚合 upsert 到 `slot_daily`。`nodata` 计数 = 该监控项该日期望 slot 数 − 实际行数（期望数 = `floor(interval_s 对齐)`，实现上：对该天用「该监控项当天 slot 表中的 `interval_s` 众数」算期望 slot 数，最少为 0；算不出时为 0，nodata=0）。`down_seconds = Σ(down 行数 × 该行 interval_s)`。`latency_p50/p95` 从成功 slot（latency_ms 非空）中取百分位（线性取整法：`sorted[Math.ceil(p*n)-1]`）。
  - `rebuildDaily(db, monitorIds: number[], fromSec: number, toSec: number, timezone: string): void` — 先 `deleteDailyRange` 再 `rollupDaily`（时区切换用）。

- [ ] **Step 1: 写失败测试**

`server/src/rollup/daily.test.ts`:

```ts
import { expect, test } from 'bun:test'
import { openDb } from '../db/client'
import { runMigrations, seedSettings } from '../db/migrate'
import { monitor } from '../db/schema'
import { insertSlot } from '../store/slots'
import { dailyInRange } from '../store/daily'
import { rollupDaily, rebuildDaily, dayOfSlot } from './daily'

function setup() {
  const { db, sql } = openDb(':memory:')
  runMigrations(db, sql)
  seedSettings(db)
  const now = Math.floor(Date.now() / 1000)
  const mId = db.insert(monitor).values({ name: 'm', type: 'http', target: 'https://a.com', createdAt: now, updatedAt: now })
    .returning({ id: monitor.id }).get().id
  return { db, sql, mId }
}

// UTC 2026-01-02 00:00:00 = 1767312000
const DAY = 86400
const BASE = 1767312000

test('dayOfSlot uses timezone of slot start', () => {
  expect(dayOfSlot(BASE, 60, 'UTC')).toBe('2026-01-02')
  expect(dayOfSlot(BASE, 60, 'Asia/Shanghai')).toBe('2026-01-02')   // 08:00 CST
  expect(dayOfSlot(BASE - 8 * 3600, 60, 'Asia/Shanghai')).toBe('2026-01-02') // UTC 16:00 = CST 00:00
  expect(dayOfSlot(BASE - 8 * 3600 - 60, 60, 'Asia/Shanghai')).toBe('2026-01-01')
})

test('rollup aggregates counts, down_seconds and nodata', () => {
  const { db, sql, mId } = setup()
  // 4 个 60s slot：up, flaky, down, 缺失(=nodata)；interval 60 → 一天应有 1440 个，nodata = 1440-3
  insertSlot(db, { monitorId: mId, startedAt: BASE, intervalS: 60, status: 0, attempts: 1, recoveredAfterS: null, latencyMs: 10, error: null, certDaysLeft: null })
  insertSlot(db, { monitorId: mId, startedAt: BASE + 60, intervalS: 60, status: 1, attempts: 2, recoveredAfterS: 30, latencyMs: 15, error: null, certDaysLeft: null })
  insertSlot(db, { monitorId: mId, startedAt: BASE + 180, intervalS: 60, status: 2, attempts: 4, recoveredAfterS: null, latencyMs: null, error: 'boom', certDaysLeft: null })
  rollupDaily(db, BASE, BASE + DAY, 'UTC')
  const rows = dailyInRange(db, mId, '2026-01-02', '2026-01-02')
  expect(rows.length).toBe(1)
  const r = rows[0]!
  expect(r.up).toBe(1)
  expect(r.flaky).toBe(1)
  expect(r.down).toBe(1)
  expect(r.nodata).toBe(1440 - 3)
  expect(r.downSeconds).toBe(60)
})

test('nodata does not enter uptime denominator (denominator uses up+flaky+down only)', () => {
  const { db, sql, mId } = setup()
  insertSlot(db, { monitorId: mId, startedAt: BASE, intervalS: 60, status: 0, attempts: 1, recoveredAfterS: null, latencyMs: 10, error: null, certDaysLeft: null })
  insertSlot(db, { monitorId: mId, startedAt: BASE + 60, intervalS: 60, status: 2, attempts: 4, recoveredAfterS: null, latencyMs: null, error: 'e', certDaysLeft: null })
  rollupDaily(db, BASE, BASE + DAY, 'UTC')
  const r = dailyInRange(db, mId, '2026-01-02', '2026-01-02')[0]!
  const denom = r.up + r.flaky + r.down
  expect(denom).toBe(2)                            // nodata 不在分母
  expect((r.up + r.flaky) / denom).toBe(0.5)
})

test('rollup is idempotent (rerun produces identical rows)', () => {
  const { db, sql, mId } = setup()
  insertSlot(db, { monitorId: mId, startedAt: BASE, intervalS: 60, status: 0, attempts: 1, recoveredAfterS: null, latencyMs: 10, error: null, certDaysLeft: null })
  rollupDaily(db, BASE, BASE + DAY, 'UTC')
  rollupDaily(db, BASE, BASE + DAY, 'UTC')
  const rows = dailyInRange(db, mId, '2026-01-02', '2026-01-02')
  expect(rows.length).toBe(1)
  expect(rows[0]!.up).toBe(1)
})

test('latency p50/p95 from successful slots', () => {
  const { db, sql, mId } = setup()
  for (let i = 0; i < 100; i++) {
    insertSlot(db, { monitorId: mId, startedAt: BASE + i * 60, intervalS: 60, status: 0, attempts: 1, recoveredAfterS: null, latencyMs: (i + 1) * 10, error: null, certDaysLeft: null })
  }
  rollupDaily(db, BASE, BASE + DAY, 'UTC')
  const r = dailyInRange(db, mId, '2026-01-02', '2026-01-02')[0]!
  expect(r.latencyP50).toBe(500)                   // ceil(0.5*100)=50 → sorted[49]=500
  expect(r.latencyP95).toBe(950)
})

test('cross-timezone day cut: same slots roll up to different days', () => {
  const { db, sql, mId } = setup()
  insertSlot(db, { monitorId: mId, startedAt: BASE - 3600, intervalS: 60, status: 0, attempts: 1, recoveredAfterS: null, latencyMs: 5, error: null, certDaysLeft: null }) // UTC 2026-01-01 23:00
  rollupDaily(db, BASE - 7200, BASE + DAY, 'UTC')
  expect(dailyInRange(db, mId, '2026-01-01', '2026-01-01').length).toBe(1)
  rebuildDaily(db, [mId], BASE - 7200, BASE + DAY, 'Asia/Shanghai')
  expect(dailyInRange(db, mId, '2026-01-01', '2026-01-01').length).toBe(0)
  expect(dailyInRange(db, mId, '2026-01-02', '2026-01-02').length).toBe(1) // CST 07:00 → 1-02
})
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd server && bun test src/rollup/daily.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 daily.ts**

`server/src/rollup/daily.ts`:

```ts
import { and, asc, gte, lt } from 'drizzle-orm'
import { slot } from '../db/schema'
import type { DrizzleDb } from '../db/client'
import { upsertDaily, deleteDailyRange } from '../store/daily'

export function dayOfSlot(startedAtSec: number, _intervalSec: number, timezone: string): string {
  const dtf = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
  return dtf.format(new Date(startedAtSec * 1000))   // en-CA 输出 YYYY-MM-DD
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null
  const idx = Math.max(0, Math.ceil(p * sorted.length) - 1)
  return sorted[Math.min(idx, sorted.length - 1)]!
}

/**
 * 把 [fromSec, toSec) 内的 slot 按 (monitorId, day) 聚合 upsert 到 slot_daily。幂等。
 */
export function rollupDaily(db: DrizzleDb, fromSec: number, toSec: number, timezone: string): void {
  const rows = db.select().from(slot).where(and(gte(slot.startedAt, fromSec), lt(slot.startedAt, toSec))).orderBy(asc(slot.monitorId), asc(slot.startedAt)).all()
  const byMonitorDay = new Map<string, { monitorId: number; day: string; up: number; flaky: number; down: number; rows: typeof rows }>()
  for (const r of rows) {
    const day = dayOfSlot(r.startedAt, r.intervalS, timezone)
    const key = `${r.monitorId}:${day}`
    let agg = byMonitorDay.get(key)
    if (!agg) { agg = { monitorId: r.monitorId, day, up: 0, flaky: 0, down: 0, rows: [] }; byMonitorDay.set(key, agg) }
    if (r.status === 0) agg.up++
    else if (r.status === 1) agg.flaky++
    else agg.down++
    agg.rows.push(r)
  }
  for (const agg of byMonitorDay.values()) {
    const intervalS = agg.rows[0]!.intervalS       // 同一天内 interval 一般一致；取首行
    const expectedPerDay = Math.floor(86400 / intervalS)
    const actual = agg.up + agg.flaky + agg.down
    const nodata = Math.max(0, expectedPerDay - actual)
    const downSeconds = agg.rows.filter((r) => r.status === 2).reduce((s, r) => s + r.intervalS, 0)
    const latencies = agg.rows.filter((r) => r.latencyMs !== null).map((r) => r.latencyMs!).sort((a, b) => a - b)
    upsertDaily(db, {
      monitorId: agg.monitorId, day: agg.day,
      up: agg.up, flaky: agg.flaky, down: agg.down, nodata, downSeconds,
      latencyP50: percentile(latencies, 0.5), latencyP95: percentile(latencies, 0.95),
    })
  }
}

/** 时区变更后的全量重建：删掉窗口内日桶再重算 */
export function rebuildDaily(db: DrizzleDb, monitorIds: number[], fromSec: number, toSec: number, timezone: string): void {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
  const fromDay = fmt.format(new Date(fromSec * 1000))
  const toDay = fmt.format(new Date((toSec - 1) * 1000))
  for (const id of monitorIds) deleteDailyRange(db, id, fromDay, toDay)
  rollupDaily(db, fromSec, toSec, timezone)
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd server && bun test src/rollup/daily.test.ts`
Expected: 6 pass。

- [ ] **Step 5: Commit**

```bash
git add server/src/rollup/daily.ts server/src/rollup/daily.test.ts
git commit -m "feat(rollup): slot to slot_daily aggregation with timezone day cut"
```

---

### Task 9: rollup/retention.ts

**Files:**
- Create: `server/src/rollup/retention.ts`

**Interfaces:**
- Consumes: `store/settings.ts`（`getSettings`）、`openDb` 返回的 `sql: Database`。
- Produces: `runRetention(db, sql, nowSec): { deletedSlots: number; deletedAttempts: number }` — 删除 `attempt.at < nowSec - attempt_retention_days*86400`、`slot.started_at < nowSec - slot_retention_days*86400`；然后 `sql.exec('PRAGMA incremental_vacuum')`。

- [ ] **Step 1: 实现**

```ts
import { lt } from 'drizzle-orm'
import { attempt, slot } from '../db/schema'
import type { DrizzleDb } from '../db/client'
import type { Database } from 'bun:sqlite'
import { getSettings } from '../store/settings'

export function runRetention(db: DrizzleDb, sql: Database, nowSec: number): { deletedSlots: number; deletedAttempts: number } {
  const s = getSettings(db)
  const slotCutoff = nowSec - s.slot_retention_days * 86400
  const attemptCutoff = nowSec - s.attempt_retention_days * 86400
  const deletedSlots = db.delete(slot).where(lt(slot.startedAt, slotCutoff)).returning({ id: slot.monitorId }).all().length
  const deletedAttempts = db.delete(attempt).where(lt(attempt.at, attemptCutoff)).returning({ id: attempt.id }).all().length
  try { sql.exec('PRAGMA incremental_vacuum') } catch { /* 非 auto_vacuum=incremental 时忽略 */ }
  return { deletedSlots, deletedAttempts }
}
```

- [ ] **Step 2: 冒烟验证 + Commit**

Run: `cd server && bunx tsc --noEmit && bun test`
Expected: tsc 无错误；全部测试仍绿。

```bash
git add server/src/rollup/retention.ts
git commit -m "feat(rollup): retention cleanup for slot and attempt tables"
```

---

### Task 10: scheduler/scheduler.ts — tick 循环与并发池

**Files:**
- Create: `server/src/scheduler/scheduler.ts`
- Create: `server/src/scheduler/scheduler.test.ts`

**Interfaces:**
- Produces:
  - `interface SchedulerDeps { db: DrizzleDb; sql: Database; getNow: () => number; setIntervalMs?: number; probeConcurrency?: number; probeFactory?: (type: ProbeType) => Probe; dispatchImpl?: typeof dispatchWebhook; baseUrl?: string }`
  - `startScheduler(deps): { stop(): void; running(): number }`
  - 行为（设计文档 §3.7）：每 `setIntervalMs`（默认 1000ms）醒一次；对每个 active 监控项检查 `now` 是否到达边界（`nowSec >= nextDue[monitorId]`）；到边界的投入容量为 `probeConcurrency` 的队列；每个 slot 任务带独立 `AbortController`，下个边界到达时 abort；完成后写 `slot` + `attempt` 行、调用 `transitionEvent` 决定是否通知；写库失败只记日志。监控项配置每次边界重新从 DB 读（支持热更新 interval/启停）。

- [ ] **Step 1: 写失败测试**

`scheduler.test.ts` 用真实内存 DB + 假探测器 + 短 tick（10ms）+ 小 interval（无法真的用 10s 最小值——scheduler 内部不做 interval 校验，那是 API 层的职责，测试直接用 1s）：

`server/src/scheduler/scheduler.test.ts`:

```ts
import { expect, test } from 'bun:test'
import { openDb } from '../db/client'
import { runMigrations, seedSettings } from '../db/migrate'
import { monitor, slot } from '../db/schema'
import { count, eq } from 'drizzle-orm'
import { startScheduler } from './scheduler'
import type { Probe } from '../probes/types'

function setup(intervalS: number, probeResults: () => Probe) {
  const { db, sql } = openDb(':memory:')
  runMigrations(db, sql)
  seedSettings(db)
  const now = Math.floor(Date.now() / 1000)
  const mId = db.insert(monitor).values({
    name: 'm', type: 'http', target: 'https://a.com', intervalS,
    retryIntervalS: 1, maxRetries: 1, timeoutMs: 500, active: 1,
    createdAt: now, updatedAt: now,
  }).returning({ id: monitor.id }).get().id
  return { db, sql, mId }
}

const okProbe: Probe = { async run() { return { ok: true, latencyMs: 5, error: null, certDaysLeft: null } } }

test('scheduler writes exactly one slot row per boundary, probe called once for up', async () => {
  const { db, sql, mId } = setup(1, okProbe)
  const sched = startScheduler({ db, sql, getNow: () => Date.now() / 1000, setIntervalMs: 50, probeConcurrency: 5, probeFactory: () => okProbe })
  await Bun.sleep(2600)                            // 跨过至少 2 个边界
  sched.stop()
  const rows = db.select(count()).from(slot).where(eq(slot.monitorId, mId)).get()![0]
  expect(rows).toBeGreaterThanOrEqual(1)
  const latest = db.select().from(slot).orderBy(slot.startedAt).all()
  const starts = latest.map((r) => r.startedAt)
  expect(new Set(starts).size).toBe(starts.length) // 无重复边界
  for (const r of latest) expect(r.intervalS).toBe(1)
})

test('inactive monitor is not probed', async () => {
  const { db, sql, mId } = setup(1, okProbe)
  db.update(monitor).set({ active: 0 }).where(eq(monitor.id, mId)).run()
  const sched = startScheduler({ db, sql, getNow: () => Date.now() / 1000, setIntervalMs: 50, probeConcurrency: 5, probeFactory: () => okProbe })
  await Bun.sleep(1600)
  sched.stop()
  expect(db.select(count()).from(slot).get()![0]).toBe(0)
})

test('down transition fires dispatch exactly once', async () => {
  const failProbe: Probe = { async run() { return { ok: false, latencyMs: null, error: 'down', certDaysLeft: null } } }
  const { db, sql } = setup(1, failProbe)
  const dispatched: string[] = []
  const sched = startScheduler({
    db, sql, getNow: () => Date.now() / 1000, setIntervalMs: 50, probeConcurrency: 5,
    probeFactory: () => failProbe,
    dispatchImpl: async (o) => { dispatched.push(o.body); return { ok: true, attempts: 1 } },
  })
  await Bun.sleep(2600)                            // 至少 2 个 down slot
  sched.stop()
  expect(dispatched.length).toBe(1)                // 连续 down 只报第一次
  expect(dispatched[0]).toContain('"event":"down"')
})
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd server && bun test src/scheduler/scheduler.test.ts`
Expected: FAIL（`Cannot find module './scheduler'`）。

- [ ] **Step 3: 实现 scheduler.ts**

`server/src/scheduler/scheduler.ts`:

```ts
import { eq } from 'drizzle-orm'
import type { Database } from 'bun:sqlite'
import type { DrizzleDb } from '../db/client'
import { monitor } from '../db/schema'
import { getProbe, probeConfigFromMonitor, type Probe, type ProbeType } from '../probes'
import { runSlot, type MonitorRuntimeConfig } from './slot-runner'
import { nextSlotStart } from './clock'
import { insertSlot, insertAttempts, lastNonNodataSlotBefore } from '../store/slots'
import { listMonitors, toRuntimeConfig } from '../store/monitors'
import { getSettings } from '../store/settings'
import { monitorsForWebhook, listWebhooks, getWebhook } from '../store/webhooks'
import { transitionEvent } from '../notify/transitions'
import { renderTemplate, formatSlotTime, type TemplateVars } from '../notify/template'
import { dispatchWebhook } from '../notify/dispatcher'
import { monitorGroup } from '../db/schema'

export interface SchedulerDeps {
  db: DrizzleDb
  sql: Database
  getNow: () => number                             // unix 秒（浮点）
  setIntervalMs?: number
  probeConcurrency?: number
  probeFactory?: (type: ProbeType) => Probe
  dispatchImpl?: typeof dispatchWebhook
  baseUrl?: string
}

export function startScheduler(deps: SchedulerDeps) {
  const { db, getNow } = deps
  const tickMs = deps.setIntervalMs ?? 1000
  const concurrency = deps.probeConcurrency ?? Number(process.env.PROBE_CONCURRENCY ?? 20)
  const probeOf = deps.probeFactory ?? ((t: ProbeType) => getProbe(t))
  const dispatch = deps.dispatchImpl ?? dispatchWebhook
  const baseUrl = deps.baseUrl ?? 'http://localhost:3000'

  const nextDue = new Map<number, number>()        // monitorId → 下一个边界（unix 秒）
  const inFlight = new Map<number, AbortController>()
  let running = 0
  let stopped = false
  const queue: Array<() => Promise<void>> = []

  function pump() {
    while (running < concurrency && queue.length > 0) {
      running++
      const task = queue.shift()!
      task().finally(() => { running--; pump() })
    }
  }

  async function runMonitorSlot(cfg: MonitorRuntimeConfig, slotStartSec: number) {
    const ac = new AbortController()
    inFlight.set(cfg.id, ac)
    try {
      const result = await runSlot(cfg, {
        probe: probeOf(cfg.type),
        now: getNow,
        sleep: (ms, signal) => new Promise((resolve) => {
          const t = setTimeout(resolve, ms)
          const onAbort = () => { clearTimeout(t); resolve() }
          signal.addEventListener('abort', onAbort, { once: true })
        }),
      }, slotStartSec, ac.signal)

      try {
        insertSlot(db, {
          monitorId: cfg.id, startedAt: slotStartSec, intervalS: cfg.intervalS,
          status: result.status, attempts: result.attempts, recoveredAfterS: result.recoveredAfterS,
          latencyMs: result.latencyMs, error: result.error, certDaysLeft: result.certDaysLeft,
        })
        insertAttempts(db, cfg.id, slotStartSec, result.attemptRows)
      } catch (e) {
        console.error(`slot write failed for monitor ${cfg.id}:`, e)
        return                                     // 丢弃该 slot（呈现 nodata），不阻塞
      }

      // 告警判定：上一个非 nodata slot
      const prev = lastNonNodataSlotBefore(db, cfg.id, slotStartSec)
      const event = transitionEvent(prev ? (prev.status as 0 | 1 | 2) : null, result.status)
      if (event) void notify(event, cfg, slotStartSec, result.error, prev?.startedAt ?? null)
    } catch (e) {
      console.error(`slot task crashed for monitor ${cfg.id}:`, e)
    } finally {
      inFlight.delete(cfg.id)
    }
  }

  async function notify(event: 'down' | 'recovered', cfg: MonitorRuntimeConfig, slotStartSec: number, error: string | null, prevSlotStart: number | null) {
    try {
      const settings = getSettings(db)
      const mRow = db.select().from(monitor).where(eq(monitor.id, cfg.id)).get()
      const monitorName = mRow?.name ?? ''
      const groupName = mRow?.groupId
        ? db.select().from(monitorGroup).where(eq(monitorGroup.id, mRow.groupId)).get()?.name ?? ''
        : ''
      const downDurationS = event === 'recovered' && prevSlotStart !== null ? slotStartSec - prevSlotStart : null
      const webhooks = listWebhooks(db).filter((w) => w.enabled === 1)
      for (const w of webhooks) {
        const scoped = monitorsForWebhook(db, w.id)
        if (scoped.length > 0 && !scoped.includes(cfg.id)) continue
        const vars: TemplateVars = {
          event, monitor_name: monitorName,
          monitor_type: cfg.type, target: cfg.target, group_name: groupName,
          status: event === 'down' ? 'down' : 'recovered',
          error: error ?? '', attempts: '', slot_started_at: formatSlotTime(slotStartSec, settings.display_timezone),
          down_duration_s: downDurationS === null ? '' : String(downDurationS),
          url: `${baseUrl}/m/${cfg.id}`,
        }
        void dispatch({ method: w.method, url: w.url, headers: JSON.parse(w.headers), body: renderTemplate(w.bodyTemplate, vars) })
      }
    } catch (e) {
      console.error('notify failed:', e)
    }
  }

  const timer = setInterval(() => {
    try {
      if (stopped) return
      const nowSec = Math.floor(getNow())
      // 边界到达时 abort 上一轮仍未结束的任务
      for (const [id, ac] of inFlight) {
        const due = nextDue.get(id)
        if (due !== undefined && nowSec >= due) ac.abort()
      }
      const monitors = listMonitors(db).filter((m) => m.active === 1)
      for (const m of monitors) {
        const cfg = toRuntimeConfig(m)
        const due = nextDue.get(cfg.id)
        if (due === undefined) {
          nextDue.set(cfg.id, nextSlotStart(nowSec, cfg.intervalS))
          continue
        }
        if (nowSec >= due && !inFlight.has(cfg.id)) {
          const slotStartSec = due
          nextDue.set(cfg.id, due + cfg.intervalS)
          queue.push(() => runMonitorSlot(cfg, slotStartSec))
        }
      }
      pump()
    } catch (e) {
      console.error('scheduler tick error:', e)     // 顶层兜底，进程不退出
    }
  }, tickMs)

  return {
    stop() { stopped = true; clearInterval(timer); for (const ac of inFlight.values()) ac.abort() },
    running: () => running,
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd server && bun test src/scheduler/scheduler.test.ts`
Expected: 3 pass。若时序不稳定（慢机器），把测试里的 sleep 加到 3200ms，不要改实现逻辑。

- [ ] **Step 5: 全量回归 + 类型检查**

Run: `cd server && bun test && bunx tsc --noEmit`
Expected: 全绿。

- [ ] **Step 6: Commit**

```bash
git add server/src/scheduler/scheduler.ts server/src/scheduler/scheduler.test.ts
git commit -m "feat(scheduler): tick loop with bounded concurrency, slot persistence and alert dispatch"
```

---

## 计划 02 验收清单

- `cd server && bun test`：全绿（计划 01 的 39 + transitions 8 + template 4 + dispatcher 4 + daily 6 + scheduler 3 = 64）。
- `bunx tsc --noEmit` 无错误。
- `scheduler.ts` 是唯一 import `store/slots` 写入函数的调度相关文件（`grep -l "insertSlot" server/src -r` 只命中 store/slots.ts 与 scheduler.ts）。
- `web/mock/` 未被改动。
