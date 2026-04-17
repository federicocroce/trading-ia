ALTER TABLE `pipeline_runs` ADD COLUMN `quant_status` text NOT NULL DEFAULT 'pending';
--> statement-breakpoint
ALTER TABLE `pipeline_runs` ADD COLUMN `quant_detail` text;
--> statement-breakpoint
ALTER TABLE `pipeline_runs` ADD COLUMN `quant_errors` text;
--> statement-breakpoint
ALTER TABLE `pipeline_runs` ADD COLUMN `quant_started_at` text;
--> statement-breakpoint
ALTER TABLE `pipeline_runs` ADD COLUMN `quant_finished_at` text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `backtest_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`symbol` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`strategy` text NOT NULL,
	`metrics` text,
	`trades` text,
	`equity_curve` text,
	`status` text DEFAULT 'running' NOT NULL,
	`error` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `calibrated_weights` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`weights` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
