CREATE TABLE `news_articles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`external_id` text NOT NULL,
	`source` text NOT NULL,
	`source_type` text NOT NULL,
	`title` text NOT NULL,
	`summary` text,
	`url` text,
	`published_at` text NOT NULL,
	`related_symbols` text NOT NULL,
	`sentiment` text,
	`impact` text,
	`story_cluster_id` text,
	`triangulation_confidence` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
