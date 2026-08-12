# uptime 计划 06：静态托管 + Docker 部署 + 端到端验收

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让后端托管前端构建产物（SPA fallback），多阶段 Docker 镜像 + compose，README，然后跑一遍端到端验收把五条计划的交付串起来。

**Architecture:** 生产时 Hono 用 `serveStatic`（bun adapter）托管 `web/dist`，非 `/api` 路径 fallback 到 `index.html`；多阶段 Dockerfile（vite build → bun build --compile → 运行时镜像），单容器挂 `/data`。

**Tech Stack:** Hono serveStatic（`hono/bun`）、Docker、docker compose。

## Global Constraints

（继承总览，摘录本计划相关）

- SQLite WAL + `synchronous=NORMAL` + `foreign_keys=ON`（已在 client.ts 完成）。
- 启动自动迁移；迁移失败 fail fast（已在 index.ts 完成）。
- `GET /healthz` 已实现；compose healthcheck 用它。
- ping 探测需要 `CAP_NET_RAW` 或宿主机 `net.ipv4.ping_group_range` 配置——README 必须写明，Dockerfile/compose 不默认加特权。
- 镜像不含源码与 dev 依赖；数据只在 `/data`。

## File Structure（本计划新增）

```
server/src/api/app.ts          # 修改：静态托管 + SPA fallback
server/src/api/static.test.ts
Dockerfile  docker-compose.yml  .dockerignore
README.md
```

---

### Task 1: 后端静态托管与 SPA fallback

**Files:**
- Modify: `server/src/api/app.ts`
- Create: `server/src/api/static.test.ts`

**Interfaces:**
- `buildApp(db, sql, opts: { rebuildDaily?: () => void; publicDir?: string })`：新增可选 `publicDir`（默认 `../web/dist`，相对 server/src/api 解析）。存在时：`GET /assets/*` 与根级静态文件走 serveStatic；非 `/api`、非 `/healthz` 的 GET 未命中时返回 `index.html`（200，text/html）。目录不存在时行为不变（404 JSON）——dev 模式与测试不受影响。

- [ ] **Step 1: 写失败测试**

`server/src/api/static.test.ts`:

```ts
import { expect, test, beforeAll, afterAll } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { openDb } from '../db/client'
import { runMigrations, seedSettings } from '../db/migrate'
import { buildApp } from './app'

const DIR = '/tmp/uptime-static-test'

beforeAll(() => {
  rmSync(DIR, { recursive: true, force: true })
  mkdirSync(`${DIR}/assets`, { recursive: true })
  writeFileSync(`${DIR}/index.html`, '<!doctype html><html><body>spa</body></html>')
  writeFileSync(`${DIR}/assets/app.js`, 'console.log(1)')
})

afterAll(() => rmSync(DIR, { recursive: true, force: true }))

function setup() {
  const { db, sql } = openDb(':memory:')
  runMigrations(db, sql)
  seedSettings(db)
  return buildApp(db, sql, { publicDir: DIR })
}

test('serves index.html at /', async () => {
  const r = await setup().request('/')
  expect(r.status).toBe(200)
  expect(await r.text()).toContain('spa')
})

test('serves built assets', async () => {
  const r = await setup().request('/assets/app.js')
  expect(r.status).toBe(200)
  expect(await r.text()).toContain('console.log')
})

test('spa fallback: unknown path returns index.html', async () => {
  const r = await setup().request('/admin/monitors/new')
  expect(r.status).toBe(200)
  expect(await r.text()).toContain('spa')
})

test('api routes are not shadowed by fallback', async () => {
  const app = setup()
  expect((await app.request('/api/status')).status).toBe(200)
  expect((await app.request('/healthz')).status).toBe(200)
})

test('no publicDir -> api-only mode still 404s unknown paths', async () => {
  const { db, sql } = openDb(':memory:')
  runMigrations(db, sql)
  seedSettings(db)
  const app = buildApp(db, sql, { publicDir: '/tmp/definitely-missing-dir' })
  expect((await app.request('/anything')).status).toBe(404)
})
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd server && bun test src/api/static.test.ts`
Expected: FAIL（`/` 返回 404 JSON）。

