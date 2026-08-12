import { integer, primaryKey, sqliteTable, text, index } from 'drizzle-orm/sqlite-core'

export const monitorGroup = sqliteTable('monitor_group', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
})

export const monitor = sqliteTable('monitor', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  groupId: integer('group_id').references(() => monitorGroup.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  type: text('type').notNull(),                       // http | tcp | ping | dns
  target: text('target').notNull(),
  port: integer('port'),
  intervalS: integer('interval_s').notNull().default(60),
  retryIntervalS: integer('retry_interval_s').notNull().default(20),
  maxRetries: integer('max_retries').notNull().default(3),
  timeoutMs: integer('timeout_ms').notNull().default(10000),
  active: integer('active').notNull().default(1),
  sortOrder: integer('sort_order').notNull().default(0),
  config: text('config').notNull().default('{}'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

// slot 状态编码：0=up 1=flaky 2=down
export const slot = sqliteTable('slot', {
  monitorId: integer('monitor_id').notNull().references(() => monitor.id, { onDelete: 'cascade' }),
  startedAt: integer('started_at').notNull(),
  intervalS: integer('interval_s').notNull(),
  status: integer('status').notNull(),
  attempts: integer('attempts').notNull(),
  recoveredAfterS: integer('recovered_after_s'),
  latencyMs: integer('latency_ms'),
  error: text('error'),
  certDaysLeft: integer('cert_days_left'),
}, (t) => [primaryKey({ columns: [t.monitorId, t.startedAt] })])

export const attempt = sqliteTable('attempt', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  monitorId: integer('monitor_id').notNull(),
  slotStartedAt: integer('slot_started_at').notNull(),
  seq: integer('seq').notNull(),
  ok: integer('ok').notNull(),
  latencyMs: integer('latency_ms'),
  error: text('error'),
  at: integer('at').notNull(),
}, (t) => [index('attempt_monitor_slot_idx').on(t.monitorId, t.slotStartedAt)])

export const slotDaily = sqliteTable('slot_daily', {
  monitorId: integer('monitor_id').notNull().references(() => monitor.id, { onDelete: 'cascade' }),
  day: text('day').notNull(),                          // YYYY-MM-DD，按展示时区切
  up: integer('up').notNull(),
  flaky: integer('flaky').notNull(),
  down: integer('down').notNull(),
  nodata: integer('nodata').notNull(),
  downSeconds: integer('down_seconds').notNull(),
  latencyP50: integer('latency_p50'),
  latencyP95: integer('latency_p95'),
}, (t) => [primaryKey({ columns: [t.monitorId, t.day] })])

export const webhook = sqliteTable('webhook', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  url: text('url').notNull(),
  method: text('method').notNull().default('POST'),
  headers: text('headers').notNull().default('{}'),
  bodyTemplate: text('body_template').notNull(),
  enabled: integer('enabled').notNull().default(1),
})

export const webhookMonitor = sqliteTable('webhook_monitor', {
  webhookId: integer('webhook_id').notNull().references(() => webhook.id, { onDelete: 'cascade' }),
  monitorId: integer('monitor_id').notNull().references(() => monitor.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.webhookId, t.monitorId] })])

export const user = sqliteTable('user', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),       // argon2id
  createdAt: integer('created_at').notNull(),
})

export const setting = sqliteTable('setting', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})
