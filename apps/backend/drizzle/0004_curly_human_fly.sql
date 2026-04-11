CREATE TABLE `sector_effects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`scan_id` integer,
	`trigger_event` text NOT NULL,
	`causal_chain` text NOT NULL,
	`affected_tickers` text NOT NULL,
	`impact_direction` text NOT NULL,
	`confidence` text NOT NULL,
	`reasoning` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`scan_id`) REFERENCES `opportunity_scans`(`id`) ON UPDATE no action ON DELETE no action
);
