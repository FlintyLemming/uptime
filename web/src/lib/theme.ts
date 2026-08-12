import { useCallback, useEffect, useState } from 'react'

const KEY = 'uptime-theme'
// ThemeToggle 与页面各自持有 useTheme 实例：切换时广播事件，让同页其他
// 消费者（状态页的条形图/图例颜色）立即跟随，而不是等下次轮询重渲染。
const CHANGE_EVENT = 'uptime-theme-change'
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
  useEffect(() => {
    const sync = () => setTheme(currentTheme())
    window.addEventListener(CHANGE_EVENT, sync)
    return () => window.removeEventListener(CHANGE_EVENT, sync)
  }, [])
  const toggle = useCallback(() => {
    setTheme((t) => {
      const next = t === 'light' ? 'dark' : 'light'
      localStorage.setItem(KEY, next)
      window.dispatchEvent(new Event(CHANGE_EVENT))
      return next
    })
  }, [])
  return { theme, toggle }
}
