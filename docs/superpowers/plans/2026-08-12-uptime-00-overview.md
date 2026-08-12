# uptime — 计划总览与文件结构

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 `docs/superpowers/specs/2026-08-11-uptime-design.md` 从零实现 uptime 自研版：slot 判定引擎、四种探测器、incident.io 风格状态页、管理后台、Webhook 告警、Docker 部署。

**Architecture:** 单 Bun 进程 = Hono HTTP 服务 + 每秒 tick 的调度器（共享 SQLite）。前端是 Vite + React SPA，由后端托管静态产物。UI 视觉以 `web/mock/Status.dc.html`（已解压的看板 mock）为唯一真值来源，逐值移植进 React + Tailwind。

**Tech Stack:** Bun 1.3+、Hono、SQLite(WAL) + Drizzle ORM、Vite + React 18 + TypeScript + Tailwind CSS v4、Recharts（延迟折线）、自绘 SVG（条形图）、bun:test / vitest。

## 子计划（严格按顺序执行）

| 文件 | 内容 | 完成标志 |
|---|---|---|
| `2026-08-12-uptime-01-core-engine.md` | 项目脚手架、DB schema/迁移、probes、clock、slot-runner | `bun test` 全绿（引擎核心测试） |
| `2026-08-12-uptime-02-runtime.md` | scheduler tick 循环、store 层、rollup/retention、notify | 运行时单测全绿，scheduler 可对假探测器跑通 |
| `2026-08-12-uptime-03-api.md` | 全部 HTTP API（auth/admin/status/timeseries）+ 集成测试 | API 集成测试全绿，curl 可打通 |
| `2026-08-12-uptime-04-frontend-status.md` | 前端脚手架 + 状态页 + 监控详情页（以 mock 为视觉真值） | `vitest` 全绿，状态页可交互 |
| `2026-08-12-uptime-05-frontend-admin.md` | 登录/首次设置 + 管理后台五个页面 | `vitest` 全绿，管理流程可交互 |
| `2026-08-12-uptime-06-deploy.md` | 静态托管、Dockerfile、compose、healthz、README、端到端验收 | `docker compose up` 后整站可用 |

每个子计划自带完整 header 与任务，可独立交给执行者；后续计划会声明自己消费前置计划的哪些接口。

## Global Constraints（所有任务隐式包含）

- 运行时 Bun ≥ 1.3；包管理用 `bun install`；测试后端用 `bun test`，前端用 `vitest`。
- 记号比例恒等于检查间隔：一个 slot 至多产出一行 `slot` 记录（设计文档 §3.3，回归测试必须覆盖）。
- slot 边界对齐 UTC epoch：`slot_start = floor(now_unix / interval_s) * interval_s`。
- 校验层强制 `timeout_ms < retry_interval_s * 1000`；表单实时显示「本间隔内实际最多重试 N 次，超出部分不会执行」。
- `uptime% = (up + flaky) / (up + flaky + down)`，nodata 不进分母；flaky 计入可用但页面单独可见。
- `slot_retention_days` 不得小于 90。
- 告警只有 `down` / `recovered` 两种事件；flaky 不触发；nodata 不参与转换判定。
- Webhook 投递：超时 10s，退避 1s/4s/16s 重试 3 次，失败只记日志，绝不阻塞探测循环。
- Session：内存 Map + HttpOnly/SameSite=Lax cookie，30 天；登录按 IP 限流（5 次失败锁 15 分钟）。
- 密码哈希用 argon2id（`Bun.password.hash` 内置支持，不引第三方库）。
- 状态页 30 秒轮询 `/api/status`；请求失败保留旧数据 + 顶部「数据可能已过期」条。
- **UI 文案与视觉以 `web/mock/Status.dc.html` 为准**（中文文案），它与设计文档冲突时以 mock 为准，具体三处：
  1. 横幅文案用 mock 的中文（「所有系统运行正常」等），不用设计文档 §5.4 的英文表；
  2. 条形几何用 mock 的动态公式（`step = 668/n; w = max(4, step - (n>=90?2.34 : n>=30?5 : 6))`），兼容 90d/30d/24h 三种条数；
  3. 24h 档位 label 用「24 小时」，tooltip 文案沿用 mock 的 slot 分支文案。
