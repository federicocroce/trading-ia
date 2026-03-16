ALTER TABLE `transactions` ADD `currency` text DEFAULT 'USD' NOT NULL;--> statement-breakpoint
ALTER TABLE `transactions` ADD `total_amount` real;--> statement-breakpoint
ALTER TABLE `transactions` ADD `external_id` text;