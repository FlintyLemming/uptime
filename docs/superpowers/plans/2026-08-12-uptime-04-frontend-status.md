# uptime 计划 04：前端脚手架 + 状态页 + 监控详情页

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭建 Vite + React + Tailwind 前端，把 `web/mock/Status.dc.html` 的状态页逐值移植成连接真实 API 的 React 实现，并实现监控详情页（条形图 + 延迟折线 + slot 表格）。

**Architecture:** 纯 SPA，react-router 路由；视觉完全走 mock 的 CSS 变量体系（`:root` 浅色 / `html.dark` 深色），Tailwind 只负责布局与间距，颜色一律 `var(--xx)` 任意值；状态页 30s 轮询，失败保留旧数据并显示过期提示条。

**Tech Stack:** Vite、React 18、TypeScript、Tailwind CSS v4、react-router-dom、Recharts、vitest + @testing-library/react。依赖计划 03 的 API 已存在。

## Global Constraints

（继承总览，摘录本计划相关）

- **视觉唯一真值是 `web/mock/Status.dc.html`**。所有色值、几何、字号、间距、中文文案直接从该文件抄，不要自行发挥；该文件只读。
- 深色模式：默认跟随系统，右上角手动切换，选择持久化到 localStorage（key `uptime-theme`，值 `light|dark`）。
- 条形几何：`viewBox="0 0 668 16"`、`width=100% height=16 preserveAspectRatio="none"`；`step = 668/n`；`w = max(4, step - (n>=90 ? 2.34 : n>=30 ? 5 : 6))`。
- 配色：up `#24c19a`、degraded `#fbbf24`、partial `#f5785c`、down `#f87171`、nodata 浅 `#e4e4e7` / 暗 `#39393f`。
- 组行展开状态存 localStorage（key `uptime-open-groups`，JSON 数组组 id）。
- 状态页每 30 秒轮询 `GET /api/status?range=...`；请求失败保留上次数据 + 顶部「数据可能已过期，最后更新于 X」提示条。
- 组行 bars 为成员逐位最差（服务端已算好，直接用 `groups[].bars`）。
- 24h 档位 label 为「24 小时」，tooltip 用 mock 的 slot 分支文案（「正常 · 首检成功」等）。

## File Structure（本计划新增）

```
web/package.json  vite.config.ts  tsconfig.json  index.html  vitest.config.ts
web/src/main.tsx  App.tsx  index.css
web/src/lib/{types,api,status-color,format,theme}.ts
web/src/lib/{status-color,format}.test.ts
web/src/components/{ThemeToggle,RangeTabs,UptimeBar,BarTooltip,Legend,StatusBanner,StaleDataNotice}.tsx
web/src/components/{GroupRow,MonitorRow}.tsx
web/src/components/UptimeBar.test.tsx
web/src/pages/{StatusPage,MonitorDetailPage}.tsx
web/mock/                              # 已存在，只读
```

**Interfaces:** 消费计划 03 的 `GET /api/status?range=` 与 `GET /api/monitors/:id/timeseries?range=`。计划 05 在本脚手架上添加 auth/admin 页面。

---

### Task 1: Vite + React + Tailwind 脚手架与主题基础

**Files:**
- Create: `web/package.json`、`web/vite.config.ts`、`web/tsconfig.json`、`web/index.html`、`web/vitest.config.ts`
- Create: `web/src/main.tsx`、`web/src/App.tsx`、`web/src/index.css`

- [ ] **Step 1: web/package.json**

```json
{
  "name": "@uptime/web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "test": "vitest run"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.30.0",
    "recharts": "^2.15.0"
  },
  "devDependencies": {
    "@testing-library/react": "^16.2.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "jsdom": "^26.0.0",
    "tailwindcss": "^4.1.0",
    "@tailwindcss/vite": "^4.1.0",
    "typescript": "^5.7.0",
    "vite": "^6.2.0",
    "vitest": "^3.1.0"
  }
}
```

- [ ] **Step 2: vite.config.ts（dev 代理 API 到后端 3000）**

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: { '/api': 'http://127.0.0.1:3000' },
  },
})
```

- [ ] **Step 3: tsconfig.json、index.html、vitest.config.ts**

`web/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["vite/client", "vitest/globals"]
  },
  "include": ["src", "vite.config.ts", "vitest.config.ts"]
}
```

`web/index.html`:

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Status</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`web/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: { environment: 'jsdom', globals: true },
})
```

- [ ] **Step 4: index.css — 从 mock 抄 CSS 变量与全局样式**

`web/src/index.css`（值逐一对照 `web/mock/Status.dc.html` 的 `<style>` 块，暗色选择器换成 Tailwind 的 `.dark` 类）:

```css
@import "tailwindcss";

@custom-variant dark (&:where(.dark, .dark *));

:root {
  --bg: #ffffff;
  --bg-sub: #f8fafc;
  --line: #e2e8f0;
  --fg: #0f172a;
  --fg-2: #475569;
  --fg-3: #94a3b8;
  --card: #ffffff;
  --shadow: 0 1px 2px rgba(15, 23, 42, 0.05);
}
.dark {
  --bg: #09090b;
  --bg-sub: #111114;
  --line: #26262b;
  --fg: #f8fafc;
  --fg-2: #a1a1aa;
  --fg-3: #71717a;
  --card: #111114;
  --shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font-family: Inter, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
  -webkit-font-smoothing: antialiased;
}
```

- [ ] **Step 5: main.tsx 与 App.tsx（路由骨架，admin 页面在计划 05 补）**

`web/src/main.tsx`:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { initTheme } from './lib/theme'
import './index.css'

initTheme()
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
```

`web/src/App.tsx`:

```tsx
import { Route, Routes } from 'react-router-dom'
import StatusPage from './pages/StatusPage'
import MonitorDetailPage from './pages/MonitorDetailPage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<StatusPage />} />
      <Route path="/m/:id" element={<MonitorDetailPage />} />
      {/* /login /setup /admin/* 在计划 05 添加 */}
    </Routes>
  )
}
```

（StatusPage/MonitorDetailPage 在 Task 4/5 创建；先建占位文件让 dev 能跑：各自 `export default function X() { return null }`。）

- [ ] **Step 6: 安装并验证**

Run: `cd /Users/flintylemming/Projects/uptime && bun install && cd web && bunx vite build`
Expected: 构建成功。

- [ ] **Step 7: Commit**

```bash
git add web/package.json web/vite.config.ts web/tsconfig.json web/index.html web/vitest.config.ts web/src/ bun.lock
git commit -m "feat(web): vite react tailwind scaffold with mock theme variables"
```

