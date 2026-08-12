CREATE TABLE `attempt` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`monitor_id` integer NOT NULL,
	`slot_started_at` integer NOT NULL,
	`seq` integer NOT NULL,
	`ok` integer NOT NULL,
	`latency_ms` integer,
	`error` text,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `attempt_monitor_slot_idx` ON `attempt` (`monitor_id`,`slot_started_at`);--> statement-breakpoint
CREATE TABLE `monitor` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`group_id` integer,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`target` text NOT NULL,
	`port` integer,
	`interval_s` integer DEFAULT 60 NOT NULL,
	`retry_interval_s` integer DEFAULT 20 NOT NULL,
	`max_retries` integer DEFAULT 3 NOT NULL,
	`timeout_ms` integer DEFAULT 10000 NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `monitor_group`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `monitor_group` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `setting` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `slot` (
	`monitor_id` integer NOT NULL,
	`started_at` integer NOT NULL,
	`interval_s` integer NOT NULL,
	`status` integer NOT NULL,
	`attempts` integer NOT NULL,
	`recovered_after_s` integer,
	`latency_ms` integer,
	`error` text,
	`cert_days_left` integer,
	PRIMARY KEY(`monitor_id`, `started_at`),
	FOREIGN KEY (`monitor_id`) REFERENCES `monitor`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `slot_daily` (
	`monitor_id` integer NOT NULL,
	`day` text NOT NULL,
	`up` integer NOT NULL,
	`flaky` integer NOT NULL,
	`down` integer NOT NULL,
	`nodata` integer NOT NULL,
	`down_seconds` integer NOT NULL,
	`latency_p50` integer,
	`latency_p95` integer,
	PRIMARY KEY(`monitor_id`, `day`),
	FOREIGN KEY (`monitor_id`) REFERENCES `monitor`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_username_unique` ON `user` (`username`);--> statement-breakpoint
CREATE TABLE `webhook` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`method` text DEFAULT 'POST' NOT NULL,
	`headers` text DEFAULT '{}' NOT NULL,
	`body_template` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `webhook_monitor` (
	`webhook_id` integer NOT NULL,
	`monitor_id` integer NOT NULL,
	PRIMARY KEY(`webhook_id`, `monitor_id`),
	FOREIGN KEY (`webhook_id`) REFERENCES `webhook`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`monitor_id`) REFERENCES `monitor`(`id`) ON UPDATE no action ON DELETE cascade
);
