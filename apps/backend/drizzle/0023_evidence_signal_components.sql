-- Evidence V2 signal component scores for accuracy analysis by component
ALTER TABLE signal_tracking ADD COLUMN pead_score INTEGER;
ALTER TABLE signal_tracking ADD COLUMN insider_score INTEGER;
ALTER TABLE signal_tracking ADD COLUMN options_score INTEGER;
ALTER TABLE signal_tracking ADD COLUMN active_signals_count INTEGER;
ALTER TABLE signal_tracking ADD COLUMN market_regime_at_signal TEXT;
ALTER TABLE signal_tracking ADD COLUMN fundamentals_multiplier REAL;
ALTER TABLE signal_tracking ADD COLUMN beat_percent REAL;
ALTER TABLE signal_tracking ADD COLUMN consecutive_beats INTEGER;
ALTER TABLE signal_tracking ADD COLUMN ai_verdict TEXT;
ALTER TABLE signal_tracking ADD COLUMN ai_confidence INTEGER;
