# uptime — 设计文档

日期：2026-08-11

## 1. 背景与目标

现状是 uptime-kuma 负责探测、kuma-mieru 负责好看，两套系统叠在一起。自研版把两者合成一个，并修掉 kuma 的一个核心逻辑缺陷。

三个目标，按重要性排序：

1. **记号比例正确。** kuma 把「重试」当成独立心跳写进历史，间隔 2 分钟、重试间隔 30 秒时，一次故障会在 2 分钟内画出 4 个黄记号，视觉上严重夸大故障。本项目的显示记号数量恒等于检查间隔数量，重试是间隔内部的细节。
2. **incident.io 视觉风格。** 参考物是本仓库根目录的 `OpenAI Status.html`（incident.io 托管的 OpenAI 状态页）。
3. **零发布流程。** 域名根路径直接是状态页，右上角一个入口进管理页。只有一个状态页，没有草稿/发布/多页面概念。

### 非目标（明确不做）

多用户与权限、多状态页、发布流程、手写事件与维护公告、自动事件时间线、内置 IM/邮件/短信通道、从 kuma 导入数据、多探测点或集群。

## 2. 技术栈

| 层 | 选型 | 理由 |
|---|---|---|
| 运行时 | Bun | 内置 SQLite 驱动、TS 直跑、构建快 |
| HTTP | Hono | 轻、类型好、和 Bun 契合 |
| 数据库 | SQLite（WAL） + Drizzle ORM | 单文件、单用户场景绰绰有余、迁移可控 |
| 前端 | Vite + React + TypeScript + Tailwind | 纯静态 SPA，由后端托管 |
| 图表 | 自绘 SVG（条形图）+ Recharts（延迟折线） | 条形图形状特殊，自绘比配库快 |
| 部署 | 单 Docker 容器 | 挂 `/data` 存 SQLite |

调度器与 HTTP 服务同进程。没有选 Next.js 是因为后台调度器塞进框架进程后，dev 热重载和 standalone 启动都容易重复拉起定时器。

## 3. 核心：调度器与 slot 判定引擎

### 3.1 术语

- **attempt**：一次实际探测（一个 HTTP 请求 / 一次 TCP 连接）。
- **slot**：一个检查间隔。slot 是显示的最小单位——条形图上一个竖条恰好是一个 slot。
- **状态三态**：`up` / `flaky` / `down`。第四态 `nodata` 表示该 slot 没有数据（进程当时没在跑）。

### 3.2 slot 边界

```
slot_start = floor(now_unix / interval_s) * interval_s
```

对齐到 UTC epoch，不是「上次检查完 + interval」。重启、GC 停顿、探测超时都不会让记号漂移，条形图永远等宽。

监控项创建或 interval 变更后，从下一个边界开始生效，当前 slot 保持原 interval 走完。

### 3.3 slot 内状态机

```
t=0s    首检 ──成功──→ up，本 slot 收工，睡到下个边界
         │
        失败
         ↓
t=30s   重试 1 ──成功──→ flaky
t=60s   重试 2 ──成功──→ flaky
t=90s   重试 3 ──成功──→ flaky
t=120s  撞上 slot 边界 ────→ down
```

- `up`：首检即成功。attempts = 1。
- `flaky`：首检失败，某次重试成功。这就是需求里的「标记为离线后恢复」。记录 `recovered_after_s`（从 slot 起点到成功那次的秒数）。
- `down`：重试次数用尽或撞上 slot 边界，全部失败。

一个 slot 至多产出一行 `slot` 记录，与实际探测了几次无关。

### 3.4 重试预算被 slot 边界硬截断

`retry_interval_s` 保留为独立可配项（通常显著小于 `interval_s`），但实际可执行的重试次数受边界约束：

```
effective_retries = min(
  max_retries,
  floor((interval_s * 1000 - timeout_ms) / (retry_interval_s * 1000))
)
```

需求里举的例子（interval=120s、retry_interval=30s、max_retries=4、timeout=10s）算出 `floor((120000-10000)/30000) = 3`，即实际只能跑到重试 3。

监控项配置表单必须实时显示这一行提示：**「本间隔内实际最多重试 N 次，超出部分不会执行」**。kuma 允许配出永远跑不完的重试且不作任何提示，这里把它暴露在配置时而不是让用户从图上猜。

同时在校验层强制 `timeout_ms < retry_interval_s * 1000`，否则超时会吃掉重试节奏。表单侧拒绝提交并给出原因。