---

### Task 2: lib — types / api / status-color / format / theme（移植自 mock）

**Files:**
- Create: `web/src/lib/types.ts`、`api.ts`、`status-color.ts`、`format.ts`、`theme.ts`
- Create: `web/src/lib/status-color.test.ts`、`format.test.ts`

**Interfaces:**
- Produces:
  - `types.ts`：`StatusResponse`（对齐后端）、`TimeseriesResponse`、`Bar = { t: number; s: number }`。
  - `api.ts`：`fetchStatus(range): Promise<StatusResponse>`、`fetchTimeseries(id, range): Promise<TimeseriesResponse>`（fetch 封装，非 2xx 抛 `ApiError`）。
  - `status-color.ts`：`BAR_COLORS = { up:'#24c19a', degraded:'#fbbf24', partial:'#f5785c', down:'#f87171', nodataLight:'#e4e4e7', nodataDark:'#39393f' }`；`colorOf(code: number, theme: 'light'|'dark'): string`；`dayColor(d: {up,flaky,down}): 0|1|2|3|4`（mock 的 dayColor 逐行移植，表驱动测试）。
  - `format.ts`：`fmtPct(x)`、`dayLabel(t)`、`timeLabel(t)`、`dur(seconds)` —— 全部从 mock 的 `<script>` 移植（`fmtPct` 99.995 向上显示 100%；中文单位）。
  - `theme.ts`：`initTheme()`（localStorage 优先，否则 `matchMedia('(prefers-color-scheme: dark)')`，把 `dark` 类加到 `document.documentElement`）、`useTheme(): { theme, toggle }`。

- [ ] **Step 1: types.ts**

```ts
export type EntityStatus = 'operational' | 'degraded' | 'down' | 'nodata'
export interface Bar { t: number; s: number }       // 0=up 1=degraded 2=partial 3=down 4=nodata
export interface StatusMonitor { id: number; name: string; status: EntityStatus; uptime: number; flaky_count: number; bars: Bar[] }
export interface StatusGroup { id: number | null; name: string; status: EntityStatus; uptime: number; monitors: StatusMonitor[]; bars: Bar[] }
export interface StatusResponse { site_title: string; timezone: string; generated_at: number; overall: EntityStatus; groups: StatusGroup[] }

export interface TimeseriesSlot { started_at: number; status: number; latency_ms: number | null; error: string | null; attempts: number; recovered_after_s: number | null; cert_days_left: number | null }
export interface TimeseriesDaily { day: string; up: number; flaky: number; down: number; nodata: number; down_seconds: number; latency_p50: number | null; latency_p95: number | null }
export interface TimeseriesResponse {
  monitor: { id: number; name: string; type: string; target: string; interval_s: number; config: Record<string, unknown> }
  slots: TimeseriesSlot[]; daily: TimeseriesDaily[]; range_seconds: number
}
```

- [ ] **Step 2: api.ts**

```ts
export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path)
  if (!res.ok) throw new ApiError(res.status, `${res.status} ${await res.text()}`)
  return res.json() as Promise<T>
}

export function fetchStatus(range: '90d' | '30d' | '24h') {
  return get<import('./types').StatusResponse>(`/api/status?range=${range}`)
}

export function fetchTimeseries(id: number, range: '24h' | '7d' | '30d') {
  return get<import('./types').TimeseriesResponse>(`/api/monitors/${id}/timeseries?range=${range}`)
}
```

- [ ] **Step 3: 写失败测试 status-color.test.ts**

```ts
import { describe, expect, it } from 'vitest'
import { colorOf, dayColor, BAR_COLORS } from './status-color'

describe('dayColor (spec 7.3, mirrored from mock)', () => {
  it.each([
    [{ up: 720, flaky: 0, down: 0 }, 0],
    [{ up: 719, flaky: 1, down: 0 }, 1],
    [{ up: 716, flaky: 0, down: 4 }, 2],           // 4/720 < 5%
    [{ up: 714, flaky: 0, down: 36 }, 3],          // 36/750 = 4.8%? no → 用 down/(up+flaky+down)
    [{ up: 0, flaky: 0, down: 0 }, 4],
  ] as const)('dayColor(%j) === %i', (day, expected) => {
    expect(dayColor(day)).toBe(expected)
  })

  it('boundary: exactly 5% down is full-outage', () => {
    expect(dayColor({ up: 95, flaky: 0, down: 5 })).toBe(3)
    expect(dayColor({ up: 95, flaky: 0, down: 4 })).toBe(2)
  })
})

describe('colorOf', () => {
  it('maps bar codes to mock palette', () => {
    expect(colorOf(0, 'light')).toBe('#24c19a')
    expect(colorOf(1, 'light')).toBe('#fbbf24')
    expect(colorOf(2, 'light')).toBe('#f5785c')
    expect(colorOf(3, 'light')).toBe('#f87171')
    expect(colorOf(4, 'light')).toBe('#e4e4e7')
    expect(colorOf(4, 'dark')).toBe('#39393f')
  })
  it('exports the exact palette', () => {
    expect(BAR_COLORS.up).toBe('#24c19a')
    expect(BAR_COLORS.down).toBe('#f87171')
  })
})
```

- [ ] **Step 4: 写失败测试 format.test.ts**

```ts
import { expect, it } from 'vitest'
import { fmtPct, dur } from './format'

it('fmtPct rounds to 2 decimals and shows 100 near-perfect', () => {
  expect(fmtPct(1)).toBe('100%')
  expect(fmtPct(0.99999)).toBe('100%')
  expect(fmtPct(0.999)).toBe('99.90%')
  expect(fmtPct(0.5)).toBe('50.00%')
})

it('dur formats seconds/minutes/hours in Chinese units', () => {
  expect(dur(45)).toBe('45 秒')
  expect(dur(120)).toBe('2 分钟')
  expect(dur(7200)).toBe('2.0 小时')
})
```

- [ ] **Step 5: 运行测试验证失败**

Run: `cd web && bunx vitest run src/lib`
Expected: FAIL（模块不存在）。

- [ ] **Step 6: 实现 status-color.ts、format.ts、theme.ts**

`web/src/lib/status-color.ts`（dayColor 逐行对照 mock）:

