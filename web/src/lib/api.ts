export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path)
  if (!res.ok) throw new ApiError(res.status, `${res.status} ${await res.text()}`)
  return res.json() as Promise<T>
}

export function fetchStatus(range: '90d' | '30d' | '24h') {
  return get<import('./types').StatusResponse>(`/api/status?range=${range}`)
}

export function fetchTimeseries(id: number, range: '24h' | '7d' | '30d') {
  return get<import('./types').TimeseriesResponse>(`/api/monitors/${id}/timeseries?range=${range}`)
}
