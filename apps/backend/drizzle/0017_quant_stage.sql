CREATE TABLE `pipeline_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`status` text NOT NULL,
	`web_search_status` text DEFAULT 'pending' NOT NULL,
	`web_search_detail` text,
	`web_search_errors` text,
	`web_search_started_at` text,
	`web_search_finished_at` text,
	`news_status` text DEFAULT 'pending' NOT NULL,
	`news_detail` text,
	`news_errors` text,
	`news_started_at` text,
	`news_finished_at` text,
	`fundamentals_status` text DEFAULT 'pending' NOT NULL,
	`fundamentals_detail` text,
	`fundamentals_errors` text,
	`fundamentals_started_at` text,
	`fundamentals_finished_at` text,
	`analysis_status` text DEFAULT 'pending' NOT NULL,
	`analysis_detail` text,
	`analysis_errors` text,
	`analysis_started_at` text,
	`analysis_finished_at` text,
	`quant_status` text DEFAULT 'pending' NOT NULL,
	`quant_detail` text,
	`quant_errors` text,
	`quant_started_at` text,
	`quant_finished_at` text,
	`report_status` text DEFAULT 'pending' NOT NULL,
	`report_detail` text,
	`report_errors` text,
	`report_started_at` text,
	`report_finished_at` text,
	`started_at` text NOT NULL,
	`finished_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `backtest_runs` (
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
CREATE TABLE `calibrated_weights` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`weights` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
