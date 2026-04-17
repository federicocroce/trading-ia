CREATE TABLE IF NOT EXISTS `web_search_articles` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `date` text NOT NULL,
  `symbol` text,
  `query` text NOT NULL,
  `layer` text NOT NULL,
  `title` text NOT NULL,
  `url` text NOT NULL,
  `content` text NOT NULL,
  `published_at` text,
  `related_symbols` text NOT NULL DEFAULT '[]',
  `created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `pipeline_runs` ADD COLUMN `web_search_status` text NOT NULL DEFAULT 'pending';
--> statement-breakpoint
ALTER TABLE `pipeline_runs` ADD COLUMN `web_search_detail` text;
--> statement-breakpoint
ALTER TABLE `pipeline_runs` ADD COLUMN `web_search_errors` text;
--> statement-breakpoint
ALTER TABLE `pipeline_runs` ADD COLUMN `web_search_started_at` text;
--> statement-breakpoint
ALTER TABLE `pipeline_runs` ADD COLUMN `web_search_finished_at` text;
