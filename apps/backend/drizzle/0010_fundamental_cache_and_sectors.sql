CREATE TABLE IF NOT EXISTS `fundamental_cache` (
	`symbol` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`fetched_at` text NOT NULL,
	`expires_at` text NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `sector_impacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`report_date` text NOT NULL,
	`sector` text NOT NULL,
	`impact` text NOT NULL,
	`event` text NOT NULL,
	`summary` text NOT NULL,
	`key_news` text NOT NULL,
	`suggested_tickers` text NOT NULL,
	`risk_factors` text NOT NULL,
	`confidence` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_sector_impacts_date` ON `sector_impacts` (`report_date`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_fundamental_cache_expires` ON `fundamental_cache` (`expires_at`);
