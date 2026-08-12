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
