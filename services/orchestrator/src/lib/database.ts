import { Pool } from 'pg';
import { config } from '../config';
import { createDatabase } from './kysely';
import { runMigrations } from './migrator';

let pool: Pool;

export async function setupDatabase() {
  // Initialize Kysely database
  createDatabase();
  
  // Run migrations
  await runMigrations();

  // Initialize legacy pool for compatibility (if needed)
  pool = new Pool({
    connectionString: config.DATABASE_URL,
  });
}

export function getPool() {
  if (!pool) {
    throw new Error('Database not initialized');
  }
  return pool;
}