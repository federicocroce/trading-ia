import Database, { type Database as DatabaseType } from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { resolve } from 'path';
import { mkdirSync } from 'fs';
import * as schema from './schema.js';

const DB_PATH = process.env.DB_PATH ?? resolve(import.meta.dirname, '../../../../data/trading.db');

// Ensure data directory exists
mkdirSync(resolve(DB_PATH, '..'), { recursive: true });

const sqlite: DatabaseType = new Database(DB_PATH);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });
export { schema };
export { sqlite };
