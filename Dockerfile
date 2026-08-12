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
# 不加 --external：编译产物自带 drizzle-orm/hono，运行时镜像无需 node_modules
RUN cd server && bun build --compile --minify --outfile /out/uptime src/index.ts

# ---- 运行时 ----
FROM oven/bun:1-slim
WORKDIR /app
COPY --from=server /out/uptime ./uptime
# 编译为单二进制后 drizzle 迁移目录必须随镜像携带，由 MIGRATIONS_DIR 注入
COPY --from=server /src/server/drizzle ./drizzle
# SPA 静态产物；app.ts 按进程 cwd 探测 web/dist
COPY --from=web /src/web/dist ./web/dist
ENV DATA_DIR=/data PORT=3000 MIGRATIONS_DIR=/app/drizzle
VOLUME /data
EXPOSE 3000
# slim 镜像没有 curl，用自带的 bun 打 /healthz
HEALTHCHECK --interval=30s --timeout=3s CMD bun -e 'const r = await fetch("http://127.0.0.1:" + (process.env.PORT ?? "3000") + "/healthz"); if (!r.ok) process.exit(1); process.exit(0)' || exit 1
CMD ["./uptime"]
