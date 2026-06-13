-- Migration 0037: event-study playbook (evento de mercado → reacción sectorial empírica).
-- Aditivo y aislado: no toca el motor existente. Guarda lo APRENDIDO de la historia de precios.

CREATE TABLE `event_sector_reactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_type` text NOT NULL,
	`target` text NOT NULL,
	`horizon_days` integer NOT NULL,
	`reaction_avg` real NOT NULL,
	`baseline_avg` real NOT NULL,
	`edge` real NOT NULL,
	`win_rate` integer NOT NULL,
	`t_stat` real NOT NULL,
	`significant` integer DEFAULT false NOT NULL,
	`n_events` integer NOT NULL,
	`computed_at` text DEFAULT (datetime('now')) NOT NULL
);
