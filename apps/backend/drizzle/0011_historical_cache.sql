CREATE TABLE IF NOT EXISTS `historical_cache` (
	`id` text PRIMARY KEY NOT NULL,
	`symbol` text NOT NULL,
	`interval` text NOT NULL,
	`data` text NOT NULL,
	`fetched_at` text NOT NULL,
	`expires_at` text NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_historical_cache_expires` ON `historical_cache` (`expires_at`);