```ts
export const BAR_COLORS = {
  up: '#24c19a', degraded: '#fbbf24', partial: '#f5785c', down: '#f87171',
  nodataLight: '#e4e4e7', nodataDark: '#39393f',
} as const

export function dayColor(dy: { up: number; flaky: number; down: number }): 0 | 1 | 2 | 3 | 4 {
  const n = dy.up + dy.flaky + dy.down
  if (n === 0) return 4
  if (dy.down === 0) return dy.flaky === 0 ? 0 : 1
  return dy.down / n < 0.05 ? 2 : 3
}

export function colorOf(code: number, theme: 'light' | 'dark'): string {
  return code === 0 ? BAR_COLORS.up
    : code === 1 ? BAR_COLORS.degraded
    : code === 2 ? BAR_COLORS.partial
    : code === 3 ? BAR_COLORS.down
    : theme === 'dark' ? BAR_COLORS.nodataDark : BAR_COLORS.nodataLight
}

export const STATUS_RANK: Record<string, number> = { nodata: -1, operational: 0, degraded: 1, down: 2 }

export function worstStatus(list: string[]): string {
  return list.reduce((a, b) => ((STATUS_RANK[b] ?? -1) > (STATUS_RANK[a] ?? -1) ? b : a), 'nodata')
}
```

`web/src/lib/format.ts`:

```ts
export function fmtPct(x: number): string {
  const p = x * 100
  return (p >= 99.995 ? '100' : p.toFixed(2)) + '%'
}

export function dayLabel(unixSec: number): string {
  const d = new Date(unixSec * 1000)
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`
}

