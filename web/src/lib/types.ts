export type EntityStatus = 'operational' | 'degraded' | 'down' | 'nodata'
export interface Bar { t: number; s: number }       // 0=up 1=degraded 2=partial 3=down 4=nodata
export interface DayDetail { up: number; flaky: number; down: number; nodata: number }
export interface SlotMeta { interval_s: number; recovered_after_s: number | null }
export interface StatusMonitor {
  id: number; name: string; status: EntityStatus; uptime: number; flaky_count: number; bars: Bar[]
  interval_s: number
  daily: DayDetail[]                                             // 日档（>24h）时与 bars 同序；小时档为空
  slots_meta: Array<SlotMeta | null>                             // 小时档（≤24h）时与 bars 同序；日档为空
}
export interface StatusGroup {
  id: number | null; name: string; status: EntityStatus; uptime: number; monitors: StatusMonitor[]; bars: Bar[]
  down_seconds: number
}
export interface StatusResponse { site_title: string; timezone: string; generated_at: number; overall: EntityStatus; groups: StatusGroup[] }

export interface TimeseriesSlot { started_at: number; status: number; latency_ms: number | null; error: string | null; attempts: number; recovered_after_s: number | null; cert_days_left: number | null }
export interface TimeseriesDaily { day: string; up: number; flaky: number; down: number; nodata: number; down_seconds: number; latency_p50: number | null; latency_p95: number | null }
export interface TimeseriesResponse {
  monitor: { id: number; name: string; type: string; target: string; interval_s: number; config: Record<string, unknown> }
  slots: TimeseriesSlot[]; daily: TimeseriesDaily[]; range_seconds: number
}
