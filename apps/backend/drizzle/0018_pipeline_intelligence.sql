DROP TABLE IF EXISTS `market_themes`;

CREATE TABLE IF NOT EXISTS `discovery_queries` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `query` text NOT NULL,
  `lang` text NOT NULL DEFAULT 'en',
  `active` integer NOT NULL DEFAULT true,
  `priority` integer NOT NULL DEFAULT 0,
  `category` text NOT NULL DEFAULT 'general',
  `created_at` text NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS `thematic_queries` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL,
  `keywords` text NOT NULL,
  `active` integer NOT NULL DEFAULT true,
  `priority` integer NOT NULL DEFAULT 0,
  `created_at` text NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS `pipeline_stage_artifacts` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `pipeline_run_id` integer NOT NULL REFERENCES `pipeline_runs`(`id`),
  `stage` text NOT NULL,
  `input_snapshot` text,
  `output_snapshot` text,
  `tokens_used` integer,
  `model_used` text,
  `symbols_processed` text,
  `duration_ms` integer,
  `error_count` integer NOT NULL DEFAULT 0,
  `created_at` text NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS `unified_analysis_batches` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `pipeline_run_id` integer NOT NULL REFERENCES `pipeline_runs`(`id`),
  `batch_index` integer NOT NULL,
  `assets_input` text NOT NULL,
  `model_used` text NOT NULL,
  `tokens_input` integer,
  `tokens_output` integer,
  `duration_ms` integer,
  `parsed_ok` integer NOT NULL DEFAULT true,
  `error_msg` text,
  `raw_response` text,
  `created_at` text NOT NULL DEFAULT (datetime('now'))
);
