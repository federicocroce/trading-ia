ALTER TABLE sector_impacts ADD COLUMN catalysts TEXT NOT NULL DEFAULT '[]';
ALTER TABLE sector_impacts ADD COLUMN conviccion TEXT NOT NULL DEFAULT 'media';
ALTER TABLE sector_impacts ADD COLUMN tension TEXT;
ALTER TABLE pipeline_runs ADD COLUMN sector_intelligence_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE pipeline_runs ADD COLUMN sector_intelligence_detail TEXT;
ALTER TABLE pipeline_runs ADD COLUMN sector_intelligence_errors TEXT;
ALTER TABLE pipeline_runs ADD COLUMN sector_intelligence_started_at TEXT;
ALTER TABLE pipeline_runs ADD COLUMN sector_intelligence_finished_at TEXT;
