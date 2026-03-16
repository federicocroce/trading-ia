CREATE TABLE `positions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`symbol` text NOT NULL,
	`quantity` real NOT NULL,
	`avg_cost` real NOT NULL,
	`notes` text,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`symbol`) REFERENCES `symbols`(`symbol`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `symbols` (
	`symbol` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`flag` text DEFAULT '🌐' NOT NULL,
	`plaza` text DEFAULT 'global' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`symbol` text NOT NULL,
	`type` text NOT NULL,
	`quantity` real NOT NULL,
	`price` real NOT NULL,
	`fees` real DEFAULT 0 NOT NULL,
	`date` text NOT NULL,
	`platform` text,
	`notes` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`symbol`) REFERENCES `symbols`(`symbol`) ON UPDATE no action ON DELETE no action
);