export function timeLabel(unixSec: number): string {
  const d = new Date(unixSec * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function dur(s: number): string {
  if (s < 60) return `${s} 秒`
  if (s < 3600) return `${Math.round(s / 60)} 分钟`
  return `${(s / 3600).toFixed(1)} 小时`
}
```

`web/src/lib/theme.ts`:

```ts
import { useCallback, useEffect, useState } from 'react'

const KEY = 'uptime-theme'
export type Theme = 'light' | 'dark'

function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function currentTheme(): Theme {
  const saved = localStorage.getItem(KEY)
  return saved === 'dark' || saved === 'light' ? saved : systemTheme()
}

function apply(t: Theme) {
  document.documentElement.classList.toggle('dark', t === 'dark')
}

export function initTheme() {
  apply(currentTheme())
}

export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(currentTheme)
  useEffect(() => { apply(theme) }, [theme])
  const toggle = useCallback(() => {
    setTheme((t) => {
      const next = t === 'light' ? 'dark' : 'light'
      localStorage.setItem(KEY, next)
      return next
    })
  }, [])
  return { theme, toggle }
}
```

- [ ] **Step 7: 运行测试验证通过**

Run: `cd web && bunx vitest run src/lib`
Expected: 全部 pass。若 `dur(7200)` 断言因浮点失败，检查实现是否用了 `(s/3600).toFixed(1)`。

- [ ] **Step 8: Commit**

```bash
git add web/src/lib/
git commit -m "feat(web): api client, status colors, formatting and theme (ported from mock)"
```

---

### Task 3: 共享组件 — UptimeBar / BarTooltip / RangeTabs / ThemeToggle / StatusBanner / Legend / StaleDataNotice

**Files:**
- Create: `web/src/components/UptimeBar.tsx`、`BarTooltip.tsx`、`RangeTabs.tsx`、`ThemeToggle.tsx`、`StatusBanner.tsx`、`Legend.tsx`、`StaleDataNotice.tsx`
- Create: `web/src/components/UptimeBar.test.tsx`

**Interfaces:**
- `UptimeBar({ bars, theme, onHover(bar, rect), onLeave })`：渲染 `<svg viewBox="0 0 668 16" width="100%" height={16} preserveAspectRatio="none">`，几何按 Global Constraints 公式；每个 `<rect>` 的 `onMouseEnter` 把 bar 与其 `getBoundingClientRect()` 上抛。
- `BarTooltip({ tip }: { tip: { x: y, title, line1, line2 } | null })`：mock 的 fixed tooltip 原样。
- `RangeTabs({ value, onChange, ranges }: { ranges: Array<{key,label}> })`。
- `StatusBanner({ status }: { status: EntityStatus })`：mock 的文案表（operational=「所有系统运行正常/我们目前没有发现问题。」；degraded=「部分服务性能下降/部分服务出现闪断，重试后已恢复，可用性未中断。」；down=「N 个服务当前宕机」（N 由 props 传入，1 时「1 个服务当前宕机」）/「我们已经发现问题并正在处理中。」；nodata=「状态未知/没有采集到数据。」），图标与 mock 的 `icons` 数组一致。签名：`StatusBanner({ status, downCount })`。

- [ ] **Step 1: 写失败测试 UptimeBar.test.tsx**

```tsx
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import UptimeBar from './UptimeBar'
import type { Bar } from '../lib/types'

const bars90: Bar[] = Array.from({ length: 90 }, (_, i) => ({ t: i, s: i === 89 ? 3 : 0 }))

describe('UptimeBar geometry (mirrors mock)', () => {
  it('renders one rect per bar inside a 668-wide viewBox', () => {
    const { container } = render(<UptimeBar bars={bars90} theme="light" />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('viewBox')).toBe('0 0 668 16')
    expect(svg.querySelectorAll('rect').length).toBe(90)
  })

  it('90 bars: step 7.42, width 5.08 (668/90 - 2.34)', () => {
    const { container } = render(<UptimeBar bars={bars90} theme="light" />)
    const first = container.querySelector('rect')!
    expect(first.getAttribute('x')).toBe('0.00')
    expect(Number(first.getAttribute('width'))).toBeCloseTo(668 / 90 - 2.34, 2)
  })

  it('24 bars use gap 6 and min width 4', () => {
    const bars24: Bar[] = Array.from({ length: 24 }, (_, i) => ({ t: i, s: 0 }))
    const { container } = render(<UptimeBar bars={bars24} theme="light" />)
    const first = container.querySelector('rect')!
    expect(Number(first.getAttribute('width'))).toBeCloseTo(668 / 24 - 6, 2)
  })

  it('colors last bar down-red and others green', () => {
    const { container } = render(<UptimeBar bars={bars90} theme="light" />)
    const rects = container.querySelectorAll('rect')
    expect(rects[0]!.getAttribute('fill')).toBe('#24c19a')
    expect(rects[89]!.getAttribute('fill')).toBe('#f87171')
  })
})
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd web && bunx vitest run src/components`
Expected: FAIL。

- [ ] **Step 3: 实现 UptimeBar.tsx**

```tsx
import { colorOf } from '../lib/status-color'
import type { Bar } from '../lib/types'

export interface UptimeBarProps {
  bars: Bar[]
  theme: 'light' | 'dark'
  onHover?: (bar: Bar, rect: DOMRect) => void
  onLeave?: () => void
}

export default function UptimeBar({ bars, theme, onHover, onLeave }: UptimeBarProps) {
  const n = bars.length
  const step = 668 / n
  const gap = n >= 90 ? 2.34 : n >= 30 ? 5 : 6
  const w = Math.max(4, step - gap)
  return (
    <svg viewBox="0 0 668 16" width="100%" height={16} preserveAspectRatio="none" onMouseLeave={onLeave}>
      {bars.map((b, i) => (
        <rect
          key={i}
          x={(i * step).toFixed(2)}
          y={0}
          width={w.toFixed(2)}
          height={16}
          rx={1}
          fill={colorOf(b.s, theme)}
          onMouseEnter={(e) => onHover?.(b, e.currentTarget.getBoundingClientRect())}
        />
      ))}
    </svg>
  )
}
```

- [ ] **Step 4: 实现 BarTooltip.tsx**

```tsx
export interface TipState { x: number; y: number; title: string; line1: string; line2: string }

export default function BarTooltip({ tip }: { tip: TipState | null }) {
  if (!tip) return null
  return (
    <div
      className="pointer-events-none fixed z-50 rounded-lg px-[11px] py-[9px] text-[11.5px] leading-[1.6] whitespace-nowrap shadow-[0_8px_24px_rgba(0,0,0,.18)]"
      style={{ left: tip.x, top: tip.y, transform: 'translate(-50%,-100%)', background: 'var(--fg)', color: 'var(--bg)' }}
    >
      <div className="mb-[2px] font-semibold">{tip.title}</div>
      <div className="opacity-75">{tip.line1}</div>
      <div className="opacity-75">{tip.line2}</div>
    </div>
  )
}
```

- [ ] **Step 5: 实现 RangeTabs.tsx / ThemeToggle.tsx / StatusBanner.tsx / Legend.tsx / StaleDataNotice.tsx**

`RangeTabs.tsx`:

```tsx
export default function RangeTabs<T extends string>({ value, onChange, ranges }: {
  value: T; onChange: (v: T) => void; ranges: Array<{ key: T; label: string }>
}) {
  return (
    <div className="flex gap-[2px] rounded-[9px] border p-[3px]" style={{ borderColor: 'var(--line)', background: 'var(--bg-sub)' }}>
      {ranges.map((r) => (
        <button
          key={r.key}
          onClick={() => onChange(r.key)}
          className="cursor-pointer rounded-md px-[11px] py-[5px] font-medium"
          style={{
            border: 0, fontFamily: 'inherit', fontSize: 12.5,
            background: value === r.key ? 'var(--card)' : 'transparent',
            color: value === r.key ? 'var(--fg)' : 'var(--fg-3)',
            boxShadow: value === r.key ? 'var(--shadow)' : 'none',
          }}
        >
          {r.label}
        </button>
      ))}
    </div>
  )
}
```

`ThemeToggle.tsx`（图标 = mock 的月亮 svg）:

```tsx
import { useTheme } from '../lib/theme'

export default function ThemeToggle() {
  const { toggle } = useTheme()
  return (
    <button
      onClick={toggle}
      title="切换深浅色"
      className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border hover:bg-[var(--bg-sub)]"
      style={{ borderColor: 'var(--line)', background: 'var(--card)', color: 'var(--fg-2)' }}
    >
      <svg width="15" height="15" viewBox="0 0 20 20" fill="none">
        <path d="M16 12.2A6.6 6.6 0 017.8 4a6.8 6.8 0 108.2 8.2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    </button>
  )
}
```

`StatusBanner.tsx`（文案/图标对照 mock 的 `titles/subs/icons`）:

```tsx
import type { EntityStatus } from '../lib/types'

const CHECK_ICON = 'M11 17l4 4 8-8'
const ALERT_ICON = 'M17 10v8M17 23.2v.1'

export default function StatusBanner({ status, downCount }: { status: EntityStatus; downCount: number }) {
  const meta =
    status === 'down'
      ? { title: downCount > 1 ? `${downCount} 个服务当前宕机` : '1 个服务当前宕机', sub: '我们已经发现问题并正在处理中。', color: '#f87171', icon: ALERT_ICON }
      : status === 'degraded'
        ? { title: '部分服务性能下降', sub: '部分服务出现闪断，重试后已恢复，可用性未中断。', color: '#fbbf24', icon: ALERT_ICON }
        : status === 'nodata'
          ? { title: '状态未知', sub: '没有采集到任何数据。', color: '#e4e4e7', icon: ALERT_ICON }
          : { title: '所有系统运行正常', sub: '我们目前没有发现任何问题。', color: '#24c19a', icon: CHECK_ICON }
  return (
    <div className="flex items-start gap-[14px] rounded-xl border p-[20px_22px]" style={{ borderColor: 'var(--line)', background: 'var(--card)', boxShadow: 'var(--shadow)' }}>
      <div className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-full">
        <svg width="34" height="34" viewBox="0 0 34 34" fill="none">
          <circle cx="17" cy="17" r="16" fill={meta.color} />
          <path d={meta.icon} stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <div className="flex flex-col gap-[3px]">
        <div className="font-semibold" style={{ fontSize: 18, letterSpacing: '-.01em' }}>{meta.title}</div>
        <div style={{ fontSize: 13.5, color: 'var(--fg-2)' }}>{meta.sub}</div>
      </div>
    </div>
  )
}
```

`Legend.tsx`:

```tsx
import { BAR_COLORS } from '../lib/status-color'

export default function Legend({ theme, updatedText }: { theme: 'light' | 'dark'; updatedText: string }) {
  const items = [
    { color: BAR_COLORS.up, label: '正常' },
    { color: BAR_COLORS.degraded, label: '闪断（重试后恢复）' },
    { color: BAR_COLORS.partial, label: '部分中断' },
    { color: BAR_COLORS.down, label: '离线' },
    { color: theme === 'dark' ? BAR_COLORS.nodataDark : BAR_COLORS.nodataLight, label: '无数据' },
  ]
  return (
    <div className="flex flex-wrap items-center gap-[18px]" style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>
      {items.map((l) => (
        <span key={l.label} className="flex items-center gap-1.5">
          <span className="h-[14px] w-[5px] rounded-[1px]" style={{ background: l.color }} />
          {l.label}
        </span>
      ))}
      <span className="ml-auto">{updatedText}</span>
    </div>
  )
}
```

`StaleDataNotice.tsx`:

```tsx
export default function StaleDataNotice({ lastUpdatedAt }: { lastUpdatedAt: number }) {
  const t = new Date(lastUpdatedAt)
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    <div className="rounded-lg border px-3 py-2" style={{ borderColor: '#fbbf24', background: 'rgba(251,191,36,.08)', color: 'var(--fg-2)', fontSize: 12.5 }}>
      数据可能已过期，最后更新于 {p(t.getHours())}:{p(t.getMinutes())}:{p(t.getSeconds())}
    </div>
  )
}
```

- [ ] **Step 6: 运行测试验证通过**

Run: `cd web && bunx vitest run src/components`
Expected: 4 pass。

- [ ] **Step 7: Commit**

```bash
git add web/src/components/
git commit -m "feat(web): uptime bar, tooltip, banner, tabs, toggle, legend components"
```

---

### Task 4: StatusPage（组行展开 + 轮询 + tooltip）

**Files:**
- Create: `web/src/pages/StatusPage.tsx`
- Create: `web/src/components/GroupRow.tsx`、`MonitorRow.tsx`

**Interfaces:**
- Consumes: `fetchStatus`、全部 Task 2/3 组件。
- Tooltip 内容生成规则（对照 mock 的 `onEnter`）：
  - 日条：title = `dayLabel(t)`；line1 = 「正常 N · 闪断 N · 离线 N」（全 0 时「无数据（服务未在运行）」）；line2 = 有 down 时「累计宕机 X」，否则（有效 slot 为 0 时「不计入可用率」，否则「当日 100% 可达」）。监控行的 tooltip 只显示该监控自己的 daily 行；组行 tooltip 需要成员对应位的聚合——实现上把 daily 明细随 bar 一起传进来（`BarWithMeta = Bar & { day?: {up,flaky,down,nodata} }`，组行 meta 为成员之和）。
  - slot 条（24h）：title = `timeLabel(t)`；line1/line2 按 mock：code0→「正常 · 首检成功」/「检查间隔 2 分钟」；code1→「闪断 · 重试后恢复」/「恢复用时 30 秒」（文案中的秒数用实际 interval/recovered 数据填：`检查间隔 X`、`恢复用时 X`，来自 slot meta）；code3→「离线 · 重试用尽」/「本间隔宕机 X」；code4→「无数据」/「该时段没有采集到数据」。
- 页头：site_title + ThemeToggle + 齿轮链接 `/admin`（mock 的 slider svg）。「系统状态」标题 + RangeTabs（labels：90 天 / 30 天 / 24 小时）。
- 底部：Legend（updatedText = `每 30 秒自动刷新 · 时区 {timezone}`）+ mock 的说明段（「每个记号代表一个检查间隔……」原文照抄）。
- 轮询：`useEffect` 30s `setInterval`；成功更新数据与 `lastUpdatedAt`；失败置 `stale=true`，不清空数据；页面顶部（banner 之上）渲染 StaleDataNotice。
- 组行点击切换展开；展开集合存 localStorage `uptime-open-groups`（组 id 数组；null 组用字符串 `"null"`）。
- 无分组监控项：后端已放进 `id: null` 的组（名为「未分组」），直接按组渲染即可。

- [ ] **Step 1: 实现 MonitorRow.tsx**

```tsx
import UptimeBar from './UptimeBar'
import { colorOf } from '../lib/status-color'
import { fmtPct } from '../lib/format'
import type { StatusMonitor } from '../lib/types'
import { Link } from 'react-router-dom'

