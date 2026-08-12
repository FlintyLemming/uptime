export function effectiveRetries(o: { intervalS: number; retryIntervalS: number; maxRetries: number; timeoutMs: number }): number {
  const cap = Math.floor((o.intervalS * 1000 - o.timeoutMs) / (o.retryIntervalS * 1000))
  return Math.max(0, Math.min(o.maxRetries, cap))
}

export function timeoutViolatesBudget(timeoutMs: number, retryIntervalS: number): boolean {
  return timeoutMs >= retryIntervalS * 1000
}