### 3.5 宕机期间不切换节奏

监控项处于 `down` 时，下一个 slot 照常走「首检 + 重试」流程，节奏完全不变。

- 记号密度恒等于 interval，连续宕机就是每个 slot 一个红条，比例天然正确。
- 恢复最慢在 `retry_interval_s` 内被发现（因为宕机时首检必然失败，随即进入重试循环）。
- 恢复后的那个 slot 按 3.3 的规则判定：首检就成功记 `up`，重试才成功记 `flaky`。

kuma 在 down 状态下会把检查间隔整体切换成 retryInterval，这正是黄记号密度失真的根源。本设计不做这个切换。

### 3.6 缺口不伪造

进程停机期间的 slot 不补写。查询时按 `slot_start` 序列做左连接，缺失的位置渲染为 `nodata` 灰条，既不算 up 也不算 down，不进入 uptime% 的分母。

### 3.7 并发

单进程一个 tick 循环（每秒醒一次，检查哪些监控项到达边界），到边界的监控项批量投入有界并发池，默认上限 20，可通过 `PROBE_CONCURRENCY` 调整。防止几十个监控项同时打满连接或触发目标端限流。

每个 slot 的执行是一个独立的 async 任务，自带 `AbortSignal`，在 slot 边界到达时被强制取消。

## 4. 数据模型

### 4.1 表结构

**`monitor_group`** — 组件分组（不叫 `group`，那是 SQL 保留字）
```
id            integer pk
name          text not null
sort_order    integer not null default 0
```

**`monitor`** — 监控项
```
id                integer pk
group_id          integer null references monitor_group(id) on delete set null
name              text not null
type              text not null           -- http | tcp | ping | dns
target            text not null           -- URL 或 hostname
port              integer null            -- tcp 用
interval_s        integer not null default 60
retry_interval_s  integer not null default 20
max_retries       integer not null default 3
timeout_ms        integer not null default 10000
active            integer not null default 1
sort_order        integer not null default 0
config            text not null default '{}'   -- JSON，类型专属配置
created_at        integer not null
updated_at        integer not null
```

`config` 的 JSON 结构按 `type` 区分：

- `http`：`method`、`headers`、`body`、`accepted_status_codes`（默认 `["200-299"]`）、`follow_redirects`、`keyword` + `keyword_invert`、`json_query` + `json_expected`、`ignore_tls`、`check_cert_expiry`
- `tcp`：无额外字段（`target` + `port` 即可）
- `ping`：`packet_count`（默认 1）
- `dns`：`resolver`（默认 `1.1.1.1`）、`record_type`（默认 `A`）、`expected_value`（可选，留空则只要解析成功即算 up）

**`slot`** — 每个检查间隔一行，保留 90 天
```
monitor_id        integer not null references monitor(id) on delete cascade
started_at        integer not null        -- unix 秒，已对齐边界
interval_s        integer not null        -- 冗余存储，interval 改过后历史仍可正确渲染
status            integer not null        -- 0=up 1=flaky 2=down
attempts          integer not null
recovered_after_s integer null            -- 仅 flaky
latency_ms        integer null            -- 成功那次的耗时；down 为 null
error             text null               -- 最后一次失败的错误摘要
primary key (monitor_id, started_at)
```

**`attempt`** — 每次探测明细，保留 7 天
```
id                integer pk
monitor_id        integer not null
slot_started_at   integer not null
seq               integer not null        -- 0=首检，1..n=重试
ok                integer not null
latency_ms        integer null
error             text null
at                integer not null
index (monitor_id, slot_started_at)
```

**`slot_daily`** — 每监控项每天一行，永久保留
```
monitor_id    integer not null
day           text not null            -- YYYY-MM-DD，按展示时区切分
up            integer not null
flaky         integer not null
down          integer not null
nodata        integer not null
down_seconds  integer not null
latency_p50   integer null
latency_p95   integer null
primary key (monitor_id, day)
```

**`webhook`** — 告警出口
```
id            integer pk
name          text not null
url           text not null
method        text not null default 'POST'
headers       text not null default '{}'   -- JSON
body_template text not null                -- 见 6.2
enabled       integer not null default 1
```

**`webhook_monitor`** — 关联表（为空表示全部监控项）
```
webhook_id    integer not null
monitor_id    integer not null
primary key (webhook_id, monitor_id)
```

**`user`** — 单用户
```
id             integer pk
username       text not null unique
password_hash  text not null       -- argon2id
created_at     integer not null
```