- 设计文档未覆盖但实现必需的字段（已决策）：`slot` 表增加可空列 `cert_days_left`（http 探测 `check_cert_expiry` 时写入，供详情页显示证书到期天数，设计文档 §7.4 要求展示但 §4.1 漏了该列）；新增只读端点 `GET /api/auth/setup-status` 返回 `{ hasUser }`（SPA 判断 `/setup` 是否该 302 到 `/login`）。
- 提交信息用 conventional commits（`feat:` / `test:` / `fix:` / `chore:`）。

## 最终文件结构

```
uptime/
├── package.json                    # workspace 根（workspaces: server, web）
├── .gitignore                      # 已有：node_modules/ data/ *.db .DS_Store
├── Dockerfile                      # 多阶段：vite build → bun build → 运行时
├── docker-compose.yml
├── README.md
├── docs/superpowers/{specs,plans}/
├── web/mock/                       # UI mock 参考（只读，不参与构建）
│   ├── Status.dc.html              # 视觉真值：CSS 变量、配色、几何、文案、聚合逻辑
│   └── support.js                  # mock 的 dc-runtime，移植后不再需要，仅供对照预览
├── server/
│   ├── package.json  tsconfig.json  drizzle.config.ts
│   └── src/
│       ├── index.ts                # 启动序列：迁移 → 调度器 → rollup job → HTTP
│       ├── config.ts               # 环境变量（DATA_DIR/PORT/PROBE_CONCURRENCY）
│       ├── db/
│       │   ├── schema.ts           # Drizzle schema（设计文档 §4.1 + cert_days_left）
│       │   ├── client.ts           # bun:sqlite 连接 + WAL/synchronous/foreign_keys
│       │   └── migrate.ts          # drizzle 迁移入口
│       ├── probes/                 # 纯探测层：不重试、不写库、不打日志
│       │   ├── types.ts            # ProbeConfig / ProbeResult / Probe
│       │   ├── http.ts  tcp.ts  ping.ts  dns.ts
│       │   └── index.ts            # registry: type → Probe
│       ├── scheduler/
│       │   ├── clock.ts            # slotStartAt / nextSlotStart / effectiveRetries（纯函数）
│       │   ├── slot-runner.ts      # slot 状态机（注入 probe/now/sleep），不 import store/db
│       │   ├── scheduler.ts        # tick 循环 + 并发池 + 持久化 + 触发 notify
│       │   ├── clock.test.ts  slot-runner.test.ts
│       ├── store/                  # 每张表一个文件，薄封装 drizzle
│       │   ├── monitors.ts  slots.ts  attempts.ts  daily.ts  webhooks.ts  settings.ts
│       ├── rollup/
│       │   ├── daily.ts            # slot → slot_daily（按 display_timezone 切日，幂等 upsert）
│       │   ├── retention.ts        # 过期清理 + incremental_vacuum
│       │   ├── daily.test.ts
│       ├── notify/
│       │   ├── transitions.ts      # (prev, cur) → 'down' | 'recovered' | null（纯函数）
│       │   ├── template.ts         # {{var}} 渲染 + JSON 转义
│       │   ├── dispatcher.ts       # 10s 超时 + 1/4/16s 退避 ×3
│       │   ├── transitions.test.ts  template.test.ts
│       └── api/
│           ├── app.ts              # Hono app 组装、静态托管、SPA fallback
│           ├── status.ts  timeseries.ts
│           ├── auth.ts  monitors.ts  groups.ts  webhooks.ts  settings.ts
│           └── middleware/{auth.ts, ratelimit.ts}
│           └── *.test.ts           # 请求级集成测试（内存 SQLite）
└── web/
    ├── package.json  vite.config.ts  tsconfig.json  index.html
    └── src/
        ├── main.tsx  App.tsx       # 路由表（设计文档 §7.4）
        ├── lib/
        │   ├── types.ts            # 与后端 API 对齐的 TS 类型
        │   ├── api.ts              # fetch 封装
        │   ├── status-color.ts     # dayColor / 四态色板（移植自 mock）
        │   ├── format.ts           # fmtPct / dayLabel / timeLabel / dur（移植自 mock）
        │   ├── theme.ts            # localStorage 主题持久化
        │   ├── status-color.test.ts  format.test.ts
        ├── components/
        │   ├── StatusBanner.tsx  GroupRow.tsx  MonitorRow.tsx
        │   ├── UptimeBar.tsx  BarTooltip.tsx  RangeTabs.tsx  ThemeToggle.tsx
        │   ├── StaleDataNotice.tsx  Legend.tsx
        │   └── admin/{MonitorForm.tsx, EffectiveRetriesHint.tsx, SortableList.tsx, ...}
        └── pages/
            ├── StatusPage.tsx  MonitorDetailPage.tsx  LoginPage.tsx  SetupPage.tsx
            └── admin/{AdminLayout.tsx, MonitorsPage.tsx, MonitorEditPage.tsx,
                       GroupsPage.tsx, WebhooksPage.tsx, SettingsPage.tsx}
```

