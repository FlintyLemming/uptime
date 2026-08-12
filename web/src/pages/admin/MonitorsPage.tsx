import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { monitorsApi, type MonitorDto } from '../../lib/admin-api'

export default function MonitorsPage() {
  const [monitors, setMonitors] = useState<MonitorDto[]>([])
  const [dragId, setDragId] = useState<number | null>(null)
  const [testResults, setTestResults] = useState<Record<number, { ok: boolean; latency_ms: number | null; error: string | null }>>({})

  const load = useCallback(() => monitorsApi.list().then(setMonitors).catch(() => {}), [])
  useEffect(() => { load() }, [load])

  const onDrop = (targetId: number) => {
    if (dragId === null || dragId === targetId) return
    const ids = monitors.map((m) => m.id)
    const from = ids.indexOf(dragId), to = ids.indexOf(targetId)
    ids.splice(from, 1)
    ids.splice(to, 0, dragId)
    setMonitors((prev) => [...prev].sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id)))
    monitorsApi.reorder(ids).then(load)
    setDragId(null)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="font-semibold" style={{ fontSize: 15 }}>监控项（{monitors.length}）</div>
        <Link to="/admin/monitors/new" className="rounded-lg px-3 py-1.5 font-medium" style={{ background: '#24c19a', color: '#fff', fontSize: 13 }}>新建监控项</Link>
      </div>
      <div className="overflow-hidden rounded-xl border" style={{ borderColor: 'var(--line)', background: 'var(--card)', boxShadow: 'var(--shadow)' }}>
        {monitors.length === 0 && <div className="px-5 py-8 text-center" style={{ fontSize: 13, color: 'var(--fg-3)' }}>还没有监控项，点右上角新建。</div>}
        {monitors.map((m) => (
          <div
            key={m.id}
            draggable
            onDragStart={() => setDragId(m.id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => onDrop(m.id)}
            className="flex items-center gap-3 border-t px-4 py-3"
            style={{ borderColor: 'var(--line)', cursor: 'grab', opacity: dragId === m.id ? 0.5 : 1 }}
          >
            <span style={{ color: 'var(--fg-3)', fontSize: 12 }}>⠿</span>
            <span className="h-2 w-2 rounded-full" style={{ background: m.active ? '#24c19a' : 'var(--line)' }} />
            <Link to={`/admin/monitors/${m.id}`} className="font-medium hover:underline" style={{ fontSize: 13.5 }}>{m.name}</Link>
            <span style={{ fontSize: 11.5, color: 'var(--fg-3)', fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace' }}>{m.type} · {m.target}{m.port ? `:${m.port}` : ''}</span>
            {m.group_name && <span className="rounded-full px-2 py-0.5" style={{ fontSize: 11, background: 'var(--bg-sub)', color: 'var(--fg-2)' }}>{m.group_name}</span>}
            <span className="ml-auto flex items-center gap-2">
              {testResults[m.id] && (
                <span style={{ fontSize: 11.5, color: testResults[m.id]!.ok ? '#24c19a' : '#dc2625' }}>
                  {testResults[m.id]!.ok ? `${testResults[m.id]!.latency_ms}ms` : testResults[m.id]!.error}
                </span>
              )}
              <button className="cursor-pointer rounded-md border px-2 py-1" style={{ fontSize: 11.5, borderColor: 'var(--line)', color: 'var(--fg-2)' }}
                onClick={() => monitorsApi.test(m.id).then((r) => setTestResults((p) => ({ ...p, [m.id]: r })))}>测试</button>
              <button className="cursor-pointer rounded-md border px-2 py-1" style={{ fontSize: 11.5, borderColor: 'var(--line)', color: 'var(--fg-2)' }}
                onClick={() => monitorsApi.update(m.id, { ...toBody(m), active: m.active ? 0 : 1 }).then(load)}>
                {m.active ? '停用' : '启用'}
              </button>
              <button className="cursor-pointer rounded-md border px-2 py-1" style={{ fontSize: 11.5, borderColor: 'var(--line)', color: '#dc2625' }}
                onClick={() => { if (confirm(`删除监控项「${m.name}」？其历史数据会一并删除。`)) monitorsApi.remove(m.id).then(load) }}>删除</button>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function toBody(m: MonitorDto) {
  return {
    group_id: m.group_id, name: m.name, type: m.type, target: m.target, port: m.port,
    interval_s: m.interval_s, retry_interval_s: m.retry_interval_s, max_retries: m.max_retries,
    timeout_ms: m.timeout_ms, active: m.active, sort_order: m.sort_order, config: m.config,
  }
}
