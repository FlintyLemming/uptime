import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { authApi } from '../../lib/admin-api'

const NAV = [
  { to: '/admin', label: '监控项', end: true },
  { to: '/admin/groups', label: '分组' },
  { to: '/admin/webhooks', label: 'Webhook' },
  { to: '/admin/settings', label: '设置' },
]

export default function AdminLayout() {
  const nav = useNavigate()
  const [state, setState] = useState<'loading' | 'ok' | 'unauthorized'>('loading')

  useEffect(() => {
    authApi.me().then(() => setState('ok')).catch(() => setState('unauthorized'))
  }, [])

  useEffect(() => { if (state === 'unauthorized') nav('/login', { replace: true }) }, [state, nav])

  if (state !== 'ok') return null
  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)', color: 'var(--fg)' }}>
      <div className="mx-auto flex max-w-[1040px] gap-8 px-5 py-10">
        <aside className="flex w-40 flex-none flex-col gap-1">
          <Link to="/" style={{ fontSize: 12.5, color: 'var(--fg-3)' }}>← 状态页</Link>
          <div className="my-2 font-semibold" style={{ fontSize: 15 }}>管理</div>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className="rounded-lg px-3 py-2" style={({ isActive }) => ({ fontSize: 13.5, color: isActive ? 'var(--fg)' : 'var(--fg-2)', background: isActive ? 'var(--bg-sub)' : 'transparent' })}>
              {n.label}
            </NavLink>
          ))}
          <button
            onClick={() => authApi.logout().then(() => nav('/login'))}
            className="mt-auto cursor-pointer rounded-lg px-3 py-2 text-left"
            style={{ fontSize: 13.5, color: 'var(--fg-3)' }}
          >
            退出登录
          </button>
        </aside>
        <main className="min-w-0 flex-1"><Outlet /></main>
      </div>
    </div>
  )
}
