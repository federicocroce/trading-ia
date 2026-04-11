CREATE INDEX IF NOT EXISTS `idx_opp_snapshots_symbol` ON `opportunity_snapshots` (`symbol`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_opp_snapshots_scanned_at` ON `opportunity_snapshots` (`scanned_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_news_published_at` ON `news_articles` (`published_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_discovered_expires` ON `discovered_symbols` (`expires_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_signal_outcome` ON `signal_tracking` (`outcome`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_signal_date` ON `signal_tracking` (`signal_date`);
