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
