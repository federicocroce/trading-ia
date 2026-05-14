CREATE TABLE `unified_analysis_results` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`pipeline_run_id` integer,
	`symbol` text NOT NULL,
	`generated_at` text NOT NULL DEFAULT (datetime('now')),
	`action` text NOT NULL,
	`in_portfolio` integer NOT NULL DEFAULT false,
	`thesis` text NOT NULL,
	`catalysts` text NOT NULL,
	`risks` text NOT NULL,
	`would_do` text NOT NULL,
	`would_not_do` text NOT NULL,
	`narrative` text NOT NULL,
	`macro_theme` text,
	`generated_by` text NOT NULL,
	`opportunity_score` integer,
	`dedupe_key` text NOT NULL UNIQUE,
	`created_at` text NOT NULL DEFAULT (datetime('now')),
	FOREIGN KEY (`pipeline_run_id`) REFERENCES `pipeline_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_unified_analysis_results_symbol` ON `unified_analysis_results` (`symbol`);
--> statement-breakpoint
CREATE INDEX `idx_unified_analysis_results_generated_at` ON `unified_analysis_results` (`generated_at`);
