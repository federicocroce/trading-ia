ALTER TABLE `backtest_runs` ADD `asset_class` text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `asset_class_thresholds` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `asset_class` text NOT NULL UNIQUE,
  `score_buy` integer NOT NULL DEFAULT 58,
  `score_strong_buy` integer NOT NULL DEFAULT 72,
  `score_sell` integer NOT NULL DEFAULT 52,
  `score_watch_min` integer NOT NULL DEFAULT 42,
  `calibrated_at` text NOT NULL,
  `backtest_win_rate` real,
  `backtest_num_trades` integer,
  `source` text NOT NULL DEFAULT 'manual',
  `created_at` text NOT NULL DEFAULT (datetime('now'))
);