export default function MonitorRow({ m, theme, range, onHover, onLeave }: {
  m: StatusMonitor & { currentColor: number }
  theme: 'light' | 'dark'
  range: '90d' | '30d' | '24h'
  onHover: (barIdx: number, rect: DOMRect, monitor: StatusMonitor) => void
  onLeave: () => void
}) {
  return (
    <div className="flex flex-col gap-[9px] border-t border-dashed py-[13px_0_15px]" style={{ borderColor: 'var(--line)', borderTopStyle: 'dashed' }}>
      <div className="flex items-center gap-[9px]">
        <span className="h-[7px] w-[7px] flex-none rounded-full" style={{ background: colorOf(m.currentColor, theme) }} />
        <Link to={`/m/${m.id}`} className="truncate font-medium hover:underline" style={{ fontSize: 13.5, color: 'var(--fg)' }}>{m.name}</Link>
        <span className="ml-auto flex flex-none items-center gap-[10px]">
          {m.flaky_count > 0 && (
            <span
              className="rounded-[20px] px-[7px] py-[2px]"
              style={{
                fontSize: 11.5, whiteSpace: 'nowrap',
                background: theme === 'dark' ? 'rgba(251,191,36,.14)' : '#fef3c7',
                color: theme === 'dark' ? '#fbbf24' : '#b45309',
              }}
            >
              {m.flaky_count} 次闪断
            </span>
          )}
          <span style={{ fontSize: 12.5, color: 'var(--fg-2)', fontVariantNumeric: 'tabular-nums' }}>{fmtPct(m.uptime)}</span>
        </span>
      </div>
      <UptimeBar
        bars={m.bars}
        theme={theme}
        onLeave={onLeave}
        onHover={(bar, rect) => onHover(m.bars.indexOf(bar), rect, m)}
      />
    </div>
  )
}
```

（`currentColor`：把后端实体 status 映射到 bar 色码：operational→0, degraded→1, down→3, nodata→4；由 StatusPage 计算后传入。）

- [ ] **Step 2: 实现 GroupRow.tsx**

```tsx
import UptimeBar from './UptimeBar'
import { colorOf } from '../lib/status-color'
import { fmtPct } from '../lib/format'
import type { StatusGroup } from '../lib/types'