- [ ] **Step 3: 修改 app.ts**

在 `buildApp` 里（API 路由注册之后、`notFound` 之前）加入：

```ts
import { serveStatic } from 'hono/bun'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

// buildApp 内：
const publicDir = opts.publicDir ?? new URL('../../web/dist', import.meta.url).pathname
if (existsSync(join(publicDir, 'index.html'))) {
  app.use('/assets/*', serveStatic({ root: publicDir }))
  app.get('/favicon.ico', serveStatic({ path: `${publicDir}/favicon.ico` }))
  app.get('*', async (c) => {
    if (c.req.path.startsWith('/api/') || c.req.path === '/healthz') return c.notFound()
    const html = await readFile(join(publicDir, 'index.html'))
    return c.html(html.toString())
  })
}
```

注意 serveStatic 的 `root` 在 hono/bun 里相对 **进程 cwd** 或接受绝对路径——传入绝对路径 `publicDir` 时若行为异常，改用 `serveStatic({ root: './', rewriteRequestPath: (p) => publicDir + p })`，以测试通过为准。

- [ ] **Step 4: 运行测试验证通过 + 全量回归**

Run: `cd server && bun test src/api/static.test.ts && bun test`
Expected: 5 pass；全量仍绿。

- [ ] **Step 5: Commit**

```bash
git add server/src/api/app.ts server/src/api/static.test.ts
git commit -m "feat(api): static hosting with spa fallback for built web assets"
```

---

### Task 2: Dockerfile + compose + .dockerignore

**Files:**
- Create: `Dockerfile`、`docker-compose.yml`、`.dockerignore`

- [ ] **Step 1: Dockerfile（多阶段）**

```dockerfile
# ---- 前端构建 ----
FROM oven/bun:1 AS web
WORKDIR /src
COPY package.json bun.lock ./
COPY server/package.json server/
COPY web/package.json web/
RUN bun install --frozen-lockfile
COPY web/ web/
COPY server/tsconfig.json server/
RUN cd web && bun run build

# ---- 后端打包 ----
FROM oven/bun:1 AS server
WORKDIR /src
COPY package.json bun.lock ./
COPY server/package.json server/
COPY web/package.json web/
RUN bun install --frozen-lockfile --production
COPY server/ server/
COPY --from=web /src/web/dist web/dist
RUN cd server && bun build --compile --minify --outfile /out/uptime src/index.ts --external drizzle-orm

# ---- 运行时 ----
FROM oven/bun:1-slim
WORKDIR /app
COPY --from=server /out/uptime ./uptime
ENV DATA_DIR=/data PORT=3000
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD curl -fsS http://127.0.0.1:3000/healthz || exit 1
CMD ["./uptime"]
```

注意：`bun build --compile` 对 `drizzle-kit` 迁移文件路径的处理——`migrate.ts` 用 `import.meta.url` 相对路径找 `drizzle/`，编译后单二进制里该路径失效。**实现时必须**把迁移策略改为内联：在 server 里加一个 `src/db/migrations-inline.ts`，用 `import migrations from '../drizzle' with { type: 'directory' }`（或在构建步骤把 drizzle 目录拷进镜像并用环境变量 `MIGRATIONS_DIR` 指定）。二选一，以 `docker compose up` 后能建表为准；同时保证 `bun run src/index.ts`（非编译）路径仍可用。测试：改完后 `cd server && bun test` 全绿，并 `bun run db:generate` 不受影响。

- [ ] **Step 2: docker-compose.yml**

```yaml
services:
  uptime:
    build: .
    image: uptime:latest
    ports: ["3000:3000"]
    volumes: ["./data:/data"]
    environment:
      DATA_DIR: /data
      PORT: 3000
      PROBE_CONCURRENCY: 20
    restart: unless-stopped
```

- [ ] **Step 3: .dockerignore**

```
.git
node_modules
web/node_modules
server/node_modules
web/dist
data
*.db
docs
web/mock
```

- [ ] **Step 4: 构建镜像并冒烟**

