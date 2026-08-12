import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { authApi } from '../lib/admin-api'

export default function SetupPage() {
  const nav = useNavigate()
  const [checking, setChecking] = useState(true)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    authApi.setupStatus()
      .then((s) => {
        if (s.hasUser) nav('/login', { replace: true })
        else setChecking(false)
      })
      .catch(() => setChecking(false))
  }, [nav])

  if (checking) return null

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username.trim()) {
      setError('请输入用户名')
      return
    }
    if (password.length < 8) {
      setError('密码至少 8 位')
      return
    }
    if (password !== confirm) {
      setError('两次输入的密码不一致')
      return
    }
    try {
      await authApi.setup(username, password)
      nav('/admin')
    } catch (err) {
      setError(err instanceof Error && err.message === '409' ? '已完成初始化，请直接登录' : '初始化失败，请重试')
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center" style={{ background: 'var(--bg)' }}>
      <form onSubmit={submit} className="flex w-[360px] flex-col gap-4 rounded-xl border p-8" style={{ borderColor: 'var(--line)', background: 'var(--card)', boxShadow: 'var(--shadow)' }}>
        <div className="font-semibold" style={{ fontSize: 16 }}>首次设置</div>
        <div style={{ fontSize: 12.5, color: 'var(--fg-3)' }}>创建管理员账号后即可登录使用。</div>
        {error && <div style={{ fontSize: 12.5, color: '#dc2625' }}>{error}</div>}
        <label className="flex flex-col gap-1" style={{ fontSize: 12.5, color: 'var(--fg-2)' }}>
          用户名
          <input value={username} onChange={(e) => setUsername(e.target.value)} className="rounded-lg border px-3 py-2" style={{ borderColor: 'var(--line)', background: 'var(--bg)', color: 'var(--fg)' }} />
        </label>
        <label className="flex flex-col gap-1" style={{ fontSize: 12.5, color: 'var(--fg-2)' }}>
          密码（至少 8 位）
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="rounded-lg border px-3 py-2" style={{ borderColor: 'var(--line)', background: 'var(--bg)', color: 'var(--fg)' }} />
        </label>
        <label className="flex flex-col gap-1" style={{ fontSize: 12.5, color: 'var(--fg-2)' }}>
          确认密码
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="rounded-lg border px-3 py-2" style={{ borderColor: 'var(--line)', background: 'var(--bg)', color: 'var(--fg)' }} />
        </label>
        <button type="submit" className="cursor-pointer rounded-lg py-2 font-medium" style={{ background: '#24c19a', color: '#fff', fontSize: 13.5 }}>创建账号</button>
      </form>
    </div>
  )
}