export default function GroupRow({ g, theme, expanded, onToggle, onHover, onLeave, summary, rangeStartLabel }: {
  g: StatusGroup & { currentColor: number }
  theme: 'light' | 'dark'
  expanded: boolean
  onToggle: () => void
  onHover: (barIdx: number, rect: DOMRect, group: StatusGroup) => void
  onLeave: () => void
  summary: string
  rangeStartLabel: string
}) {
  return (
    <div className="border-t" style={{ borderColor: 'var(--line)' }}>
      <div onClick={onToggle} className="flex cursor-pointer flex-col gap-[11px] px-5 pt-4 pb-[14px] hover:bg-[var(--bg-sub)]">
        <div className="flex items-center gap-[10px]">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ color: 'var(--fg-3)', transform: `rotate(${expanded ? 90 : 0}deg)`, transition: 'transform .16s' }}>
            <path d="M4 2.5L8 6l-4 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="h-[9px] w-[9px] flex-none rounded-full" style={{ background: colorOf(g.currentColor, theme) }} />
          <span className="font-semibold whitespace-nowrap" style={{ fontSize: 14, letterSpacing: '-.005em' }}>{g.name}</span>
          <span style={{ fontSize: 12.5, color: 'var(--fg-3)' }}>{g.monitors.length} 个组件</span>
          <span className="ml-auto" style={{ fontSize: 12.5, color: 'var(--fg-2)', fontVariantNumeric: 'tabular-nums' }}>{fmtPct(g.uptime)} 可用</span>
        </div>
        <UptimeBar bars={g.bars} theme={theme} onLeave={onLeave} onHover={(bar, rect) => onHover(g.bars.indexOf(bar), rect, g)} />
        <div className="flex justify-between" style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>
          <span>{rangeStartLabel}</span>
          <span>{summary}</span>
          <span>现在</span>
        </div>
      </div>
    </div>
  )
}
```

（成员区由 StatusPage 在展开时渲染 `<div className="flex flex-col px-5 pb-1.5 pl-[30px]">` 包裹 MonitorRow 列表，与 mock 的 padding 一致。）

- [ ] **Step 3: 实现 StatusPage.tsx**

结构（完整代码，按 mock 布局组织）：

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchStatus } from '../lib/api'
import { useTheme } from '../lib/theme'
import { dayLabel, timeLabel, dur } from '../lib/format'
import type { StatusResponse, StatusGroup, StatusMonitor } from '../lib/types'
import ThemeToggle from '../components/ThemeToggle'
import RangeTabs from '../components/RangeTabs'
import StatusBanner from '../components/StatusBanner'
import GroupRow from '../components/GroupRow'
import MonitorRow from '../components/MonitorRow'
import Legend from '../components/Legend'
import BarTooltip, { type TipState } from '../components/BarTooltip'
import StaleDataNotice from '../components/StaleDataNotice'

type Range = '90d' | '30d' | '24h'
const RANGES: Array<{ key: Range; label: string }> = [
  { key: '90d', label: '90 天' }, { key: '30d', label: '30 天' }, { key: '24h', label: '24 小时' },
]
const OPEN_KEY = 'uptime-open-groups'
const statusToCode = (s: string) => (s === 'operational' ? 0 : s === 'degraded' ? 1 : s === 'down' ? 3 : 4)

export default function StatusPage() {
  const { theme } = useTheme()
  const [range, setRange] = useState<Range>('90d')
  const [data, setData] = useState<StatusResponse | null>(null)
  const [stale, setStale] = useState(false)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number>(Date.now())
  const [tip, setTip] = useState<TipState | null>(null)
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    try { return Object.fromEntries((JSON.parse(localStorage.getItem(OPEN_KEY) ?? '[]') as string[]).map((k) => [k, true])) }
    catch { return {} }
  })

  const load = useCallback(() => {
    fetchStatus(range)
      .then((d) => { setData(d); setStale(false); setLastUpdatedAt(Date.now()) })
      .catch(() => setStale(true))
  }, [range])

  useEffect(() => {
    load()
    const timer = setInterval(load, 30_000)
    return () => clearInterval(timer)
  }, [load])

  const toggleGroup = (id: number | null) => {
    setOpen((prev) => {
      const key = String(id)
      const next = { ...prev, [key]: !prev[key] }
      localStorage.setItem(OPEN_KEY, JSON.stringify(Object.keys(next).filter((k) => next[k])))
      return next
    })
  }

  // tooltip 文案（对照 mock onEnter 分支）
  const hoverGroupBar = (barIdx: number, rect: DOMRect, g: StatusGroup) => {
    const bars = g.bars
    const bar = bars[barIdx]
    if (!bar) return
    const x = rect.left + rect.width / 2, y = rect.top - 8
    if (range === '24h') {
      setTip({ x, y, title: timeLabel(bar.t), line1: groupSlotLine1(bar.s), line2: groupSlotLine2(bar.s, g) })
      return
    }
    const agg = g.monitors.reduce((a, m) => {
      const day = (m as StatusMonitor & { daily?: Array<{ up: number; flaky: number; down: number; nodata: number }> }).daily?.[barIdx]
      if (day) { a.up += day.up; a.flaky += day.flaky; a.down += day.down; a.nodata += day.nodata }
      return a
    }, { up: 0, flaky: 0, down: 0, nodata: 0 })
    const total = agg.up + agg.flaky + agg.down
    setTip({
      x, y, title: dayLabel(bar.t),
      line1: total === 0 ? '无数据（服务未在运行）' : `正常 ${agg.up} · 闪断 ${agg.flaky} · 离线 ${agg.down}`,
      line2: agg.down > 0 ? `累计宕机 ${dur(agg.down * 120)}` : total === 0 ? '不计入可用率' : '当日 100% 可达',
    })
  }
  // hoverMonitorBar 同理，只用单个 monitor 的数据
  // groupSlotLine1: 0→'正常 · 首检成功' 1→'闪断 · 重试后恢复' 3→'离线 · 重试用尽' 4→'无数据'
  // groupSlotLine2: 3→`本间隔宕机 ${intervalDesc}` 1→`恢复用时 …` 其余→`检查间隔 …`（组行无单一 interval，用「检查间隔」占位文案「—」或取第一个 monitor 的 interval；实现：取 g.monitors[0] 的 meta）

  const downCount = useMemo(() => data ? data.groups.flatMap((g) => g.monitors).filter((m) => m.status === 'down').length : 0, [data])

  if (!data) return null
  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)', color: 'var(--fg)', padding: '40px 20px 80px' }}>
      <div className="mx-auto flex max-w-[820px] flex-col gap-6">
        {stale && <StaleDataNotice lastUpdatedAt={lastUpdatedAt} />}

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-[10px]">
            <div className="flex h-[26px] w-[26px] items-center justify-center rounded-[7px]" style={{ background: '#24c19a' }}>
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none"><path d="M4.5 10.5l3.5 3.5 7.5-7.5" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
            <div className="font-semibold" style={{ fontSize: 16, letterSpacing: '-.01em' }}>{data.site_title}</div>
          </div>
          <div className="flex items-center gap-1.5">
            <ThemeToggle />
            <a href="/admin" title="管理" className="flex h-8 w-8 items-center justify-center rounded-lg border" style={{ borderColor: 'var(--line)', background: 'var(--card)', color: 'var(--fg-2)' }}>
              <svg width="15" height="15" viewBox="0 0 20 20" fill="none">
                <path d="M3 6h14M3 14h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <circle cx="7.5" cy="6" r="2.1" fill="var(--card)" stroke="currentColor" strokeWidth="1.5" />
                <circle cx="13" cy="14" r="2.1" fill="var(--card)" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </a>
          </div>
        </div>

        <StatusBanner status={data.overall} downCount={downCount} />

        <div className="mt-2 flex items-center justify-between">
          <div className="font-semibold" style={{ fontSize: 15 }}>系统状态</div>
          <RangeTabs value={range} onChange={(r) => { setRange(r); setTip(null) }} ranges={RANGES} />
        </div>

        <div className="overflow-hidden rounded-xl border" style={{ borderColor: 'var(--line)', background: 'var(--card)', boxShadow: 'var(--shadow)' }}>
          {data.groups.map((g) => (
            <div key={String(g.id)}>
              <GroupRow
                g={{ ...g, currentColor: statusToCode(g.status) }}
                theme={theme}
                expanded={!!open[String(g.id)]}
                onToggle={() => toggleGroup(g.id)}
                onHover={hoverGroupBar}
                onLeave={() => setTip(null)}
                summary={groupSummary(g)}
                rangeStartLabel={range === '24h' ? '3 小时前（每条 = 1 个检查间隔）' : range === '30d' ? '30 天前' : '90 天前'}
              />
              {open[String(g.id)] && (
                <div className="flex flex-col px-5 pb-1.5 pl-[30px]">
                  {g.monitors.map((m) => (
                    <MonitorRow key={m.id} m={{ ...m, currentColor: statusToCode(m.status) }} theme={theme} range={range} onHover={hoverMonitorBar} onLeave={() => setTip(null)} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        <Legend theme={theme} updatedText={`每 30 秒自动刷新 · 时区 ${data.timezone}`} />

        <div style={{ fontSize: 11.5, color: 'var(--fg-3)', lineHeight: 1.7, borderTop: '1px solid var(--line)', paddingTop: 16 }}>
          每个记号代表一个检查间隔，间隔内的重试不单独计入 —— 记号密度恒等于检查间隔。灰色缺口表示该时段没有采集到数据，不计入可用率分母。
        </div>
      </div>
      <BarTooltip tip={tip} />
    </div>
  )
}
```

