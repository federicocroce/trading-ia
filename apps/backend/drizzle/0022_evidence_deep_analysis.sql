CREATE TABLE `evidence_deep_analysis` (
	`symbol` text PRIMARY KEY NOT NULL,
	`analysis_date` text NOT NULL,
	`verdict` text NOT NULL,
	`reasoning` text NOT NULL,
	`entry_zone` text NOT NULL,
	`target` text NOT NULL,
	`stop_loss` text NOT NULL,
	`risk_reward` text NOT NULL,
	`confidence` integer NOT NULL,
	`key_risks` text NOT NULL,
	`timeframe` text NOT NULL,
	`model` text NOT NULL,
	`fetched_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
