import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { db } from './index.js';
import { seedDatabase } from './seed.js';
import { seedConfigTables } from './seed-config.js';
import { resolve } from 'path';
import { clearExpiredQuota } from '../shared/quota-tracker.js';

export function initDatabase() {
  console.log('[db] Initializing database...');

  // Run migrations (safe to call multiple times — skips already-applied)
  // Use path relative to this source file to avoid CWD issues
  const migrationsFolder = resolve(import.meta.dirname, '../../drizzle');
  migrate(db, { migrationsFolder });

  // Seed if empty
  seedDatabase();

  // Seed config tables (idempotent)
  seedConfigTables();

  // Clear stale quota entries from previous sessions
  clearExpiredQuota();

  console.log('[db] Database ready.');
}
