import { eq } from 'drizzle-orm'
import { webhook, webhookMonitor } from '../db/schema'
import type { DrizzleDb } from '../db/client'

export type WebhookRow = typeof webhook.$inferSelect
export interface WebhookWithMonitors extends WebhookRow { monitorIds: number[] }

export interface WebhookInput {
  name: string; url: string; method: string
  headers: Record<string, string>; bodyTemplate: string; enabled: number
  monitorIds: number[] | null                      // null = 全部监控项
}

export function validateWebhook(input: WebhookInput): string[] {
  const errors: string[] = []
  if (!input.name?.trim()) errors.push('name is required')
  try { new URL(input.url) } catch { errors.push('url must be a valid URL') }
  if (!['GET', 'POST', 'PUT'].includes(input.method)) errors.push('method must be GET, POST or PUT')
  if (!input.bodyTemplate?.trim()) errors.push('body_template is required')
  return errors
}

function syncMonitors(db: DrizzleDb, webhookId: number, monitorIds: number[] | null): void {
  db.delete(webhookMonitor).where(eq(webhookMonitor.webhookId, webhookId)).run()
  if (monitorIds && monitorIds.length > 0) {
    db.insert(webhookMonitor).values(monitorIds.map((monitorId) => ({ webhookId, monitorId }))).run()
  }
}

export function createWebhook(db: DrizzleDb, input: WebhookInput): WebhookRow {
  const row = db.insert(webhook).values({
    name: input.name, url: input.url, method: input.method,
    headers: JSON.stringify(input.headers), bodyTemplate: input.bodyTemplate, enabled: input.enabled,
  }).returning().get()
  syncMonitors(db, row.id, input.monitorIds)
  return row
}

export function updateWebhook(db: DrizzleDb, id: number, input: WebhookInput): WebhookRow | null {
  const rows = db.update(webhook).set({
    name: input.name, url: input.url, method: input.method,
    headers: JSON.stringify(input.headers), bodyTemplate: input.bodyTemplate, enabled: input.enabled,
  }).where(eq(webhook.id, id)).returning().all()
  const row = rows[0]
  if (row) syncMonitors(db, id, input.monitorIds)
  return row ?? null
}

export function deleteWebhook(db: DrizzleDb, id: number): void {
  db.delete(webhook).where(eq(webhook.id, id)).run()
}

export function getWebhook(db: DrizzleDb, id: number): WebhookRow | null {
  return db.select().from(webhook).where(eq(webhook.id, id)).get() ?? null
}

export function listWebhooks(db: DrizzleDb): WebhookWithMonitors[] {
  return db.select().from(webhook).all().map((row) => ({
    ...row,
    monitorIds: db.select().from(webhookMonitor).where(eq(webhookMonitor.webhookId, row.id)).all().map((r) => r.monitorId),
  }))
}

/** 关联表为空表示“全部监控项” */
export function monitorsForWebhook(db: DrizzleDb, webhookId: number): number[] {
  return db.select().from(webhookMonitor).where(eq(webhookMonitor.webhookId, webhookId)).all().map((r) => r.monitorId)
}
