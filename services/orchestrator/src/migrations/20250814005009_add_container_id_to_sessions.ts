import { Kysely } from 'kysely';

/**
 * SESSION CONTAINER OWNERSHIP - Database Migration
 * ===============================================
 * 
 * Adds container_id to sessions table to implement correct ownership model:
 * - Sessions own containers (not environments) 
 * - Each session gets isolated container with its worktree
 * - Environments are pure git repository mappings
 * 
 * Hoare Triple:
 * {P: sessions table exists without container_id}
 * add_container_id_to_sessions()
 * {Q: sessions.container_id column exists ∧ nullable}
 */

export async function up(db: Kysely<any>): Promise<void> {
  // Add container_id column to sessions table
  // Nullable because existing sessions don't have containers yet
  await db.schema
    .alterTable('sessions')
    .addColumn('container_id', 'varchar(255)', (col) => col)
    .execute();
    
  console.log('✅ Added container_id column to sessions table');
  console.log('📝 Note: Existing environment containers should be cleaned up manually');
}

export async function down(db: Kysely<any>): Promise<void> {
  // Remove container_id column from sessions table
  await db.schema
    .alterTable('sessions')
    .dropColumn('container_id')
    .execute();
    
  console.log('✅ Removed container_id column from sessions table');
}