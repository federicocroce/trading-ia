CREATE TABLE IF NOT EXISTS `evidence_scan_runs` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT,
  `started_at` TEXT NOT NULL,
  `completed_at` TEXT,
  `total_symbols` INTEGER,
  `scanned_ok` INTEGER,
  `failed_count` INTEGER,
  `high_conviction` INTEGER,
  `medium_conviction` INTEGER,
  `with_signals` INTEGER,
  `market_regime` TEXT,
  `spy_price` REAL,
  `force_refresh` INTEGER,
  `error_message` TEXT,
  `duration_ms` INTEGER
);
