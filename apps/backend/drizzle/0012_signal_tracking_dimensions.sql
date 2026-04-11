ALTER TABLE signal_tracking ADD COLUMN sector TEXT;
ALTER TABLE signal_tracking ADD COLUMN tech_score INTEGER;
ALTER TABLE signal_tracking ADD COLUMN fund_score INTEGER;
ALTER TABLE signal_tracking ADD COLUMN sent_score REAL;
ALTER TABLE signal_tracking ADD COLUMN had_divergences INTEGER;
ALTER TABLE signal_tracking ADD COLUMN enriched_by_llm INTEGER;
ALTER TABLE signal_tracking ADD COLUMN short_term_score INTEGER;
ALTER TABLE signal_tracking ADD COLUMN medium_term_score INTEGER;
ALTER TABLE signal_tracking ADD COLUMN rsi_at_signal REAL;
ALTER TABLE signal_tracking ADD COLUMN predicted_return_mid REAL;

CREATE TABLE missed_opportunities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  scan_date TEXT NOT NULL,
  action_given TEXT NOT NULL,
  opportunity_score INTEGER,
  actual_return_7d REAL,
  actual_return_30d REAL,
  would_have_been TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
