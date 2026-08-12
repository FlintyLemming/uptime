import { useCallback, useEffect, useState } from 'react'
import { webhooksApi, monitorsApi, type WebhookDto, type MonitorDto } from '../../lib/admin-api'
import WebhookTestButton from '../../components/admin/WebhookTestButton'

const DEFAULT_BODY_TEMPLATE = `{
  "event": "{{event}}",
  "monitor": "{{monitor_name}}",
  "target": "{{target}}",
  "error": "{{error}}",
  "time": "{{slot_started_at}}",
  "url": "{{url}}"
}`

const INPUT = 'rounded-lg border px-3 py-2'
const inputStyle = { borderColor: 'var(--line)', background: 'var(--bg)', color: 'var(--fg)', fontSize: 13.5 }

interface Draft {
  id: number | null
  name: string
  url: string
  method: string
  headersText: string
  bodyTemplate: string
  enabled: number
  monitorIds: number[]
  allMonitors: boolean
}

function emptyDraft(): Draft {
  return { id: null, name: '', url: '', method: 'POST', headersText: '', bodyTemplate: DEFAULT_BODY_TEMPLATE, enabled: 1, monitorIds: [], allMonitors: true }
}

function draftFromWebhook(w: WebhookDto): Draft {
  return {
    id: w.id, name: w.name, url: w.url, method: w.method,
    headersText: Object.entries(w.headers).map(([k, v]) => `${k}: ${v}`).join('\n'),
    bodyTemplate: w.body_template, enabled: w.enabled,
    monitorIds: w.monitor_ids ?? [], allMonitors: w.monitor_ids === null,
  }
}

function headersFromText(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const idx = line.indexOf(':')
    if (idx <= 0) continue
    const k = line.slice(0, idx).trim()
    const v = line.slice(idx + 1).trim()
    if (k) out[k] = v
  }
  return out
}

function toBody(d: Draft) {
  return {
    name: d.name, url: d.url, method: d.method, headers: headersFromText(d.headersText),
    body_template: d.bodyTemplate, enabled: d.enabled,
    monitor_ids: d.allMonitors ? null : d.monitorIds,
  }
}

