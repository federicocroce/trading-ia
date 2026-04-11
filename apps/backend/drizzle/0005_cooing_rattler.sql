CREATE TABLE `daily_reports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`report_date` text NOT NULL,
	`report_type` text NOT NULL,
	`scan_id` integer,
	`news_source_stats` text NOT NULL,
	`total_news_count` integer NOT NULL,
	`triangulation_stats` text NOT NULL,
	`second_order_effects` text NOT NULL,
	`anti_hype_results` text NOT NULL,
	`top_recommendations` text NOT NULL,
	`sector_summary` text NOT NULL,
	`total_symbols_scanned` integer NOT NULL,
	`analysis_engine` text NOT NULL,
	`analysis_detail` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`scan_id`) REFERENCES `opportunity_scans`(`id`) ON UPDATE no action ON DELETE no action
);
