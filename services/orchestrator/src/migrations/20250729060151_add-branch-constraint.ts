import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // Create a partial unique index that enforces uniqueness of (environment_id, git_branch)
  // but only for non-dead sessions where git_branch is not null
  await sql`
    CREATE UNIQUE INDEX idx_sessions_environment_branch_unique 
    ON sessions (environment_id, git_branch) 
    WHERE status != 'dead' AND git_branch IS NOT NULL
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  // Drop the unique index
  await sql`
    DROP INDEX IF EXISTS idx_sessions_environment_branch_unique
  `.execute(db);
}