**`setting`** — 键值配置
```
key    text pk
value  text not null
```

初始键：`display_timezone`（默认 `Asia/Shanghai`）、`site_title`（默认 `Status`）、`slot_retention_days`（默认 90）、`attempt_retention_days`（默认 7）。

### 4.2 时区

`slot_daily.day` 按 `display_timezone` 切日，不按 UTC。默认 `Asia/Shanghai`。如果按 UTC 切，中国时区看到的「今天」会错位 8 小时，90 天图的日边界和用户直觉对不上。

改动 `display_timezone` 会触发一次全量 `slot_daily` 重建（从 `slot` 表重算最近 90 天，更早的日桶因为原始 slot 已过期无法重算，保持原值并在设置页说明）。

### 4.3 保留策略

每小时的 rollup job 之后跑一次清理，阈值读 `setting`：删除 `attempt` 中早于 `attempt_retention_days`（默认 7）的行、`slot` 中早于 `slot_retention_days`（默认 90）的行。`slot_daily` 永不删除。删除后执行 `PRAGMA incremental_vacuum`。

`slot_retention_days` 不得小于 90，否则 24h/30d 视图和时区重建会缺数据；设置页对此做校验。

## 5. 指标口径

### 5.1 uptime%

```
uptime% = (up + flaky) / (up + flaky + down)
```

`nodata` 不进分母。`flaky` 计入可用——重试成功说明服务在该间隔内最终是可达的。

但 flaky 不被隐藏：状态页行内单独显示「所选范围内 N 次闪断」，条形图上 flaky 是琥珀色，一眼可见。这样既不让偶发抖动污染 uptime 数字，也不让它消失。

### 5.2 累计宕机时长

```
down_seconds = Σ (down slot 数 × 该 slot 的 interval_s)
```

用 `slot.interval_s` 而不是监控项当前的 interval，所以改过间隔的历史仍然正确。

### 5.3 组聚合

- **组状态** = 组内最差状态。任一成员 down → 组 down；任一成员 flaky → 组 degraded；全部 up → 组 operational；全部 nodata → 组 nodata。
- **组 uptime%** = 成员分子之和 / 成员分母之和（加权平均，与 incident.io 一致），不是各成员百分比的算术平均。

### 5.4 全站总览状态

页面顶部横幅取所有监控项的最差当前状态：

| 条件 | 文案 | 颜色 |
|---|---|---|
| 全部 up | All systems operational | operational |
| 有 flaky 无 down | Some systems degraded | degraded |
| 1 个 down | 1 service is down | full-outage |
| 多个 down | N services are down | full-outage |
| 全部 nodata | Status unknown | nodata |

## 6. 告警

### 6.1 触发规则

只在**真正的状态转换**上触发，且只有两种事件：

- `down`：监控项从非 down 转入 down（即某个 slot 判定为 down，且上一个非 nodata slot 不是 down）。
- `recovered`：从 down 转出（某个 slot 判定为 up 或 flaky，且上一个非 nodata slot 是 down）。

**flaky 不触发任何通知。** 闪断已经在页面上可见，推送出去只会变成噪音——这与「重试不该被当成独立事件」是同一个判断。

nodata 不参与转换判定：进程重启造成的缺口不会产生假恢复通知。

### 6.2 Webhook 模板

`body_template` 是一段字符串模板，用 `{{var}}` 占位。可用变量：

`event`（`down`/`recovered`）、`monitor_name`、`monitor_type`、`target`、`group_name`、`status`、`error`、`attempts`、`slot_started_at`（ISO8601，按展示时区）、`down_duration_s`（仅 recovered）、`url`（该监控项详情页的绝对地址）。

默认模板：

```json
{
  "event": "{{event}}",
  "monitor": "{{monitor_name}}",
  "target": "{{target}}",
  "error": "{{error}}",
  "time": "{{slot_started_at}}",
  "url": "{{url}}"
}
```

渲染时对插入值做 JSON 字符串转义，避免错误信息里的引号破坏 payload。

### 6.3 投递

超时 10 秒，失败按 1s / 4s / 16s 退避重试 3 次。三次都失败则写日志并放弃，绝不阻塞或影响探测循环。管理页每个 webhook 有「发送测试」按钮，用一条假的 down 事件走完整渲染与投递链路。

## 7. 前端

### 7.1 视觉规格

从 `OpenAI Status.html` 抠出的原始值，直接采用：

**状态色**（默认 / hover / active-或-暗色hover）