export default function WebhooksPage() {
  const [webhooks, setWebhooks] = useState<WebhookDto[]>([])
  const [monitors, setMonitors] = useState<MonitorDto[]>([])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [errors, setErrors] = useState<string[]>([])

  const load = useCallback(() => {
    webhooksApi.list().then(setWebhooks).catch(() => {})
    monitorsApi.list().then(setMonitors).catch(() => {})
  }, [])
  useEffect(() => { load() }, [load])

  const save = async () => {
    if (!draft) return
    const body = toBody(draft)
    try {
      if (draft.id === null) await webhooksApi.create(body)
      else await webhooksApi.update(draft.id, body)
      setDraft(null)
      setErrors([])
      load()
    } catch (err) {
      setErrors((err as { errors?: string[] }).errors ?? ['保存失败'])
    }
  }

  const toggle = (w: WebhookDto) => {
    webhooksApi.update(w.id, { ...w, enabled: w.enabled ? 0 : 1 }).then(load)
  }

  const remove = (w: WebhookDto) => {
    if (!confirm(`删除 Webhook「${w.name}」？`)) return
    webhooksApi.remove(w.id).then(load)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="font-semibold" style={{ fontSize: 15 }}>Webhook（{webhooks.length}）</div>
        <button className="cursor-pointer rounded-lg px-3 py-1.5 font-medium" style={{ background: '#24c19a', color: '#fff', fontSize: 13 }}
          onClick={() => { setDraft(emptyDraft()); setErrors([]) }}>
          新建 Webhook
        </button>
      </div>
      <div className="overflow-hidden rounded-xl border" style={{ borderColor: 'var(--line)', background: 'var(--card)', boxShadow: 'var(--shadow)' }}>
        {webhooks.length === 0 && <div className="px-5 py-8 text-center" style={{ fontSize: 13, color: 'var(--fg-3)' }}>还没有 Webhook，点右上角新建。</div>}
        {webhooks.map((w) => (
          <div key={w.id} className="flex items-center gap-3 border-t px-4 py-3" style={{ borderColor: 'var(--line)' }}>
            <span className="h-2 w-2 rounded-full" style={{ background: w.enabled ? '#24c19a' : 'var(--line)' }} />
            <button className="font-medium hover:underline text-left" style={{ fontSize: 13.5 }} onClick={() => { setDraft(draftFromWebhook(w)); setErrors([]) }}>{w.name}</button>
            <span style={{ fontSize: 11.5, color: 'var(--fg-3)', fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace' }}>{w.method} · {w.url}</span>
            <span className="ml-auto flex items-center gap-2">
              <WebhookTestButton id={w.id} />
              <button className="cursor-pointer rounded-md border px-2 py-1" style={{ fontSize: 11.5, borderColor: 'var(--line)', color: 'var(--fg-2)' }}
                onClick={() => toggle(w)}>
                {w.enabled ? '停用' : '启用'}
              </button>
              <button className="cursor-pointer rounded-md border px-2 py-1" style={{ fontSize: 11.5, borderColor: 'var(--line)', color: '#dc2625' }}
                onClick={() => remove(w)}>删除</button>
            </span>
          </div>
        ))}
      </div>

      {draft && (
        <div className="fixed inset-0 z-10 flex items-center justify-center" style={{ background: 'rgba(15,23,42,.4)' }}>
          <div className="flex max-h-[85vh] w-[560px] flex-col gap-4 overflow-y-auto rounded-xl border p-6" style={{ borderColor: 'var(--line)', background: 'var(--card)', boxShadow: 'var(--shadow)' }}>
            <div className="font-semibold" style={{ fontSize: 15 }}>{draft.id === null ? '新建 Webhook' : '编辑 Webhook'}</div>
            {errors.length > 0 && (
              <div className="rounded-lg px-3 py-2" style={{ background: 'rgba(220,38,37,.08)', fontSize: 12.5, color: '#dc2625' }}>
                {errors.map((e) => <div key={e}>{e}</div>)}
              </div>
            )}
            <label className="flex flex-col gap-1" style={{ fontSize: 12.5, color: 'var(--fg-2)' }}>
              名称
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={INPUT} style={inputStyle} />
            </label>
            <label className="flex flex-col gap-1" style={{ fontSize: 12.5, color: 'var(--fg-2)' }}>
              URL
              <input value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} className={INPUT} style={inputStyle} placeholder="https://example.com/webhook" />
            </label>
            <label className="flex flex-col gap-1" style={{ fontSize: 12.5, color: 'var(--fg-2)' }}>
              请求方法
              <select value={draft.method} onChange={(e) => setDraft({ ...draft, method: e.target.value })} className={INPUT} style={inputStyle}>
                {['POST', 'PUT', 'PATCH'].map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1" style={{ fontSize: 12.5, color: 'var(--fg-2)' }}>
              请求头（每行 Key: Value）
              <textarea value={draft.headersText} onChange={(e) => setDraft({ ...draft, headersText: e.target.value })} rows={3} className={INPUT} style={inputStyle} />
            </label>
            <label className="flex flex-col gap-1" style={{ fontSize: 12.5, color: 'var(--fg-2)' }}>
              消息模板（支持 {'{{event}}'}、{'{{monitor_name}}'}、{'{{target}}'}、{'{{error}}'}、{'{{slot_started_at}}'}、{'{{url}}'} 等变量）
              <textarea value={draft.bodyTemplate} onChange={(e) => setDraft({ ...draft, bodyTemplate: e.target.value })} rows={8} className={INPUT} style={{ ...inputStyle, fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace', fontSize: 12 }} />
            </label>
            <div className="flex flex-col gap-2" style={{ fontSize: 12.5, color: 'var(--fg-2)' }}>
              <div>适用监控项（不选 = 全部监控项）</div>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={draft.allMonitors} onChange={(e) => setDraft({ ...draft, allMonitors: e.target.checked, monitorIds: e.target.checked ? [] : draft.monitorIds })} />
                全部监控项
              </label>
              {!draft.allMonitors && monitors.map((m) => (
                <label key={m.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={draft.monitorIds.includes(m.id)}
                    onChange={(e) => setDraft({ ...draft, monitorIds: e.target.checked ? [...draft.monitorIds, m.id] : draft.monitorIds.filter((x) => x !== m.id) })}
                  />
                  {m.name}
                </label>
              ))}
            </div>
            <label className="flex items-center gap-2" style={{ fontSize: 12.5, color: 'var(--fg-2)' }}>
              <input type="checkbox" checked={draft.enabled === 1} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked ? 1 : 0 })} />
              启用
            </label>
            <div className="flex gap-2">
              <button className="cursor-pointer rounded-lg px-4 py-2 font-medium" style={{ background: '#24c19a', color: '#fff', fontSize: 13.5 }} onClick={save}>保存</button>
              <button className="cursor-pointer rounded-lg border px-4 py-2" style={{ borderColor: 'var(--line)', fontSize: 13.5, color: 'var(--fg-2)' }} onClick={() => setDraft(null)}>取消</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