## 关键接口约定（跨计划共享，各计划内会重复声明自己用到的部分）

```ts
// ---- probes/types.ts ----
export type ProbeType = 'http' | 'tcp' | 'ping' | 'dns'
export interface ProbeConfig {
  type: ProbeType
  target: string
  port: number | null
  timeoutMs: number
  config: Record<string, unknown>     // 类型专属配置（设计文档 §4.1）
}
export interface ProbeResult {
  ok: boolean
  latencyMs: number | null
  error: string | null
  certDaysLeft: number | null         // 仅 http + check_cert_expiry
}
export interface Probe { run(cfg: ProbeConfig, signal: AbortSignal): Promise<ProbeResult> }

// ---- scheduler/clock.ts ----
export function slotStartAt(nowSec: number, intervalS: number): number
export function nextSlotStart(nowSec: number, intervalS: number): number
export function effectiveRetries(o: { intervalS: number; retryIntervalS: number; maxRetries: number; timeoutMs: number }): number

// ---- scheduler/slot-runner.ts ----
export type SlotStatus = 0 | 1 | 2                    // up | flaky | down
export interface AttemptRow { seq: number; ok: boolean; latencyMs: number | null; error: string | null; at: number }
export interface SlotResult {
  status: SlotStatus
  attempts: number
  recoveredAfterS: number | null
  latencyMs: number | null                            // 成功那次的耗时
  error: string | null                                // 最后一次失败摘要
  certDaysLeft: number | null
  attemptRows: AttemptRow[]
}
export interface MonitorRuntimeConfig {
  id: number; type: ProbeType; target: string; port: number | null
  intervalS: number; retryIntervalS: number; maxRetries: number; timeoutMs: number
  config: Record<string, unknown>
}
export interface SlotDeps {
  probe: Probe
  now: () => number                                   // unix 秒，可注入假时钟
  sleep: (ms: number, signal: AbortSignal) => Promise<void>
}
export async function runSlot(
  cfg: MonitorRuntimeConfig, deps: SlotDeps, slotStartSec: number, signal: AbortSignal
): Promise<SlotResult>

// ---- notify/transitions.ts ----
export type AlertEvent = 'down' | 'recovered'
export function transitionEvent(prev: SlotStatus | null, cur: SlotStatus): AlertEvent | null
// prev = 上一个非 nodata slot 的状态；null 表示之前没有任何非 nodata slot

// ---- API：GET /api/status 响应（设计文档 §8.1 原样）----
type Status = 'operational' | 'degraded' | 'down' | 'nodata'
interface StatusResponse {
  site_title: string; timezone: string; generated_at: number
  overall: Status
  groups: Array<{ id: number | null; name: string; status: Status; uptime: number
    monitors: Array<{ id: number; name: string; status: Status; uptime: number
      flaky_count: number; bars: Array<{ t: number; s: 0|1|2|3|4 }> }> }>   // 0=up 1=degraded 2=partial 3=down 4=nodata
}
```

注意两套状态编号不同，别混用：
- `slot` 表 / `SlotStatus`：`0=up 1=flaky 2=down`；
- `bars[].s`（对前端的着色码）：`0=up 1=degraded 2=partial 3=down 4=nodata`。

## 环境准备（执行第一个计划前）

- 确认 `bun -v ≥ 1.3`、`node -v ≥ 20`。
- 仓库当前只有 docs 与 mock，无历史代码，直接按计划新建文件。
- `web/mock/` 永远只读：任何任务都不得修改或删除其中文件；它是视觉验收的对照物（可直接用浏览器打开 `Status.dc.html` 预览 mock 效果）。
