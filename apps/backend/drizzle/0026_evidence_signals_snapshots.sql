CREATE TABLE IF NOT EXISTS `evidence_signals_snapshots` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT,
  `scan_date` TEXT NOT NULL,
  `scanned_at` TEXT NOT NULL,
  `signals` TEXT NOT NULL,
  `analyses` TEXT NOT NULL,
  `market_regime` TEXT,
  `total_symbols` INTEGER NOT NULL DEFAULT 0,
  `high_conviction` INTEGER NOT NULL DEFAULT 0,
  `medium_conviction` INTEGER NOT NULL DEFAULT 0,
  `with_signals` INTEGER NOT NULL DEFAULT 0,
  `created_at` TEXT NOT NULL DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_evidence_snapshots_scan_date` ON `evidence_signals_snapshots` (`scan_date`);
