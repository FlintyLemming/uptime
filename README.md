# uptime

uptime-kuma 负责探测、kuma-mieru 负责好看，本项目把两者自研合体：单 Bun 进程 = Hono HTTP 服务 + 每秒 tick 的探测调度器（共享 SQLite），前端是 incident.io 风格的状态页。

核心卖点：**记号比例恒等于检查间隔**。kuma 把重试当独立心跳写进历史，间隔 2 分钟、重试间隔 30 秒时，一次故障会在 2 分钟内画出 4 个黄记号，视觉上严重夸大故障。本项目一个检查间隔（slot）至多产出一个记号，重试只是 slot 内部的细节——首检失败、重试成功记为 `flaky`，重试耗尽或撞上 slot 边界才记 `down`。slot 边界对齐 UTC epoch（`floor(now / interval) * interval`），重启、超时都不会让记号漂移，条形图永远等宽。

## 快速开始

```bash
docker compose up -d
```

打开 <http://localhost:3000> 即状态页。首次访问 `/setup` 设置管理员账号密码，之后通过右上角入口登录 `/login` 进管理后台。

## 本地开发

前置：Bun ≥ 1.3、Node ≥ 20。

```bash
bun install                 # workspace 根，装 server + web 依赖
cd server && bun run dev    # 后端 :3000（watch 模式）
cd web && bun run dev       # 前端 Vite dev server（已配置代理 /api → 127.0.0.1:3000）
```

测试：

```bash
cd server && bun test        # 后端 bun:test
cd web && bunx vitest run    # 前端 vitest
cd server && bunx tsc --noEmit
```

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `DATA_DIR` | `./data` | 数据目录，SQLite 文件在 `DATA_DIR/uptime.db` |
| `PORT` | `3000` | HTTP 监听端口 |
| `PROBE_CONCURRENCY` | `20` | 并发探测池上限 |

## 部署说明

- 数据只有一个文件：`./data/uptime.db`（WAL 模式，同目录还有 `-wal` / `-shm` 辅助文件）。备份二选一：停容器后直接拷贝整个 `data/` 目录；或不停机用 `sqlite3 uptime.db ".backup /path/backup.db"`（不要直接 cp 正在使用的 WAL 数据库文件）。
- 镜像是多阶段构建产物（vite build → `bun build --compile` 单二进制），运行时镜像不含源码与 dev 依赖。
- drizzle 迁移随镜像携带并通过 `MIGRATIONS_DIR` 注入，容器启动时自动迁移，迁移失败即 fail fast。
- 服务启动后调度器按 UTC epoch 对齐的 slot 边界运行，容器重启不会造成记号错位。

## ping 探测权限说明

容器默认不带 `CAP_NET_RAW`，ping 探测（ICMP）会因权限不足而失败。两个解决办法：

1. compose 加权限（简单直接）：

   ```yaml
   services:
     uptime:
       cap_add: [NET_RAW]
   ```

2. 宿主机放开非特权 ICMP（Linux 4.3+，推荐，容器无需特权）：

   ```bash
   sysctl -w net.ipv4.ping_group_range="0 2147483647"
   ```

   之后进程可用 ICMP datagram socket 发 ping。macOS 与部分受限环境不支持，请改用 http/tcp 探测。

## 开发指引

- slot 判定逻辑只改 `server/src/scheduler/`：`clock.ts` 是边界/有效重试纯函数，`slot-runner.ts` 是 slot 内状态机（注入 probe/now/sleep，不依赖 store/db），回归测试在 `slot-runner.test.ts`。
- 校验层强制 `timeout_ms < retry_interval_s * 1000`；表单会实时显示「本间隔内实际最多重试 N 次」。
- `uptime% = (up + flaky) / (up + flaky + down)`，`nodata` 不进分母。
- UI 文案与视觉以 `web/mock/Status.dc.html` 为准（只读，勿改）。
