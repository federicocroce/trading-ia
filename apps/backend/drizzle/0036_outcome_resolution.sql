-- Migration 0036: outcome resolution para alertas anticipatorias y cadenas causales.
-- Cierra el loop "predicción vs realidad": además de las señales (signal_tracking, ya
-- existente), ahora medimos si la movida anticipada por una alerta ocurrió (triggered/
-- missed) y si la dirección que predijo una cadena causal de noticias acertó.

ALTER TABLE anticipatory_alerts ADD COLUMN outcome TEXT;
--> statement-breakpoint
ALTER TABLE anticipatory_alerts ADD COLUMN resolution_price REAL;
--> statement-breakpoint
ALTER TABLE anticipatory_alerts ADD COLUMN resolution_return REAL;
--> statement-breakpoint
ALTER TABLE anticipatory_alerts ADD COLUMN resolved_at TEXT;
--> statement-breakpoint
ALTER TABLE causal_chains ADD COLUMN entry_price REAL;
--> statement-breakpoint
ALTER TABLE causal_chains ADD COLUMN resolution_price REAL;
--> statement-breakpoint
ALTER TABLE causal_chains ADD COLUMN resolution_return REAL;
--> statement-breakpoint
ALTER TABLE causal_chains ADD COLUMN outcome TEXT;
--> statement-breakpoint
ALTER TABLE causal_chains ADD COLUMN resolved_at TEXT;
