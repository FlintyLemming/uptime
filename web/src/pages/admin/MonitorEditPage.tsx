import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { monitorsApi, groupsApi } from '../../lib/admin-api'
import EffectiveRetriesHint from '../../components/admin/EffectiveRetriesHint'
import MonitorTypeFields from '../../components/admin/MonitorTypeFields'
import { timeoutViolatesBudget } from '../../lib/effective-retries'

const DEFAULTS = {
  name: '', type: 'http', target: '', port: null as number | null, group_id: null as number | null,
  interval_s: 60, retry_interval_s: 20, max_retries: 3, timeout_ms: 10000, active: 1, config: {} as Record<string, unknown>,
}

const INPUT = 'rounded-lg border px-3 py-2'
const inputStyle = { borderColor: 'var(--line)', background: 'var(--bg)', color: 'var(--fg)', fontSize: 13.5 }

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1" style={{ fontSize: 12.5, color: 'var(--fg-2)' }}>
      {label}
      {children}
    </label>
  )
}

export default function MonitorEditPage() {
  const { id } = useParams()
  const nav = useNavigate()
  const isNew = !id
  const [form, setForm] = useState(DEFAULTS)
  const [groups, setGroups] = useState<Array<{ id: number; name: string }>>([])
  const [errors, setErrors] = useState<string[]>([])

  useEffect(() => { groupsApi.list().then(setGroups).catch(() => {}) }, [])
  useEffect(() => {
    if (isNew) return
    monitorsApi.list().then((list) => {
      const m = list.find((x) => x.id === Number(id))
      if (m) setForm({ name: m.name, type: m.type, target: m.target, port: m.port, group_id: m.group_id, interval_s: m.interval_s, retry_interval_s: m.retry_interval_s, max_retries: m.max_retries, timeout_ms: m.timeout_ms, active: m.active, config: m.config })
    })
  }, [id, isNew])

  const set = <K extends keyof typeof DEFAULTS>(k: K, v: (typeof DEFAULTS)[K]) => setForm((f) => ({ ...f, [k]: v }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (timeoutViolatesBudget(form.timeout_ms, form.retry_interval_s)) {
      setErrors(['超时时间必须小于重试间隔'])
      return
    }
    const body = { ...form, sort_order: 0 }
    try {
      if (isNew) await monitorsApi.create(body)
      else await monitorsApi.update(Number(id), body)
      nav('/admin')
    } catch (err) {
      setErrors((err as { errors?: string[] }).errors ?? ['保存失败'])
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5 rounded-xl border p-6" style={{ borderColor: 'var(--line)', background: 'var(--card)', boxShadow: 'var(--shadow)' }}>
      <div className="font-semibold" style={{ fontSize: 15 }}>{isNew ? '新建监控项' : '编辑监控项'}</div>
      {errors.length > 0 && (
        <div className="rounded-lg px-3 py-2" style={{ background: 'rgba(220,38,37,.08)', fontSize: 12.5, color: '#dc2625' }}>
          {errors.map((e) => <div key={e}>{e}</div>)}
        </div>
      )}
      {/* 通用字段 */}
      <Field label="名称"><input value={form.name} onChange={(e) => set('name', e.target.value)} className={INPUT} style={inputStyle} /></Field>
      <Field label="类型">
        <select value={form.type} onChange={(e) => set('type', e.target.value)} className={INPUT} style={inputStyle}>
          <option value="http">HTTP</option><option value="tcp">TCP</option><option value="ping">Ping</option><option value="dns">DNS</option>
        </select>
      </Field>
      <Field label={form.type === 'http' ? 'URL' : form.type === 'dns' ? '域名' : '主机'}>
        <input value={form.target} onChange={(e) => set('target', e.target.value)} className={INPUT} style={inputStyle} placeholder={form.type === 'http' ? 'https://example.com' : 'example.com'} />
      </Field>
      {form.type === 'tcp' && (
        <Field label="端口"><input type="number" value={form.port ?? ''} onChange={(e) => set('port', e.target.value === '' ? null : Number(e.target.value))} className={INPUT} style={inputStyle} /></Field>
      )}
      <Field label="分组">
        <select value={form.group_id ?? ''} onChange={(e) => set('group_id', e.target.value === '' ? null : Number(e.target.value))} className={INPUT} style={inputStyle}>
          <option value="">未分组</option>
          {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="检查间隔（秒）"><input type="number" value={form.interval_s} onChange={(e) => set('interval_s', Number(e.target.value))} className={INPUT} style={inputStyle} /></Field>
        <Field label="重试间隔（秒）"><input type="number" value={form.retry_interval_s} onChange={(e) => set('retry_interval_s', Number(e.target.value))} className={INPUT} style={inputStyle} /></Field>
        <Field label="最大重试次数"><input type="number" value={form.max_retries} onChange={(e) => set('max_retries', Number(e.target.value))} className={INPUT} style={inputStyle} /></Field>
        <Field label="超时（毫秒）"><input type="number" value={form.timeout_ms} onChange={(e) => set('timeout_ms', Number(e.target.value))} className={INPUT} style={inputStyle} /></Field>
      </div>
      <EffectiveRetriesHint intervalS={form.interval_s} retryIntervalS={form.retry_interval_s} maxRetries={form.max_retries} timeoutMs={form.timeout_ms} />
      <MonitorTypeFields type={form.type} config={form.config} onChange={(patch) => set('config', { ...form.config, ...patch })} />
      <div className="flex gap-2">
        <button type="submit" className="cursor-pointer rounded-lg px-4 py-2 font-medium" style={{ background: '#24c19a', color: '#fff', fontSize: 13.5 }}>保存</button>
        <button type="button" onClick={() => nav('/admin')} className="cursor-pointer rounded-lg border px-4 py-2" style={{ borderColor: 'var(--line)', fontSize: 13.5, color: 'var(--fg-2)' }}>取消</button>
      </div>
    </form>
  )
}
