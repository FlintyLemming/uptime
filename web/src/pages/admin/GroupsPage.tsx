import { useCallback, useEffect, useState } from 'react'
import { groupsApi } from '../../lib/admin-api'

interface GroupRow { id: number; name: string; sort_order: number }

const INPUT = 'rounded-lg border px-3 py-2'
const inputStyle = { borderColor: 'var(--line)', background: 'var(--bg)', color: 'var(--fg)', fontSize: 13.5 }

export default function GroupsPage() {
  const [groups, setGroups] = useState<GroupRow[]>([])
  const [newName, setNewName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => groupsApi.list().then(setGroups).catch(() => {}), [])
  useEffect(() => { load() }, [load])

  const save = (g: GroupRow) => {
    if (!g.name.trim()) return
    groupsApi.update(g.id, g.name.trim(), g.sort_order).then(load).catch(() => setError('保存失败'))
  }

  const add = () => {
    if (!newName.trim()) return
    groupsApi.create(newName.trim(), groups.length)
      .then(() => { setNewName(''); setError(null); load() })
      .catch(() => setError('新建失败'))
  }

  const remove = (g: GroupRow) => {
    if (!confirm(`删除分组「${g.name}」？删除分组不会删除其中的监控项，它们会变成未分组。`)) return
    groupsApi.remove(g.id).then(load)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="font-semibold" style={{ fontSize: 15 }}>分组（{groups.length}）</div>
      {error && <div style={{ fontSize: 12.5, color: '#dc2625' }}>{error}</div>}
      <div className="overflow-hidden rounded-xl border" style={{ borderColor: 'var(--line)', background: 'var(--card)', boxShadow: 'var(--shadow)' }}>
        {groups.length === 0 && <div className="px-5 py-8 text-center" style={{ fontSize: 13, color: 'var(--fg-3)' }}>还没有分组，在下方新建。</div>}
        {groups.map((g) => (
          <div key={g.id} className="flex items-center gap-3 border-t px-4 py-3" style={{ borderColor: 'var(--line)' }}>
            <input
              value={g.name}
              onChange={(e) => setGroups((prev) => prev.map((x) => x.id === g.id ? { ...x, name: e.target.value } : x))}
              onBlur={() => save(g)}
              className={INPUT} style={{ ...inputStyle, flex: 1 }}
            />
            <label className="flex items-center gap-2" style={{ fontSize: 12.5, color: 'var(--fg-2)' }}>
              排序
              <input
                type="number"
                value={g.sort_order}
                onChange={(e) => setGroups((prev) => prev.map((x) => x.id === g.id ? { ...x, sort_order: Number(e.target.value) } : x))}
                onBlur={() => save(g)}
                className={INPUT} style={{ ...inputStyle, width: 72 }}
              />
            </label>
            <button
              className="cursor-pointer rounded-md border px-2 py-1"
              style={{ fontSize: 11.5, borderColor: 'var(--line)', color: '#dc2625' }}
              onClick={() => remove(g)}
            >
              删除
            </button>
          </div>
        ))}
        <div className="flex items-center gap-3 border-t px-4 py-3" style={{ borderColor: 'var(--line)' }}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') add() }}
            placeholder="新分组名称"
            className={INPUT} style={{ ...inputStyle, flex: 1 }}
          />
          <button
            className="cursor-pointer rounded-lg px-3 py-1.5 font-medium"
            style={{ background: '#24c19a', color: '#fff', fontSize: 13 }}
            onClick={add}
          >
            添加
          </button>
        </div>
      </div>
    </div>
  )
}
