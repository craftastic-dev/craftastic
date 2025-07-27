import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { Database } from './database-types';
import { config } from '../config';

let db: Kysely<Database>;

export function createDatabase(): Kysely<Database> {
  if (!db) {
    const dialect = new PostgresDialect({
      pool: new Pool({
        connectionString: config.DATABASE_URL,
      }),
    });

    db = new Kysely<Database>({
      dialect,
    });
  }

  return db;
}

export function getDatabase(): Kysely<Database> {
  if (!db) {
    throw new Error('Database not initialized. Call createDatabase() first.');
  }
  return db;
}