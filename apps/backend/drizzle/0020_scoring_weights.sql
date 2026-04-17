CREATE TABLE IF NOT EXISTS `scoring_weight_proposals` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `proposed_at` text NOT NULL DEFAULT (datetime('now')),
  `signal_count` integer NOT NULL,
  `short_term_basis` integer NOT NULL,
  `medium_term_basis` integer NOT NULL,
  `current_weights` text NOT NULL,
  `proposed_weights` text NOT NULL,
  `correlations` text NOT NULL,
  `status` text NOT NULL DEFAULT 'pending',
  `approved_at` text,
  `applied_at` text,
  `rejected_reason` text
);

CREATE TABLE IF NOT EXISTS `scoring_weight_history` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `applied_at` text NOT NULL DEFAULT (datetime('now')),
  `weights` text NOT NULL,
  `source` text NOT NULL,
  `proposal_id` integer REFERENCES `scoring_weight_proposals`(`id`),
  `accuracy_before` real,
  `accuracy_after` real
);
