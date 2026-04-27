CREATE TABLE `macro_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`event_id` text NOT NULL,
	`event` text NOT NULL,
	`category` text NOT NULL,
	`magnitude` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `causal_chains` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`event_id` text NOT NULL,
	`ticker` text NOT NULL,
	`category` text NOT NULL,
	`direction` text NOT NULL,
	`impact` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `event_relations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`event_id` text NOT NULL,
	`related_event_id` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `pipeline_runs` ADD `macro_intelligence_status` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `pipeline_runs` ADD `macro_intelligence_detail` text;--> statement-breakpoint
ALTER TABLE `pipeline_runs` ADD `macro_intelligence_errors` text;--> statement-breakpoint
ALTER TABLE `pipeline_runs` ADD `macro_intelligence_started_at` text;--> statement-breakpoint
ALTER TABLE `pipeline_runs` ADD `macro_intelligence_finished_at` text;