| 状态 | 默认 | hover | active |
|---|---|---|---|
| operational | `#24c19a` | `#1fa382` | `#187f65` |
| degraded（flaky） | `#fbbf24` | `#f59e0b` | `#d97706` |
| partial-outage | `#f5785c` | `#f25533` | `#dd340e` |
| full-outage（down） | `#f87171` | `#ef4444` | `#dc2625` |
| nodata | `#e4e4e7`（暗色 `#39393f`） | — | — |

**条形几何**：单条 `width=5 height=16 rx=1`，步距 `7.34`（间隙 2.34），SVG 用 `viewBox="0 0 668 16"` + `width=100%` 自适应。90 条正好铺满。

**排版**：Inter，正文 `text-sm`，中性色走 Tailwind `slate` 色阶（`slate-900` 标题 / `slate-500` 次要 / `slate-300` 图标），暗色模式对应 `slate-50` / `slate-500` / `slate-800` 分隔线。

**深色模式**：默认跟随系统，右上角提供手动切换，选择持久化到 localStorage。

### 7.2 页面结构

```
┌─────────────────────────────────────────────┐
│  Status                          [🌓] [⚙]   │  ← 齿轮进 /admin
├─────────────────────────────────────────────┤
│  ✓  All systems operational                 │  ← 总览横幅
│     We're not aware of any issues.          │
├─────────────────────────────────────────────┤
│  System status              [90d｜30d｜24h]  │
├─────────────────────────────────────────────┤
│  ✓ APIs        3 components   99.94% uptime │  ← 组行，可点开
│  ▏▎▎▎▎▎▎▎▎▎▎▎▎▎▎▎▎▎▎▎▎▎▎▎▎▎▎▎▎▎▎▎▎▎▎▎▎▎▎▎▎ │
│     ├ ✓ api.example.com       99.98%        │  ← 展开后的成员
│     │  ▏▎▎▎▎▎▎▎▎▎▎▎▎▎▎▎▎▎▎▎▎▎▎▎▎▎▎▎▎▎▎▎▎▎ │
│     └ ✓ api.example.com/v2    99.90%        │
│  ✓ Web         2 components   99.99% uptime │
└─────────────────────────────────────────────┘
```

- 组行显示聚合状态与加权 uptime%，点击展开成员（展开状态存 localStorage）。
- 无分组的监控项平铺在组列表之后。
- 条形图 hover 显示 tooltip：日期 / 该日 up·flaky·down 计数 / 宕机时长；点击跳该监控项详情页。
- 时间范围切换 `90d | 30d | 24h`。前两个读 `slot_daily`（每条 = 1 天），`24h` 读 `slot`（每条 = 1 个 slot）。

### 7.3 日条着色

一天内有 N 个有效 slot（`up + flaky + down`）：

| 条件 | 颜色 |
|---|---|
| `down == 0 && flaky == 0` | operational |
| `down == 0 && flaky > 0` | degraded |
| `down > 0 && down / N < 0.05` | partial-outage |
| `down / N >= 0.05` | full-outage |
| `N == 0` | nodata |

24h 视图每条就是一个 slot，直接映射 up/flaky/down/nodata 四色，不存在 partial（单个 slot 没有比例概念）。

### 7.4 路由

| 路径 | 说明 | 鉴权 |
|---|---|---|
| `/` | 状态页 | 公开 |
| `/m/:id` | 监控项详情：条形图 + 延迟折线（p50/p95）+ 证书到期天数 + 近期 slot 表格 | 公开 |
| `/login` | 登录 | 公开 |
| `/setup` | 首次启动设置管理员密码，已有用户时 302 到 `/login` | 公开 |
| `/admin` | 监控项列表，拖拽排序，快速启停 | 需登录 |
| `/admin/monitors/new`、`/admin/monitors/:id` | 监控项表单（含 3.4 的实时提示） | 需登录 |
| `/admin/groups` | 分组管理 | 需登录 |
| `/admin/webhooks` | Webhook 管理 + 测试发送 | 需登录 |
| `/admin/settings` | 时区、站点标题、保留期、改密码 | 需登录 |

### 7.5 数据刷新

状态页每 30 秒轮询一次 `/api/status`。不做 SSE/WebSocket：最小 slot 粒度是分钟级，秒级推送没有价值，而轮询在反代和移动端休眠下的行为可预测得多。

请求失败时保留上一次数据，顶部加一条「数据可能已过期，最后更新于 X」提示条，而不是清空页面。

