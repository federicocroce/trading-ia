CREATE TABLE `evidence_signals_cache` (
	`symbol` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`fetched_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
