export interface AppConfig {
  dataDir: string
  dbFile: string
  port: number
  probeConcurrency: number
}

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const dataDir = env.DATA_DIR ?? './data'
  return {
    dataDir,
    dbFile: `${dataDir}/uptime.db`,
    port: Number(env.PORT ?? 3000),
    probeConcurrency: Math.max(1, Number(env.PROBE_CONCURRENCY ?? 20)),
  }
}
