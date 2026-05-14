CREATE TABLE `news_intelligence_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`generated_at` text NOT NULL DEFAULT (datetime('now')),
	`total_news_count` integer NOT NULL,
	`plazas` text NOT NULL,
	`alerts` text NOT NULL,
	`top_headlines` text,
	`triangulation_stats` text,
	`created_at` text NOT NULL DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE INDEX `idx_news_intel_snapshots_generated_at` ON `news_intelligence_snapshots` (`generated_at`);
--> statement-breakpoint
CREATE TABLE `anti_hype_rejections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`scan_id` integer,
	`symbol` text NOT NULL,
	`reasons` text NOT NULL,
	`mode` text,
	`rejected_at` text NOT NULL DEFAULT (datetime('now')),
	`created_at` text NOT NULL DEFAULT (datetime('now')),
	FOREIGN KEY (`scan_id`) REFERENCES `opportunity_scans`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_anti_hype_scan_id` ON `anti_hype_rejections` (`scan_id`);
--> statement-breakpoint
CREATE INDEX `idx_anti_hype_symbol` ON `anti_hype_rejections` (`symbol`);
