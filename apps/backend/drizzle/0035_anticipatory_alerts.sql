-- Migration 0035: anticipatory_alerts (confluencia bullish >=2 señales + stop breaches)
-- Nota: drizzle-kit generate diffeó contra el snapshot 0025 (las 0026-0034 fueron
-- hand-written sin snapshot) e incluyó DDL ya aplicado; este file se recortó a mano
-- a SOLO la tabla nueva. El snapshot 0035 re-sincroniza el estado para futuros generate.

CREATE TABLE `anticipatory_alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text DEFAULT 'anticipatory' NOT NULL,
	`symbol` text NOT NULL,
	`signals` text NOT NULL,
	`current_price` real NOT NULL,
	`entry_price` real,
	`stop_loss` real,
	`take_profit` real,
	`score` real DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`first_seen_date` text NOT NULL,
	`last_seen_date` text NOT NULL,
	`seen` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
