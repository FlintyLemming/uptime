export class ApiError extends Error {
  constructor(public status: number, public errors: string[], message: string) { super(message) }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { 'content-type': 'application/json' }, ...init })
  if (!res.ok) {
    let errors: string[] = []
    try { const body = await res.json() as { errors?: string[] }; errors = body.errors ?? [] } catch { /* ignore */ }
    throw new ApiError(res.status, errors, `${res.status}`)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export const authApi = {
  setupStatus: () => request<{ hasUser: boolean }>('/api/auth/setup-status'),
  setup: (username: string, password: string) => request('/api/auth/setup', { method: 'POST', body: JSON.stringify({ username, password }) }),
  login: (username: string, password: string) => request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  me: () => request<{ username: string }>('/api/auth/me'),
}

export interface MonitorDto {
  id: number; group_id: number | null; group_name: string | null; name: string; type: string; target: string
  port: number | null; interval_s: number; retry_interval_s: number; max_retries: number; timeout_ms: number
  active: number; sort_order: number; config: Record<string, unknown>
}

export const monitorsApi = {
  list: () => request<MonitorDto[]>('/api/admin/monitors'),
  create: (body: unknown) => request<MonitorDto>('/api/admin/monitors', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: number, body: unknown) => request<MonitorDto>(`/api/admin/monitors/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  remove: (id: number) => request<void>(`/api/admin/monitors/${id}`, { method: 'DELETE' }),
  reorder: (ids: number[]) => request('/api/admin/monitors/reorder', { method: 'POST', body: JSON.stringify({ ids }) }),
  test: (id: number) => request<{ ok: boolean; latency_ms: number | null; error: string | null; cert_days_left: number | null }>(`/api/admin/monitors/${id}/test`, { method: 'POST' }),
}

export const groupsApi = {
  list: () => request<Array<{ id: number; name: string; sort_order: number }>>('/api/admin/groups'),
  create: (name: string, sortOrder: number) => request('/api/admin/groups', { method: 'POST', body: JSON.stringify({ name, sort_order: sortOrder }) }),
  update: (id: number, name: string, sortOrder: number) => request(`/api/admin/groups/${id}`, { method: 'PATCH', body: JSON.stringify({ name, sort_order: sortOrder }) }),
  remove: (id: number) => request<void>(`/api/admin/groups/${id}`, { method: 'DELETE' }),
}

export interface WebhookDto { id: number; name: string; url: string; method: string; headers: Record<string, string>; body_template: string; enabled: number; monitor_ids: number[] | null }

export const webhooksApi = {
  list: () => request<WebhookDto[]>('/api/admin/webhooks'),
  create: (body: unknown) => request<{ id: number }>('/api/admin/webhooks', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: number, body: unknown) => request<{ id: number }>(`/api/admin/webhooks/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  remove: (id: number) => request<void>(`/api/admin/webhooks/${id}`, { method: 'DELETE' }),
  test: (id: number) => request<{ ok: boolean; attempts: number }>(`/api/admin/webhooks/${id}/test`, { method: 'POST' }),
}

export const settingsApi = {
  get: () => request<{ display_timezone: string; site_title: string; slot_retention_days: number; attempt_retention_days: number }>('/api/admin/settings'),
  put: (body: unknown) => request('/api/admin/settings', { method: 'PUT', body: JSON.stringify(body) }),
  changePassword: (current: string, next: string) => request('/api/admin/password', { method: 'POST', body: JSON.stringify({ current, next }) }),
}
