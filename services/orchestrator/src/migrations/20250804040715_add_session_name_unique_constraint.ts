import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // Create a partial unique index that enforces uniqueness of (environment_id, name)
  // but only for non-dead sessions where name is not null
  await sql`
    CREATE UNIQUE INDEX idx_sessions_environment_name_unique 
    ON sessions (environment_id, name) 
    WHERE status != 'dead' AND name IS NOT NULL
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  // Drop the unique index
  await sql`
    DROP INDEX IF EXISTS idx_sessions_environment_name_unique
  `.execute(db);
}