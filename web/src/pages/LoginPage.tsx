import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { authApi } from '../lib/admin-api'

export default function LoginPage() {
  const nav = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await authApi.login(username, password)
      nav('/admin')
    } catch (err) {
      setError(err instanceof Error && err.message === '429' ? '失败次数过多，请 15 分钟后重试' : '用户名或密码错误')
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center" style={{ background: 'var(--bg)' }}>
      <form onSubmit={submit} className="flex w-[360px] flex-col gap-4 rounded-xl border p-8" style={{ borderColor: 'var(--line)', background: 'var(--card)', boxShadow: 'var(--shadow)' }}>
        <div className="font-semibold" style={{ fontSize: 16 }}>登录管理</div>
        {error && <div style={{ fontSize: 12.5, color: '#dc2625' }}>{error}</div>}
        <label className="flex flex-col gap-1" style={{ fontSize: 12.5, color: 'var(--fg-2)' }}>
          用户名
          <input value={username} onChange={(e) => setUsername(e.target.value)} className="rounded-lg border px-3 py-2" style={{ borderColor: 'var(--line)', background: 'var(--bg)', color: 'var(--fg)' }} />
        </label>
        <label className="flex flex-col gap-1" style={{ fontSize: 12.5, color: 'var(--fg-2)' }}>
          密码
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="rounded-lg border px-3 py-2" style={{ borderColor: 'var(--line)', background: 'var(--bg)', color: 'var(--fg)' }} />
        </label>
        <button type="submit" className="cursor-pointer rounded-lg py-2 font-medium" style={{ background: '#24c19a', color: '#fff', fontSize: 13.5 }}>登录</button>
      </form>
    </div>
  )
}
