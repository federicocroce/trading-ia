ALTER TABLE `signal_tracking` ADD `is_portfolio_hold` integer DEFAULT false;
ALTER TABLE `signal_tracking` ADD `entry_hit` integer;
ALTER TABLE `signal_tracking` ADD `entry_deviation` real;
ALTER TABLE `signal_tracking` ADD `entry_hit_at` text;
ALTER TABLE `signal_tracking` ADD `target_deviation` real;
ALTER TABLE `signal_tracking` ADD `target_hit_at` text;
ALTER TABLE `signal_tracking` ADD `stop_deviation` real;
ALTER TABLE `signal_tracking` ADD `stop_triggered_at` text;
