CREATE INDEX IF NOT EXISTS `idx_news_external_id` ON `news_articles` (`external_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_transactions_symbol` ON `transactions` (`symbol`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_transactions_date` ON `transactions` (`date`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_signal_tracking_symbol` ON `signal_tracking` (`symbol`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_discovered_active` ON `discovered_symbols` (`active`);