实现注意（必须做到，不留 TODO）：
- `hoverMonitorBar`：与 `hoverGroupBar` 同结构，日条只用该 monitor 的 `daily` 行；24h 用该 monitor 的 slot meta（interval_s、recovered_after_s 来自后端 bars 扩展字段——见下方 Step 4 的后端小改动）。
- `groupSummary(g)`：mock 逻辑——范围内 flaky 总数 > 0 时「范围内 N 次闪断」；否则有 down 时「累计宕机 X」（down_seconds = Σ down 条数 × interval，组行用 `g.monitors` 的 bars 里 s===3 的数量 × 120 近似即可，或后端补字段；此处采用后端字段：见 Step 4）；否则「无异常」。
- 组行/监控行的 tooltip 需要 **每个 bar 位置对应的明细**。为此对 API 做一个向后兼容的小扩展（下一步）。

- [ ] **Step 4: 后端小改：status 响应附带 tooltip 明细（向后兼容）**

Modify: `server/src/api/aggregate.ts`、`server/src/api/status.ts` 及其测试。
- `MonitorSeriesInput.daily` 已有明细；在 `buildStatusPayload` 输出的每个 monitor 对象上追加 `daily: Array<{up,flaky,down,nodata}>`（90d/30d 时按 bars 顺序对齐，缺的天补零值）与 `interval_s: number`；24h 时追加 `slots_meta: Array<{ interval_s: number; recovered_after_s: number | null } | null>`（与 bars 同序）。
- 组对象追加 `down_seconds: number`（成员 Σ down bar 数 × interval_s）。
- 同步更新 `aggregate.test.ts` 的断言（新字段存在性检查即可）。

Run: `cd server && bun test src/api/`
Expected: 全绿。

Commit: `git add server/src/api/ && git commit -m "feat(api): include per-bar tooltip detail in status payload"`

- [ ] **Step 5: 联调与视觉验收**

Run: 后端 `cd server && DATA_DIR=/tmp/uptime-dev PORT=3000 bun run src/index.ts`（另开终端），前端 `cd web && bun run dev`（Vite 默认 5173）。
打开 `http://localhost:5173/`，对照浏览器中直接打开的 `web/mock/Status.dc.html` 检查：头部、横幅、tabs、组条、展开成员、图例、说明文字、暗色切换。数据为空时应显示「未分组 / 0 个组件」的空态而非崩溃。

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/StatusPage.tsx web/src/components/GroupRow.tsx web/src/components/MonitorRow.tsx
git commit -m "feat(web): status page with polling, group expand, tooltips"
```

---

### Task 5: MonitorDetailPage（延迟折线 + slot 表格）

**Files:**
- Create: `web/src/pages/MonitorDetailPage.tsx`

**Interfaces:**
- Consumes: `fetchTimeseries(id, range)`、`UptimeBar`、Recharts。
- 布局：返回链接 `← 返回状态页`（`/`）；监控名 + target + 当前状态点；RangeTabs（24h/7d/30d）；24 小时条形图（`slots` → bars：`slotBarColor` 映射，缺失位置 nodata，几何同状态页）；**延迟折线**：Recharts `<LineChart>`，两条线 p50/p95（数据源：range=24h 时用 slots 的 `latency_ms` 画单线；7d/30d 用 daily 的 `latency_p50/p95`）；证书到期：若任一 slot 有 `cert_days_left`，显示「证书剩余 N 天」（<30 天橙色，<7 天红色）；近期 slot 表格：时间 / 状态 / 耗时 / 重试次数 / 错误，倒序最多 50 行。
- 样式：卡片容器与状态页一致（border line, radius 12, card bg, shadow）。折线颜色：p50 `#24c19a`，p95 `#fbbf24`；网格线 `var(--line)`；坐标轴文字 11px `var(--fg-3)`。

- [ ] **Step 1: 实现页面**