## 8. API

### 8.1 公开

**`GET /api/status?range=90d|30d|24h`**

一次请求返回整页所需的全部数据：

```ts
// 当前状态四态；partial 只出现在日聚合条的着色里（见 7.3），不作为实体的当前状态
type Status = 'operational' | 'degraded' | 'down' | 'nodata'

{
  site_title: string
  timezone: string
  generated_at: number
  overall: 'operational' | 'degraded' | 'down' | 'nodata'   // 见 5.4，全站横幅不产出 partial
  groups: Array<{
    id: number | null          // null = 未分组
    name: string
    status: Status
    uptime: number             // 0..1
    monitors: Array<{
      id: number
      name: string
      status: Status
      uptime: number             // 所选 range 内
      flaky_count: number        // 所选 range 内的 flaky slot 总数
      bars: Array<{ t: number; s: 0|1|2|3|4 }>   // 0=up 1=degraded 2=partial 3=down 4=nodata
    }>
  }>
}
```

**`GET /api/monitors/:id/timeseries?range=24h|7d|30d`** — 延迟折线数据点与 slot 明细。

### 8.2 管理（需 session）

```
POST   /api/auth/setup          首次设置密码，已有用户时返回 409
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/auth/me

GET    /api/admin/monitors
POST   /api/admin/monitors
PATCH  /api/admin/monitors/:id
DELETE /api/admin/monitors/:id
POST   /api/admin/monitors/:id/test     立即探测一次，不写 slot，直接返回结果
POST   /api/admin/monitors/reorder

GET    /api/admin/groups
POST   /api/admin/groups
PATCH  /api/admin/groups/:id
DELETE /api/admin/groups/:id

GET    /api/admin/webhooks
POST   /api/admin/webhooks
PATCH  /api/admin/webhooks/:id
DELETE /api/admin/webhooks/:id
POST   /api/admin/webhooks/:id/test

GET    /api/admin/settings
PUT    /api/admin/settings
POST   /api/admin/password
```

### 8.3 鉴权

单用户，argon2id 存密码哈希。登录成功签发 HttpOnly + SameSite=Lax + Secure（生产）的 session cookie，cookie 有效期 30 天。

服务端 session 存在进程内存的 Map 里，进程重启即失效——重启后需重新登录。单用户自用场景下这个代价可接受，换来省掉一张表和一套清理逻辑。

登录接口按 IP 限流：5 次失败后锁 15 分钟。

## 9. 模块划分

隔离的核心原则：**slot 判定逻辑必须能在不碰数据库、不发网络请求的情况下完整单元测试**，因为它是整个项目的价值所在。

```
server/
  index.ts              启动序列：迁移 → 调度器 → rollup job → HTTP
  db/
    schema.ts           Drizzle schema（4 节的表）
    migrate.ts
    client.ts           连接 + PRAGMA 设置
  probes/               ── 纯探测层，不知道 slot / DB / 重试的存在
    types.ts            interface Probe { run(cfg, signal): Promise<ProbeResult> }
    http.ts  tcp.ts  ping.ts  dns.ts
    index.ts            registry: type → Probe
  scheduler/
    clock.ts            slot 边界计算、effective_retries 计算（纯函数）
    slot-runner.ts      单个 slot 的状态机（注入 probe + clock，返回 SlotResult）
    scheduler.ts        tick 循环、并发池、把 SlotResult 交给 store
  store/
    monitors.ts  slots.ts  attempts.ts  daily.ts  webhooks.ts  settings.ts
  rollup/
    daily.ts            slot → slot_daily（按 display_timezone 切日）
    retention.ts        过期清理
  notify/
    transitions.ts      SlotResult 序列 → 事件（纯函数，6.1 的规则）
    template.ts         模板渲染 + JSON 转义
    dispatcher.ts       退避重试与投递
  api/
    status.ts  monitors.ts  admin.ts  auth.ts
    middleware/auth.ts  ratelimit.ts
web/
  src/
    pages/          Status  MonitorDetail  Login  Setup  admin/*
    components/     StatusBanner  GroupRow  MonitorRow  UptimeBar  LatencyChart  RangeTabs  ThemeToggle
    lib/            api.ts  status-color.ts  format.ts  theme.ts
```

边界约定：

