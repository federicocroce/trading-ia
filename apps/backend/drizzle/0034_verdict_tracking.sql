-- Migration 0034: A/B verdict tracking + evidence/macro fields on signal_tracking
-- Permite medir cuando algo y LLM difieren cuál acierta más, y persistir el
-- evidence score + macro delta que produjo la señal.

ALTER TABLE signal_tracking ADD COLUMN algo_action TEXT;
ALTER TABLE signal_tracking ADD COLUMN llm_action TEXT;
ALTER TABLE signal_tracking ADD COLUMN verdict_source TEXT;
ALTER TABLE signal_tracking ADD COLUMN who_was_right TEXT;
ALTER TABLE signal_tracking ADD COLUMN evidence_score INTEGER;
ALTER TABLE signal_tracking ADD COLUMN macro_delta INTEGER;
