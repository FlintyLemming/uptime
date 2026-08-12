import { effectiveRetries, timeoutViolatesBudget } from '../../lib/effective-retries'

export default function EffectiveRetriesHint({ intervalS, retryIntervalS, maxRetries, timeoutMs }: {
  intervalS: number; retryIntervalS: number; maxRetries: number; timeoutMs: number
}) {
  if (timeoutViolatesBudget(timeoutMs, retryIntervalS)) {
    return <div style={{ fontSize: 12.5, color: '#dc2625' }}>超时时间必须小于重试间隔（{retryIntervalS}s），否则超时会吃掉重试节奏。</div>
  }
  const n = effectiveRetries({ intervalS, retryIntervalS, maxRetries, timeoutMs })
  return (
    <div style={{ fontSize: 12.5, color: n < maxRetries ? '#d97706' : 'var(--fg-3)' }}>
      本间隔内实际最多重试 {n} 次，超出部分不会执行
    </div>
  )
}
