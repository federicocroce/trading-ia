ALTER TABLE sector_impacts ADD COLUMN catalysts TEXT NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE sector_impacts ADD COLUMN conviccion TEXT NOT NULL DEFAULT 'media';
--> statement-breakpoint
ALTER TABLE sector_impacts ADD COLUMN tension TEXT;
--> statement-breakpoint
ALTER TABLE pipeline_runs ADD COLUMN sector_intelligence_status TEXT NOT NULL DEFAULT 'pending';
--> statement-breakpoint
ALTER TABLE pipeline_runs ADD COLUMN sector_intelligence_detail TEXT;
--> statement-breakpoint
ALTER TABLE pipeline_runs ADD COLUMN sector_intelligence_errors TEXT;
--> statement-breakpoint
ALTER TABLE pipeline_runs ADD COLUMN sector_intelligence_started_at TEXT;
--> statement-breakpoint
ALTER TABLE pipeline_runs ADD COLUMN sector_intelligence_finished_at TEXT;
