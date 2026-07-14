CREATE TABLE `today_proposals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`scan_id` integer NOT NULL,
	`scan_date` text NOT NULL,
	`symbol` text NOT NULL,
	`verb` text NOT NULL,
	`engine_action` text NOT NULL,
	`score` integer NOT NULL,
	`entry_price` real,
	`stop_loss` real,
	`target_price` real,
	`nth_appearance` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `today_proposals_date_symbol_uq` ON `today_proposals` (`scan_date`,`symbol`);