import { useState } from 'react'
import { webhooksApi } from '../../lib/admin-api'

export default function WebhookTestButton({ id }: { id: number }) {
  const [state, setState] = useState<'idle' | 'sending' | 'ok' | 'fail'>('idle')
  return (
    <button
      className="cursor-pointer rounded-md border px-2 py-1"
      style={{ fontSize: 11.5, borderColor: 'var(--line)', color: state === 'fail' ? '#dc2625' : state === 'ok' ? '#24c19a' : 'var(--fg-2)' }}
      onClick={() => { setState('sending'); webhooksApi.test(id).then((r) => setState(r.ok ? 'ok' : 'fail')).catch(() => setState('fail')) }}
    >
      {state === 'sending' ? '发送中…' : state === 'ok' ? '发送成功' : state === 'fail' ? '发送失败' : '发送测试'}
    </button>
  )
}
