CREATE TABLE `discovered_symbols` (
	`symbol` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`instrument_type` text NOT NULL,
	`sector` text NOT NULL,
	`industry` text,
	`market` text NOT NULL,
	`exchange` text,
	`discovered_from` text NOT NULL,
	`relevance_score` integer NOT NULL DEFAULT 0,
	`news_count` integer NOT NULL DEFAULT 1,
	`first_seen` text DEFAULT (datetime('now')) NOT NULL,
	`last_seen` text DEFAULT (datetime('now')) NOT NULL,
	`expires_at` text NOT NULL,
	`active` integer NOT NULL DEFAULT 1
);
