import type { ReactNode } from 'react'

interface Props {
  type: string
  config: Record<string, unknown>
  onChange: (patch: Record<string, unknown>) => void
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

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2" style={{ fontSize: 12.5, color: 'var(--fg-2)' }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  )
}

function headersToText(headers: Record<string, string> | undefined): string {
  if (!headers) return ''
  return Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\n')
}

function textToHeaders(text: string): Record<string, string> {
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

export default function MonitorTypeFields({ type, config, onChange }: Props) {
  const method = String(config.method ?? 'GET')
  switch (type) {
    case 'http':
      return (
        <div className="flex flex-col gap-4">
          <Field label="请求方法">
            <select value={method} onChange={(e) => onChange({ method: e.target.value })} className={INPUT} style={inputStyle}>
              {['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>
          <Field label="请求头（每行 Key: Value）">
            <textarea value={headersToText(config.headers as Record<string, string> | undefined)} onChange={(e) => onChange({ headers: textToHeaders(e.target.value) })} rows={3} className={INPUT} style={inputStyle} />
          </Field>
          {method !== 'GET' && (
            <Field label="请求体">
              <textarea value={String(config.body ?? '')} onChange={(e) => onChange({ body: e.target.value })} rows={3} className={INPUT} style={inputStyle} />
            </Field>
          )}
          <Field label="可接受的状态码（逗号分隔，支持范围如 200-299）">
            <input
              value={(config.accepted_status_codes as string[] | undefined)?.join(', ') ?? '200-299'}
              onChange={(e) => onChange({ accepted_status_codes: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
              className={INPUT} style={inputStyle} placeholder="200-299"
            />
          </Field>
          <Check label="跟随重定向" checked={config.follow_redirects !== false} onChange={(v) => onChange({ follow_redirects: v })} />
          <Field label="响应关键词">
            <input value={String(config.keyword ?? '')} onChange={(e) => onChange({ keyword: e.target.value })} className={INPUT} style={inputStyle} placeholder="可选，留空不检查" />
          </Field>
          <Check label="关键词必须不存在（反转匹配）" checked={config.keyword_invert === true} onChange={(v) => onChange({ keyword_invert: v })} />
          <div className="grid grid-cols-2 gap-4">
            <Field label="JSON 字段路径（json_query）">
              <input value={String(config.json_query ?? '')} onChange={(e) => onChange({ json_query: e.target.value })} className={INPUT} style={inputStyle} placeholder="可选，如 status" />
            </Field>
            <Field label="JSON 期望值（json_expected）">
              <input value={String(config.json_expected ?? '')} onChange={(e) => onChange({ json_expected: e.target.value })} className={INPUT} style={inputStyle} placeholder="可选" />
            </Field>
          </div>
          <Check label="忽略 TLS 证书校验" checked={config.ignore_tls === true} onChange={(v) => onChange({ ignore_tls: v })} />
          <Check label="检查证书有效期" checked={config.check_cert_expiry === true} onChange={(v) => onChange({ check_cert_expiry: v })} />
        </div>
      )
    case 'tcp':
      return <div style={{ fontSize: 12.5, color: 'var(--fg-3)' }}>TCP 探测没有额外配置，端口在主表单中填写。</div>
    case 'ping':
      return (
        <Field label="Ping 包数量">
          <input type="number" value={Number(config.packet_count ?? 1)} onChange={(e) => onChange({ packet_count: Number(e.target.value) || 1 })} className={INPUT} style={inputStyle} />
        </Field>
      )
    case 'dns':
      return (
        <div className="flex flex-col gap-4">
          <Field label="DNS 解析服务器">
            <input value={String(config.resolver ?? '1.1.1.1')} onChange={(e) => onChange({ resolver: e.target.value })} className={INPUT} style={inputStyle} placeholder="1.1.1.1" />
          </Field>
          <Field label="记录类型">
            <select value={String(config.record_type ?? 'A')} onChange={(e) => onChange({ record_type: e.target.value })} className={INPUT} style={inputStyle}>
              {['A', 'AAAA', 'CNAME', 'TXT'].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="期望值（可选）">
            <input value={String(config.expected_value ?? '')} onChange={(e) => onChange({ expected_value: e.target.value })} className={INPUT} style={inputStyle} placeholder="可选，留空只检查解析成功" />
          </Field>
        </div>
      )
    default:
      return null
  }
}
