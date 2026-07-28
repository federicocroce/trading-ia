CREATE TABLE `portfolio_verdicts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`verdict_date` text NOT NULL,
	`symbol` text NOT NULL,
	`verb` text NOT NULL,
	`reason` text NOT NULL,
	`current_price` real NOT NULL,
	`avg_cost` real NOT NULL,
	`gain_pct` real NOT NULL,
	`stop` real,
	`target` real,
	`position_value` real,
	`warning` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `portfolio_verdicts_date_symbol_uq` ON `portfolio_verdicts` (`verdict_date`,`symbol`);