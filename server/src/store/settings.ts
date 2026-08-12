import { eq } from 'drizzle-orm'
import { setting } from '../db/schema'
import type { DrizzleDb } from '../db/client'

export interface Settings {
  display_timezone: string
  site_title: string
  slot_retention_days: number
  attempt_retention_days: number
}

export function getSetting(db: DrizzleDb, key: string): string | null {
  return db.select().from(setting).where(eq(setting.key, key)).get()?.value ?? null
}

export function setSetting(db: DrizzleDb, key: string, value: string): void {
  const existing = db.select().from(setting).where(eq(setting.key, key)).get()
  if (existing) db.update(setting).set({ value }).where(eq(setting.key, key)).run()
  else db.insert(setting).values({ key, value }).run()
}

export function getSettings(db: DrizzleDb): Settings {
  return {
    display_timezone: getSetting(db, 'display_timezone') ?? 'Asia/Shanghai',
    site_title: getSetting(db, 'site_title') ?? 'Status',
    slot_retention_days: Number(getSetting(db, 'slot_retention_days') ?? '90'),
    attempt_retention_days: Number(getSetting(db, 'attempt_retention_days') ?? '7'),
  }
}

export function validateSettings(input: Partial<Settings>): string[] {
  const errors: string[] = []
  if (input.slot_retention_days !== undefined && input.slot_retention_days < 90) {
    errors.push('slot_retention_days must be >= 90')
  }
  if (input.attempt_retention_days !== undefined && input.attempt_retention_days < 1) {
    errors.push('attempt_retention_days must be >= 1')
  }
  if (input.display_timezone !== undefined) {
    try { new Intl.DateTimeFormat('en-US', { timeZone: input.display_timezone }) }
    catch { errors.push(`invalid timezone: ${input.display_timezone}`) }
  }
  return errors
}