```tsx
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { LineChart, Line, XAxis, YAxis, Tooltip as RTooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { fetchTimeseries } from '../lib/api'
import { useTheme } from '../lib/theme'
import { timeLabel, fmtPct } from '../lib/format'
import UptimeBar from '../components/UptimeBar'
import RangeTabs from '../components/RangeTabs'
import { colorOf } from '../lib/status-color'
import type { TimeseriesResponse } from '../lib/types'

type Range = '24h' | '7d' | '30d'
const RANGES: Array<{ key: Range; label: string }> = [
  { key: '24h', label: '24 小时' }, { key: '7d', label: '7 天' }, { key: '30d', label: '30 天' },
]
const SLOT_STATUS_TEXT = ['正常', '闪断', '离线'] as const

export default function MonitorDetailPage() {
  const { id } = useParams()
  const { theme } = useTheme()
  const [range, setRange] = useState<Range>('24h')
  const [data, setData] = useState<TimeseriesResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchTimeseries(Number(id), range).then(setData).catch((e) => setError(String(e.message)))
  }, [id, range])

  if (error) return <div className="p-10 text-center" style={{ color: 'var(--fg-2)' }}>加载失败：{error}</div>
  if (!data) return null

  const intervalS = data.monitor.interval_s
  const count = range === '24h' ? Math.floor(86400 / intervalS) : 0
  const bars = range === '24h'
    ? (() => {
        const byStart = new Map(data.slots.map((s) => [s.started_at, s]))
        const latest = Math.floor(Date.now() / 1000 / intervalS) * intervalS
        return Array.from({ length: count }, (_, i) => {
          const t = latest - (count - 1 - i) * intervalS
          const row = byStart.get(t)
          return { t, s: row ? (row.status === 0 ? 0 : row.status === 1 ? 1 : 3) : 4 }
        })
      })()
    : data.daily.map((d) => {
        const n = d.up + d.flaky + d.down
        return { t: Date.parse(d.day) / 1000, s: n === 0 ? 4 : d.down === 0 ? (d.flaky === 0 ? 0 : 1) : d.down / n < 0.05 ? 2 : 3 }
      })

  const cert = data.slots.find((s) => s.cert_days_left !== null)?.cert_days_left ?? data.slots.at(-1)?.cert_days_left ?? null
  const chartData = range === '24h'
    ? data.slots.filter((s) => s.latency_ms !== null).map((s) => ({ t: timeLabel(s.started_at), p50: s.latency_ms }))
    : data.daily.filter((d) => d.latency_p50 !== null).map((d) => ({ t: d.day.slice(5), p50: d.latency_p50, p95: d.latency_p95 }))

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)', color: 'var(--fg)', padding: '40px 20px 80px' }}>
      <div className="mx-auto flex max-w-[820px] flex-col gap-6">
        <Link to="/" className="w-fit" style={{ fontSize: 12.5, color: 'var(--fg-3)' }}>← 返回状态页</Link>

        <div className="flex items-center gap-[10px]">
          <span className="h-[9px] w-[9px] rounded-full" style={{ background: colorOf(bars[bars.length - 1]?.s ?? 4, theme) }} />
          <span className="font-semibold" style={{ fontSize: 16 }}>{data.monitor.name}</span>
          <span style={{ fontSize: 12.5, color: 'var(--fg-3)', fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace' }}>{data.monitor.target}</span>
          {cert !== null && (
            <span className="ml-auto rounded-[20px] px-[7px] py-[2px]" style={{ fontSize: 11.5, color: cert < 7 ? '#dc2625' : cert < 30 ? '#d97706' : 'var(--fg-2)', background: 'var(--bg-sub)' }}>
              证书剩余 {cert} 天
            </span>
          )}
        </div>

        <div className="flex items-center justify-between">
          <div className="font-semibold" style={{ fontSize: 15 }}>检查记录</div>
          <RangeTabs value={range} onChange={setRange} ranges={RANGES} />
        </div>

        <div className="flex flex-col gap-4 rounded-xl border p-[20px_22px]" style={{ borderColor: 'var(--line)', background: 'var(--card)', boxShadow: 'var(--shadow)' }}>
          <UptimeBar bars={bars} theme={theme} />
          <div className="h-[220px]">
            <ResponsiveContainer>
              <LineChart data={chartData}>
                <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="t" tick={{ fontSize: 11, fill: 'var(--fg-3)' }} minTickGap={40} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--fg-3)' }} width={44} axisLine={false} tickLine={false} unit="ms" />
                <RTooltip contentStyle={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12 }} />
                <Line type="monotone" dataKey="p50" name="p50" stroke="#24c19a" dot={false} strokeWidth={1.5} />
                <Line type="monotone" dataKey="p95" name="p95" stroke="#fbbf24" dot={false} strokeWidth={1.5} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border" style={{ borderColor: 'var(--line)', background: 'var(--card)', boxShadow: 'var(--shadow)' }}>
          <table className="w-full" style={{ fontSize: 12.5 }}>
            <thead>
              <tr style={{ color: 'var(--fg-3)', borderBottom: '1px solid var(--line)' }}>
                <th className="px-4 py-2.5 text-left font-medium">时间</th>
                <th className="px-4 py-2.5 text-left font-medium">状态</th>
                <th className="px-4 py-2.5 text-right font-medium">耗时</th>
                <th className="px-4 py-2.5 text-right font-medium">尝试</th>
                <th className="px-4 py-2.5 text-left font-medium">错误</th>
              </tr>
            </thead>
            <tbody>
              {[...data.slots].reverse().slice(0, 50).map((s) => (
                <tr key={s.started_at} style={{ borderTop: '1px solid var(--line)' }}>
                  <td className="px-4 py-2" style={{ fontVariantNumeric: 'tabular-nums' }}>{timeLabel(s.started_at)}</td>
                  <td className="px-4 py-2" style={{ color: colorOf(s.status === 0 ? 0 : s.status === 1 ? 1 : 3, theme) }}>{SLOT_STATUS_TEXT[s.status]}</td>
                  <td className="px-4 py-2 text-right">{s.latency_ms === null ? '—' : `${s.latency_ms} ms`}</td>
                  <td className="px-4 py-2 text-right">{s.attempts}</td>
                  <td className="px-4 py-2" style={{ color: 'var(--fg-3)' }}>{s.error ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 联调验收**

后端造数据（`/api/admin` 建一个 http 监控指向 `https://example.com` 并等几个 slot，或用 sqlite CLI 直接插行），浏览器打开 `/m/1`，确认条形图、折线、表格渲染；无数据时表格显示空态。

Run: `cd web && bunx vitest run && bun run build`
Expected: 全绿、构建成功。

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/MonitorDetailPage.tsx
git commit -m "feat(web): monitor detail page with latency chart and slot table"
```

---

## 计划 04 验收清单

- `cd web && bunx vitest run`：status-color、format、UptimeBar 测试全绿。
- `cd web && bun run build` 成功。
- `cd server && bun test` 仍全绿（含 aggregate 新字段断言）。
- 浏览器对照 `web/mock/Status.dc.html`：色值、几何、文案一致；暗色模式切换持久化；断网（停后端）时页面保留旧数据并出现黄色提示条。
- `web/mock/` 未被改动。
