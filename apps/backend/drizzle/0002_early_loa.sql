CREATE TABLE `opportunity_scans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`scanned_at` text NOT NULL,
	`engine` text NOT NULL,
	`engine_detail` text NOT NULL,
	`total_symbols_scanned` integer NOT NULL,
	`opportunity_count` integer NOT NULL,
	`opportunities` text NOT NULL,
	`sector_summary` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `opportunity_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`scan_id` integer NOT NULL,
	`symbol` text NOT NULL,
	`sector` text NOT NULL,
	`opportunity_score` integer NOT NULL,
	`recommendation` text NOT NULL,
	`current_price` real NOT NULL,
	`short_term_mid` real NOT NULL,
	`medium_term_mid` real NOT NULL,
	`confidence` integer NOT NULL,
	`reasoning` text NOT NULL,
	`data` text NOT NULL,
	`scanned_at` text NOT NULL,
	FOREIGN KEY (`scan_id`) REFERENCES `opportunity_scans`(`id`) ON UPDATE no action ON DELETE no action
);
