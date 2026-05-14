CREATE TABLE `news_radar_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`pipeline_run_id` integer,
	`generated_at` text NOT NULL DEFAULT (datetime('now')),
	`total_news_analyzed` integer NOT NULL,
	`per_article` text NOT NULL,
	`aggregated_signals` text NOT NULL,
	`emerging_narratives` text,
	`llm_model` text,
	`duration_ms` integer,
	`created_at` text NOT NULL DEFAULT (datetime('now')),
	FOREIGN KEY (`pipeline_run_id`) REFERENCES `pipeline_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_news_radar_generated_at` ON `news_radar_snapshots` (`generated_at`);
