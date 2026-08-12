import type { StatusRange, DetailRange } from './range'

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path)
  if (!res.ok) throw new ApiError(res.status, `${res.status} ${await res.text()}`)
  return res.json() as Promise<T>
}

export function fetchStatus(range: StatusRange) {
  return get<import('./types').StatusResponse>(`/api/status?range=${range}`)
}

export function fetchTimeseries(id: number, range: DetailRange) {
  return get<import('./types').TimeseriesResponse>(`/api/monitors/${id}/timeseries?range=${range}`)
}
