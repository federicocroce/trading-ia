CREATE TABLE IF NOT EXISTS `quota_exhausted` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `provider` text NOT NULL,
  `model` text NOT NULL,
  `key_index` integer,
  `exhausted_at` text DEFAULT (datetime('now')) NOT NULL,
  `reset_at` text NOT NULL
);