- `probes/*` 输入配置输出 `ProbeResult`，不重试、不写库、不打日志。换探测类型只加一个文件加一行注册。
- `slot-runner.ts` 不 import 任何 `store/` 或 `db/`。它接收 `{ probe, now, sleep }` 三个注入依赖，返回 `SlotResult`。测试时全部替换成假实现。
- `scheduler.ts` 是唯一把「判定」和「持久化」缝在一起的地方。
- `notify/transitions.ts` 输入两个相邻 slot 的状态，输出 `Event | null`，纯函数。

## 10. 错误处理

| 场景 | 处理 |
|---|---|
| 探测抛异常（DNS 失败、连接拒绝、超时） | 一律在 probe 内部捕获并转成 `ProbeResult{ok:false, error}`，绝不向上抛。调度循环不会因为单个目标挂掉而中断 |
| slot 写库失败 | 记日志，丢弃该 slot（图上呈现为 nodata），不重试、不阻塞下一个 slot |
| rollup job 异常 | 记日志，下一小时重跑（rollup 幂等，按 `(monitor_id, day)` upsert） |
| webhook 投递失败 | 退避重试 3 次后放弃并记日志，不影响探测 |
| tick 循环内未捕获异常 | 顶层 try/catch 兜住并记日志，进程不退出 |
| 数据库文件损坏或迁移失败 | 启动时 fail fast，打印明确错误并退出，不带着半截 schema 运行 |
| 前端 API 请求失败 | 保留上次数据 + 顶部「数据可能已过期」提示条 |

## 11. 测试策略

重点压在 slot 判定上——那是这个项目存在的理由。

**`scheduler/slot-runner.test.ts`**（假时钟 + 假探测器）
- 首检成功 → `up`，`attempts == 1`，探测器只被调用 1 次
- 首检失败、重试 2 成功 → `flaky`，`attempts == 3`，`recovered_after_s` 正确
- 全部失败 → `down`，`error` 是最后一次的错误
- 重试预算被边界截断：interval=120s / retry=30s / max_retries=4 / timeout=10s → 实际执行 3 次重试后判 `down`
- 连续 3 个宕机 slot 恰好产出 3 行 slot（回归测试：这正是 kuma 会产出 12 行的场景）
- slot 边界到达时进行中的探测被 abort

**`scheduler/clock.test.ts`**
- 边界对齐：任意 now 落在 `[start, start+interval)` 内
- interval 变更后从下一个边界生效
- `effective_retries` 的边界值（retry_interval 恰好整除、timeout 逼近 retry_interval）

**`probes/*.test.ts`** — 各自 mock 网络层，覆盖成功、超时、状态码不匹配、关键词不匹配、TLS 错误。

**`rollup/daily.test.ts`** — 计数正确、nodata 不进分母、跨时区切日、幂等重跑。

**`notify/transitions.test.ts`** — down/recovered 各触发一次、flaky 不触发、nodata 缺口不产生假恢复。

**`api/*.test.ts`** — 请求级集成测试，用内存 SQLite。覆盖未登录访问管理接口返回 401、登录限流生效。

**前端** — `status-color.ts`（日条着色规则表驱动测试）、`UptimeBar` 渲染快照、uptime% 格式化。

## 12. 部署

单容器，多阶段构建：前端 `vite build` 产出静态资源，后端 Bun 打包，最终镜像只含运行时 + 产物。

```yaml
services:
  uptime:
    image: uptime:latest
    ports: ["3000:3000"]
    volumes: ["./data:/data"]
    environment:
      DATA_DIR: /data
      PORT: 3000
      PROBE_CONCURRENCY: 20
    restart: unless-stopped
```

- SQLite 开 WAL + `synchronous=NORMAL` + `foreign_keys=ON`。
- 启动时自动跑迁移。
- 无用户时访问 `/admin` 重定向到 `/setup`。
- `ping` 探测需要 `CAP_NET_RAW` 或走非特权 ICMP（`net.ipv4.ping_group_range`），Dockerfile 里配置并在 README 说明宿主机可能需要的调整。
- `GET /healthz` 返回进程与数据库状态，供反代或编排健康检查。

## 13. 分期

**第一期（本设计的范围）**：四种探测器、slot 引擎、状态页（分组 + 展开 + 90/30/24h 条形图）、监控项详情页（延迟折线）、管理页 CRUD、单用户登录、Webhook 告警、Docker 部署。

**明确留到以后**：更多探测类型（数据库、Push/心跳）、内置 IM 通道、手写公告与维护窗口、自动事件时间线、多探测点。数据模型已经为它们留了扩展位（`monitor.config` 是 JSON、`webhook` 独立成表），但第一期不实现。