Run: `cd /Users/flintylemming/Projects/uptime && docker compose build && docker compose up -d && sleep 3 && curl -s http://127.0.0.1:3000/healthz`
Expected: `{"ok":true,"db":"ok"}`。

- [ ] **Step 5: Commit**

```bash
git add Dockerfile docker-compose.yml .dockerignore server/src/db/migrations-inline.ts 2>/dev/null
git commit -m "feat(deploy): multi-stage docker build with compose"
```

---

### Task 3: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: 写 README（中文）**

内容要求（不贴全文，实现时逐条写全）：
1. 项目定位一段话：uptime-kuma + kuma-mieru 的自研合体；核心卖点=记号比例恒等于检查间隔（slot 模型）。
2. 快速开始：`docker compose up -d` → 打开 `:3000` → `/setup` 设密码。
3. 本地开发：`bun install`；后端 `cd server && bun run dev`；前端 `cd web && bun run dev`（Vite 代理 `/api`）。
4. 环境变量表：`DATA_DIR` / `PORT` / `PROBE_CONCURRENCY`。
5. 部署说明：数据在 `./data/uptime.db`（WAL 模式，备份需停容器或用 `sqlite3 .backup`）。
6. ping 探测权限说明：容器默认无 `CAP_NET_RAW`，两个办法——compose 加 `cap_add: [NET_RAW]`，或宿主机 `sysctl -w net.ipv4.ping_group_range="0 2147483647"`（Linux ICMP datagram socket）。
7. 开发指引一段：slot 判定逻辑只改 `server/src/scheduler/`，测试在 `slot-runner.test.ts`。

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: readme with quickstart, dev guide and ping permissions"
```

---

### Task 4: 端到端验收（全部计划串联）

**Files:** 无新增；发现问题就地修并补测试。

- [ ] **Step 1: 起容器，完整走一遍用户旅程**

1. `docker compose up -d --build`；`curl /healthz` 200。
2. 浏览器 `http://localhost:3000` → 状态页空态正常 → `/setup` 设密码 → 登录。
3. 建分组「API」；建 http 监控指向 `https://example.com`（interval 60s）；建 tcp 监控指向本机任意开放端口。
4. 等 2-3 分钟，回状态页：出现绿条；点监控名进详情页有条形图与折线。
5. 造故障：把 tcp 监控 target 改成 `127.0.0.1:1` → 等一个完整 interval → 状态页变红、横幅「1 个服务当前宕机」。
6. Webhook：起一个 `bun -e "Bun.serve({port:9999,fetch(r){console.log(await r.text());return new Response('ok')}})"` 接收端，建 webhook 指向它 → 管理页「发送测试」收到假 down 事件；真实 down 转换时收到渲染后的 payload。
7. 修好 target → 下一 slot 恢复 → 收到 recovered webhook。
8. 设置页改站点标题与时区（Asia/Shanghai → UTC），状态页标题即时变化。
9. `docker compose restart` → 重启后 session 失效（需重新登录，设计如此）、历史数据仍在。
10. 状态页断后端（`docker compose stop`）30 秒以上 → 出现「数据可能已过期」提示条，数据不清空。

- [ ] **Step 2: 对照 mock 做最终视觉验收**

并排打开 `web/mock/Status.dc.html` 与线上状态页：色值、条宽、文案、图例、说明段、暗色模式逐项核对。差异即 bug，修掉。

- [ ] **Step 3: 全量测试收尾**

Run: `cd server && bun test && bunx tsc --noEmit && cd ../web && bunx vitest run && bun run build`
Expected: 全部通过。

- [ ] **Step 4: 最终 Commit**

```bash
cd /Users/flintylemming/Projects/uptime
git add -A
git commit -m "chore: e2e acceptance fixes and polish" --allow-empty
```

---

## 计划 06 验收清单

- `docker compose up -d` 后整站（状态页 + 详情 + 登录 + 全部管理页 + webhook 测试）可用。
- 容器重启数据不丢、session 按设计失效。
- 视觉对照 mock 无差异。
- server/web 全部测试绿。
