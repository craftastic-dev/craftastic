import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // Check if there's a legacy sessions table with old schema
  const legacyTableExists = await db
    .selectFrom('information_schema.tables')
    .select('table_name')
    .where('table_schema', '=', 'public')
    .where('table_name', '=', 'sessions_backup')
    .executeTakeFirst();

  if (legacyTableExists) {
    console.log('Found legacy sessions data, migrating...');
    
    // Create default environments for existing sessions
    const legacySessions = await db
      .selectFrom('sessions_backup')
      .selectAll()
      .execute();

    const environmentMap = new Map<string, string>();

    // Group sessions by user_id and container_id to create environments
    for (const session of legacySessions) {
      const key = `${session.user_id}-${session.container_id}`;
      
      if (!environmentMap.has(key)) {
        // Create an environment for this user/container combination
        const environment = await db
          .insertInto('environments')
          .values({
            user_id: session.user_id,
            name: `Legacy Environment ${session.container_id?.substring(0, 8)}`,
            container_id: session.container_id,
            status: session.status === 'active' ? 'running' : 'stopped',
            created_at: session.created_at,
            updated_at: session.updated_at,
          })
          .returning('id')
          .executeTakeFirstOrThrow();

        environmentMap.set(key, environment.id);
      }
    }

    // Migrate session data to new schema
    for (const session of legacySessions) {
      const key = `${session.user_id}-${session.container_id}`;
      const environmentId = environmentMap.get(key);

      if (environmentId) {
        await db
          .insertInto('sessions')
          .values({
            id: session.id,
            environment_id: environmentId,
            name: `Legacy Session`,
            tmux_session_name: `session-${session.id.substring(0, 8)}`,
            working_directory: '/workspace',
            status: session.status === 'active' ? 'active' : 'inactive',
            created_at: session.created_at,
            updated_at: session.updated_at,
          })
          .execute();
      }
    }

    // Drop the backup table
    await db.schema.dropTable('sessions_backup').execute();
    console.log('✅ Legacy data migration completed');
  }
}

export async function down(db: Kysely<any>): Promise<void> {
  // This migration cannot be easily rolled back
  // as it transforms data structure
  console.log('⚠️  Cannot rollback data migration automatically');
}